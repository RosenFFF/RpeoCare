import { githubAccount } from './connection';
import { parseRepositoryUrl } from '../audit/github';
import type { Draft, GitItem } from '../../contracts/workbench';

export class PublishPreconditionError extends Error {}

export function repoPath(url: string) {
  const repo = parseRepositoryUrl(url);
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}
export async function githubApi(owner: string, path: string, options: { method?: string; body?: unknown; write?: boolean; signal?: AbortSignal } = {}) {
  if (!path.startsWith('/repos/') && path !== '/user') throw new Error('GitHub 路径不受支持。');
  const account = githubAccount(owner);
  if (options.write && (!account?.canWrite || !account.token)) throw new Error('请先连接拥有仓库写入权限的 GitHub 账户。');
  // Workbench reads use the user's identity. A server token must never grant
  // anonymous callers access to private repositories by guessing their URL.
  const token = account?.token;
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET', redirect: 'error', cache: 'no-store',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'RepoCare', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub 请求失败（${response.status}），请检查授权、仓库权限或额度。`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('GitHub 返回空响应。');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 4_000_000) { await reader.cancel(); throw new Error('GitHub 响应超过 4 MB，请缩小查询范围。'); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function item(value: Record<string, any>): GitItem {
  return { number: value.number, title: value.title, body: String(value.body || '').slice(0, 40_000), url: value.html_url, state: value.state, author: value.user?.login || '', updatedAt: value.updated_at, labels: (value.labels || []).map((label: any) => label.name), headSha: value.head?.sha };
}
export async function listItems(owner: string, url: string, kind: 'issues' | 'pulls', page = 1): Promise<GitItem[]> {
  const rows = await githubApi(owner, `${repoPath(url)}/${kind}?state=open&per_page=30&page=${page}`);
  if (!Array.isArray(rows)) throw new Error('GitHub 列表格式异常。');
  return rows.filter(row => kind === 'pulls' || !row.pull_request).map(item);
}

async function countOpenPulls(owner: string, url: string): Promise<number> {
  const path = `${repoPath(url)}/pulls?state=open&per_page=1`;
  const account = githubAccount(owner);
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'RepoCare', ...(account?.token ? { Authorization: `Bearer ${account.token}` } : {}) }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub 请求失败（${response.status}）。`); }
  const link = response.headers.get('link');
  const last = link?.match(/[?&]page=(\d+)>; rel="last"/);
  if (last) {
    await response.body?.cancel();
    const count = Number(last[1]);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('GitHub 计数响应格式异常。');
    return count;
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('GitHub 计数响应格式异常。');
  return rows.length;
}

export async function repositoryCounts(owner: string, url: string) {
  // open_issues_count includes PRs. Share a single PR request and preserve partial failures.
  const [metadata, pulls] = await Promise.allSettled([githubApi(owner, repoPath(url)), countOpenPulls(owner, url)]);
  const total = metadata.status === 'fulfilled' ? metadata.value.open_issues_count : null;
  const pullCount = pulls.status === 'fulfilled' ? pulls.value : null;
  const issues = Number.isSafeInteger(total) && pullCount !== null && total >= pullCount ? total - pullCount : null;
  return {
    repoUrl: url, issues, pulls: pullCount,
    ...(issues === null ? { issuesError: 'Issue 数量暂时无法读取，请刷新重试。' } : {}),
    ...(pullCount === null ? { pullsError: 'PR 数量暂时无法读取，请刷新重试。' } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
export async function getItem(owner: string, url: string, kind: 'issues' | 'pulls', number: number): Promise<GitItem> {
  const prefix = repoPath(url), result = item(await githubApi(owner, `${prefix}/${kind}/${number}`));
  if (kind === 'pulls') {
    const files = await githubApi(owner, `${prefix}/pulls/${number}/files?per_page=100`);
    result.files = files.map((file: any) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch?.slice(0, 12_000) }));
  }
  return result;
}
export async function publishDraft(owner: string, draft: Draft): Promise<string> {
  const prefix = repoPath(draft.repoUrl);
  const metadata = await githubApi(owner, prefix);
  if (!metadata.permissions?.push) throw new PublishPreconditionError('当前 GitHub 账户没有该仓库的写入权限。');
  if (draft.kind === 'issue') {
    const response = await githubApi(owner, `${prefix}/issues/${draft.number}/comments`, { method: 'POST', write: true, body: { body: draft.content } });
    return response.html_url;
  }
  if (draft.kind === 'review') {
    const pull = await githubApi(owner, `${prefix}/pulls/${draft.number}`);
    if (pull.head?.sha !== draft.baseSha) throw new PublishPreconditionError('PR 已有新提交，请重新分析后再发布。');
    const response = await githubApi(owner, `${prefix}/pulls/${draft.number}/reviews`, { method: 'POST', write: true, body: { body: draft.content, event: 'COMMENT', commit_id: draft.baseSha } });
    return response.html_url;
  }
  if (!draft.path || !/^(README\.md|CONTRIBUTING\.md|\.github\/(ISSUE_TEMPLATE\/bug_report\.md|pull_request_template\.md))$/.test(draft.path)) throw new Error('草稿文件路径不允许写入。');
  const base = await githubApi(owner, `${prefix}/commits/${encodeURIComponent(metadata.default_branch)}`);
  if (base.sha !== draft.baseSha) throw new PublishPreconditionError('默认分支已更新，请重新体检并生成草稿，避免覆盖新内容。');
  const branch = `repocare/${draft.id}`;
  // A single tree/commit includes the reviewed file. Never update the default branch.
  const blob = await githubApi(owner, `${prefix}/git/blobs`, { method: 'POST', write: true, body: { content: draft.content, encoding: 'utf-8' } });
  const tree = await githubApi(owner, `${prefix}/git/trees`, { method: 'POST', write: true, body: { base_tree: base.commit.tree.sha, tree: [{ path: draft.path, mode: '100644', type: 'blob', sha: blob.sha }] } });
  const commit = await githubApi(owner, `${prefix}/git/commits`, { method: 'POST', write: true, body: { message: draft.title, tree: tree.sha, parents: [draft.baseSha] } });
  await githubApi(owner, `${prefix}/git/refs`, { method: 'POST', write: true, body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  const pr = await githubApi(owner, `${prefix}/pulls`, { method: 'POST', write: true, body: { title: draft.title, head: branch, base: metadata.default_branch, body: `根据 RepoCare 体检生成并经用户审阅。\n\n体检版本：${draft.baseSha}\n修改文件：${draft.path}`, draft: true } });
  return pr.html_url;
}
