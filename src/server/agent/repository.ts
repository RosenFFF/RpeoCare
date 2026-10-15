import { createHash } from 'node:crypto';
import { githubApi, getItem, getPullRequestReviewContext, repoPath } from '../github/api';
import type { AgentEvidence } from '../../contracts/agent';
import { saveClaim, type ClaimedTask } from './store';
export function repositoryPath(path: string) {
    if (!path || path.length > 400 || /[\\:]/.test(path) || [...path].some(c => c.charCodeAt(0) < 32) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')
        || /(^|\/)(\.git|node_modules|\.aws|\.ssh|\.npmrc|\.pypirc|\.env(?:\..*)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx|keystore)$/i.test(path))
        throw new Error('此路径不在 Agent 可读取范围内。');
    return path;
}
type Tree = {
    tree: {
        path: string;
        type: string;
        mode: string;
        sha: string;
        size?: number;
    }[];
    truncated: boolean;
    occupied?: string[];
    blockedParents?: string[];
};
export class RepositoryReader {
    private requests = 0;
    constructor(readonly claim: ClaimedTask, readonly signal: AbortSignal, private readonly onInitialize:()=>void=()=>saveClaim(claim)) { }
    async api<T>(path: string): Promise<T> {
        this.signal.throwIfAborted();
        if (++this.requests > 70)
            throw new Error('本次执行已达 GitHub 请求预算，请缩小范围后继续。');
        return await githubApi(this.claim.owner, `${repoPath(this.claim.task.repoUrl)}${path}`, { signal: this.signal }) as T;
    }
    async initialize() {
        const { task } = this.claim;
        if (task.commitSha)
            return;
        const metadata = await this.api<{
            default_branch: string;
            private: boolean;
        }>('');
        const branch = task.requestedBranch || metadata.default_branch;
        const commit = await this.api<{
            sha: string;
        }>(`/commits/${encodeURIComponent(branch)}`);
        let sha = task.kind==='docs'&&task.sourceCommitSha?task.sourceCommitSha:commit.sha, sourceBranch=branch;
        if (task.kind === 'issue' || task.kind === 'pr') {
            const item = task.kind==='pr'?(await getPullRequestReviewContext(this.claim.owner,task.repoUrl,task.number!,this.signal)).item:await getItem(this.claim.owner,task.repoUrl,'issues',task.number!,this.signal);
            if (task.kind === 'pr' && item.headSha)
                sha = item.headSha;
            if(task.kind==='pr')sourceBranch=item.headRef||branch;
            if(task.kind==='issue'){
                const latest=await this.api<{updated_at:string}>(`/issues/${task.number}`);
                if(latest.updated_at!==item.updatedAt)throw new Error('采集期间Issue已更新，请重试。');
            }
            this.claim.internal.cache.item = JSON.stringify(item);
            this.claim.internal.cache.sourceUpdatedAt = item.updatedAt;
        }
        if (!/^[a-f0-9]{40}$/i.test(sha))
            throw new Error('GitHub未返回有效提交。');
        const git = await this.api<{
            tree: {
                sha: string;
            };
        }>(`/git/commits/${sha}`);
        if (!/^[a-f0-9]{40}$/i.test(git.tree?.sha))
            throw new Error('GitHub未返回有效目录版本。');
        this.claim.internal.cache.treeSha = git.tree.sha;
        this.claim.internal.cache.visibility = metadata.private ? 'private' : 'public';
        task.branch = sourceBranch;
        task.commitSha = sha;
        task.sourceUpdatedAt = this.claim.internal.cache.sourceUpdatedAt;
        this.onInitialize();
    }
    async tree(): Promise<Tree> {
        const cache = this.claim.internal.cache;
        if (!cache.tree) {
            const tree = await this.api<Tree>(`/git/trees/${cache.treeSha || this.claim.task.commitSha}?recursive=1`);
            const filtered = tree.tree.filter(item => item.type === 'blob' && item.mode !== '120000' && item.mode !== '160000' && (() => { try {
                repositoryPath(item.path);
                return true;
            }
            catch {
                return false;
            } })());
            cache.tree = JSON.stringify({ tree: filtered.slice(0, 15000), truncated: tree.truncated || filtered.length > 15000,
                occupied:tree.tree.map(entry=>entry.path),blockedParents:tree.tree.filter(entry=>entry.mode==='120000'||entry.type==='commit').map(entry=>entry.path) });
        }
        return JSON.parse(cache.tree);
    }
    async file(path: string) {
        repositoryPath(path);
        const entry = (await this.tree()).tree.find(file => file.path === path);
        if (!entry)
            throw new Error('目录读取范围中没有此文件；目录截断时不能据此判断文件不存在。');
        if ((entry.size || 0) > 120000)
            throw new Error('文件超过 120KB 的按需读取限制。');
        const key = `blob:${entry.sha}`, cache = this.claim.internal.cache;
        if (cache[key]===undefined) {
            const blob = await this.api<{
                content: string;
                encoding: string;
                size: number;
            }>(`/git/blobs/${entry.sha}`);
            if (blob.encoding !== 'base64' || blob.size > 120000)
                throw new Error('文件过大或编码不受支持。');
            const bytes = Buffer.from(blob.content, 'base64');
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (content.includes('\0'))
                throw new Error('不能将二进制文件作为源码读取。');
            if (/(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content))
                throw new Error('文件包含疑似凭据，未向模型提供此文件。');
            if (Object.entries(cache).filter(([name]) => name.startsWith('blob:')).reduce((size, [, text]) => size + text.length, 0) + content.length > 600000)
                throw new Error('任务源码缓存达到 600,000 字符上限，请新建更聚焦的任务。');
            cache[key] = content;
        }
        return { path, sha: entry.sha, content: cache[key] };
    }
    evidence(kind: AgentEvidence['kind'], label: string, excerpt: string, url?: string) {
        const task = this.claim.task, shortened = excerpt.slice(0, 12000);
        const id = 'E' + createHash('sha256').update(`${task.commitSha}:${kind}:${label}:${shortened}`).digest('hex').slice(0, 12);
        if (!task.evidence.some(item => item.id === id)) {
            if (task.evidence.length >= 100)
                throw new Error('此任务已达到 100 项证据上限。');
            task.evidence.push({ id, kind, label, excerpt: shortened, url, commitSha: task.commitSha!, capturedAt: new Date().toISOString() });
        }
        return id;
    }
    async read(path: string, startLine = 1) {
        const file = await this.file(path), lines = file.content.split('\n');
        const selected: string[] = [];
        let chars = 0;
        for (const line of lines.slice(startLine - 1, startLine + 118)) {
            if (chars + line.length + 1 > 12000)
                break;
            selected.push(line);
            chars += line.length + 1;
        }
        if (!selected.length && startLine <= lines.length)
            throw new Error('单行内容超过读取限制。');
        const endLine = startLine + selected.length - 1;
        const url = `${this.claim.task.repoUrl.replace(/\.git$/, '')}/blob/${this.claim.task.commitSha}/${path.split('/').map(encodeURIComponent).join('/')}#L${startLine}`;
        const content = selected.join('\n'), evidenceId = this.evidence('file', `${path}:${startLine}-${endLine}`, content, url);
        return { path, blobSha: file.sha, startLine, endLine, totalLines: lines.length, content, evidenceId, nextLine: endLine < lines.length ? endLine + 1 : null };
    }
}
