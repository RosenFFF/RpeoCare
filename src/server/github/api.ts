import { prepareReviewFiles, reviewFingerprint } from '../../shared/lib/pr-review-context';
import { getPullRequestReview } from '../workbench/store';
import { githubAccount } from './connection';
import { parseRepositoryUrl } from '../audit/github';
import type { Draft, GitComment, GitItem, PullRequestCheck } from '../../contracts/workbench';
import type { BranchDirectory } from '../../contracts/branches';

export class PublishPreconditionError extends Error {}

export function repoPath(url: string) {
  const repo = parseRepositoryUrl(url);
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}
export async function githubApi(owner: string, path: string, options: { method?: string; body?: unknown; write?: boolean; signal?: AbortSignal; onHeaders?: (headers: Headers) => void } = {}) {
  if (!path.startsWith('/repos/') && path !== '/user' && !/^\/user\/repos\?[^#]*$/.test(path)) throw new Error('GitHub 路径不受支持。');
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
  options.onHeaders?.(response.headers);
  const reader = response.body?.getReader(); if (!reader) throw new Error('GitHub 返回空响应。');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 4_000_000) { await reader.cancel(); throw new Error('GitHub 响应超过 4 MB，请缩小查询范围。'); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function item(value: Record<string, any>): GitItem {
  return { number: value.number, title: String(value.title || ''), body: String(value.body || '').slice(0, 40_000), url: value.html_url, state: value.state, author: value.user?.login || '', updatedAt: value.updated_at, labels: (value.labels || []).map((label: any) => label.name), commentCount: Number.isSafeInteger(value.comments) ? value.comments : undefined, assignees: (value.assignees || []).map((person: any) => person.login).filter(Boolean), milestone: value.milestone?.title || null, headSha: value.head?.sha, baseSha: value.base?.sha, totalChangedFiles: Number.isSafeInteger(value.changed_files) ? value.changed_files : undefined, headRef: value.head?.ref, headRepository: typeof value.head?.repo?.full_name === 'string' ? value.head.repo.full_name : undefined, baseRef: value.base?.ref, isDraft: value.draft === true };
}
function comment(value: Record<string, any>): GitComment {
  return { id: Number(value.id), body: String(value.body || '').slice(0, 12_000), url: value.html_url, author: value.user?.login || '', createdAt: value.created_at, updatedAt: value.updated_at || value.created_at };
}
export async function listItems(owner: string, url: string, kind: 'issues' | 'pulls', page = 1): Promise<GitItem[]> {
  return (await listItemsPage(owner, url, kind, page)).items;
}

export async function listItemsPage(owner: string, url: string, kind: 'issues' | 'pulls', page = 1, options: { base?: string; signal?: AbortSignal } = {}) {
  let hasNext = false;
  const base = kind === 'pulls' && options.base ? `&base=${encodeURIComponent(options.base)}` : '';
  const rows = await githubApi(owner, `${repoPath(url)}/${kind}?state=open&per_page=30&page=${page}${base}`, {
    signal: options.signal,
    onHeaders: headers => { hasNext = /<[^>]+>;\s*rel="next"/.test(headers.get('link') || ''); },
  });
  if (!Array.isArray(rows)) throw new Error('GitHub 列表格式异常。');
  return { items: rows.filter(row => kind === 'pulls' || !row.pull_request).map(item), hasNext };
}

export async function listBranches(owner: string, url: string, page: number, signal?: AbortSignal): Promise<BranchDirectory> {
  let hasNext = false;
  const [rows, metadata] = await Promise.all([
    githubApi(owner, `${repoPath(url)}/branches?per_page=100&page=${page}`, {
      signal,
      onHeaders: headers => { hasNext = /<[^>]+>;\s*rel="next"/.test(headers.get('link') || ''); },
    }),
    page === 1 ? githubApi(owner, repoPath(url), { signal }) : Promise.resolve(null),
  ]);
  if (!Array.isArray(rows) || rows.some(row => typeof row?.name !== 'string' || !row.name)) throw new Error('GitHub 分支目录格式异常。');
  return {
    repoUrl: url, page, hasNext,
    defaultBranch: typeof metadata?.default_branch === 'string' ? metadata.default_branch : undefined,
    branches: rows.map(row => ({ name: row.name, protected: row.protected === true, commitSha: /^[a-f0-9]{40}$/i.test(row.commit?.sha || '') ? row.commit.sha : undefined })),
  };
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

export async function getPullRequestChecks(owner: string, url: string, ref: string, signal?: AbortSignal): Promise<{ checks: PullRequestCheck[]; available: boolean; warnings: string[] }> {
  const prefix = repoPath(url);
  const checks: PullRequestCheck[] = [], warnings: string[] = [];
  const results = await Promise.allSettled([
    githubApi(owner, `${prefix}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`, { signal }),
    githubApi(owner, `${prefix}/commits/${encodeURIComponent(ref)}/status?per_page=100`, { signal }),
  ]);
  if (results[0].status === 'fulfilled' && Array.isArray(results[0].value.check_runs)) {
    const data = results[0].value;
    for (const check of data.check_runs) checks.push({ name: String(check.name || 'unknown'), status: ['queued', 'in_progress', 'completed'].includes(check.status) ? check.status : 'unknown', conclusion: check.conclusion ?? null });
    if (data.total_count > checks.length) warnings.push('Checks 超过单页 100 项，当前不是完整检查清单。');
  } else warnings.push('GitHub Checks 无法读取：权限、额度或服务暂不可用；不代表检查通过。');
  if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.statuses)) {
    for (const status of results[1].value.statuses) checks.push({ name: `Status: ${String(status.context || 'unknown')}`, status: status.state === 'pending' ? 'in_progress' : 'completed', conclusion: status.state });
    if (results[1].value.total_count > results[1].value.statuses.length) warnings.push('Commit Status 清单分页截断。');
  } else warnings.push('GitHub Commit Status 无法读取；不代表没有旧式 CI。');
  return { checks, available: warnings.length === 0, warnings };
}

export async function getPullRequestReviewContext(owner: string, url: string, number: number, signal?: AbortSignal) {
  const result = await getItem(owner, url, 'pulls', number, signal);
  if (!result.headSha || !result.baseSha) throw new Error('无法锁定 PR 的 head/base SHA，未生成审查。');
  const ci = await getPullRequestChecks(owner, url, result.headSha, signal);
  const warnings = [...ci.warnings];
  const references = [...result.body.matchAll(/\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d+)/gi)].map(match => Number(match[1]));
  const linkedIssues: { number: number; title: string; body: string; url: string }[] = [];
  for (const issueNumber of [...new Set(references)].slice(0, 3)) {
    try {
      const raw = await githubApi(owner, `${repoPath(url)}/issues/${issueNumber}`, { signal });
      if (!raw.pull_request) linkedIssues.push({ number: issueNumber, title: String(raw.title || '').slice(0, 500), body: String(raw.body || '').slice(0, 3000), url: `https://github.com/${parseRepositoryUrl(url).owner}/${parseRepositoryUrl(url).name}/issues/${issueNumber}` });
    } catch { warnings.push(`关联 Issue #${issueNumber} 无法读取，未推断需求已满足。`); }
  }
  // PR file-list endpoint is mutable; compare both ends again after collection.
  const end = await githubApi(owner, `${repoPath(url)}/pulls/${number}`, { signal });
  if (end.head?.sha !== result.headSha || end.base?.sha !== result.baseSha || end.updated_at !== result.updatedAt) throw new Error('采集期间 PR 已更新，请重新读取后审查。');
  result.checks = ci.checks; result.checksAvailable = ci.available; result.snapshotWarnings = warnings; result.linkedIssues = linkedIssues;
  return { item: result, checks: ci.checks, files: result.files || [], headSha: result.headSha, baseSha: result.baseSha };
}

export async function getBranchCommit(owner: string, url: string, requestedBranch?: string, signal?: AbortSignal): Promise<{ branch: string; sha: string }> {
  const prefix = repoPath(url);
  const repository = await githubApi(owner, prefix, { signal });
  if (repository.private !== false) throw new Error('当前 Bug 复现仅支持公开 GitHub 仓库。');
  const branch = requestedBranch || repository.default_branch;
  if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('仓库分支名称无效。');
  const commit = await githubApi(owner, `${prefix}/commits/${encodeURIComponent(branch)}`, { signal });
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('无法锁定 Issue 复现使用的 Git 提交。');
  return { branch, sha: commit.sha };
}

export async function getItem(owner: string, url: string, kind: 'issues' | 'pulls', number: number, signal?: AbortSignal): Promise<GitItem> {
  const prefix = repoPath(url), result = item(await githubApi(owner, `${prefix}/${kind}/${number}`, { signal }));
  if (kind === 'issues') {
    const comments = await githubApi(owner, `${prefix}/issues/${number}/comments?per_page=100&page=1`, { signal });
    if (!Array.isArray(comments)) throw new Error('GitHub 评论列表格式异常。');
    result.comments = comments.slice(0, 100).map(comment);
  }
  if (kind === 'pulls') {
    const files = await githubApi(owner, `${prefix}/pulls/${number}/files?per_page=100`, { signal });
    if (!Array.isArray(files)) throw new Error('GitHub PR 文件清单格式异常。');
    result.filesTruncated = result.totalChangedFiles !== undefined ? result.totalChangedFiles > files.length : files.length >= 100;
    result.files = files.map((file: any) => { const patch = typeof file.patch === 'string' ? file.patch : undefined; return { path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: patch && patch.length > 12_000 ? patch.slice(0, Math.max(0, patch.lastIndexOf('\n', 12_000))) : patch, patchTruncated: Boolean(patch && patch.length > 12_000) || !patch }; });
  }
  return result;
}
export async function updateIssue(owner: string, url: string, number: number, input: { state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] }, signal?: AbortSignal): Promise<GitItem> {
  if (!input.state && !input.labels && !input.assignees) throw new Error('没有可保存的 Issue 变更。');
  const prefix = repoPath(url);
  const value = await githubApi(owner, `${prefix}/issues/${number}`, { method: 'PATCH', write: true, signal, body: {
    ...(input.state ? { state: input.state } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
    ...(input.assignees ? { assignees: input.assignees } : {}),
  } });
  return item(value);
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
    if (draft.source?.type === 'github-item' && draft.source.reviewId) {
      const review = getPullRequestReview(owner, draft.repoUrl, draft.number!);
      if (!review || review.id !== draft.source.reviewId || review.revision !== draft.source.reviewRevision || review.baseSha !== pull.base?.sha) throw new PublishPreconditionError('审查判断或基准已变化，请重新生成并审阅草稿。');
    }
    if (pull.head?.sha !== draft.baseSha) throw new PublishPreconditionError('PR 已有新提交，请重新分析后再发布。');
    if (draft.source?.type === 'github-item' && draft.source.reviewId) {
      const snapshot = await getItem(owner, draft.repoUrl, 'pulls', draft.number!);
      const review = getPullRequestReview(owner, draft.repoUrl, draft.number!)!;
      if (review.contextFingerprint !== reviewFingerprint(snapshot, prepareReviewFiles(snapshot.files || []))) throw new PublishPreconditionError('PR 描述或 Diff 已更新，请重新审查。');
    }
    const response = await githubApi(owner, `${prefix}/pulls/${draft.number}/reviews`, { method: 'POST', write: true, body: { body: draft.content, event: 'COMMENT', commit_id: draft.baseSha } });
    return response.html_url;
  }
  return publishFileDrafts(owner, [draft]);
}

export async function publishFileDrafts(owner: string, drafts: Draft[]): Promise<string> {
  const first = drafts[0];
  const signal = AbortSignal.timeout(100_000);
  const request = (path: string, options: Parameters<typeof githubApi>[2] = {}) => githubApi(owner, path, { ...options, signal });
  const allowed = /^(README\.md|CONTRIBUTING\.md|\.github\/(ISSUE_TEMPLATE\/bug_report\.md|pull_request_template\.md))$/;
  if (!first || drafts.length > 4 || drafts.some(draft => draft.kind !== 'file' || draft.repoUrl !== first.repoUrl || draft.baseSha !== first.baseSha || draft.branch !== first.branch || !draft.path || !allowed.test(draft.path)) || new Set(drafts.map(draft => draft.path)).size !== drafts.length) throw new PublishPreconditionError('批次需为同仓库、同分支、同基准的 1–4 个不同文件。');
  const prefix = repoPath(first.repoUrl), metadata = await request(prefix);
  if (!metadata.permissions?.push) throw new PublishPreconditionError('当前 GitHub 账户没有该仓库的写入权限。');
  if (first.branch && first.branch !== metadata.default_branch) throw new PublishPreconditionError('当前仅支持默认分支的文档改进发布；请切换默认分支重新体检。');
  const base = await request(`${prefix}/commits/${encodeURIComponent(metadata.default_branch)}`);
  if (base.sha !== first.baseSha) throw new PublishPreconditionError('默认分支已更新，请重新体检并生成草稿，避免覆盖新内容。');
  const treeEntries = [];
  for (const draft of drafts) {
    const blob = await request(`${prefix}/git/blobs`, { method: 'POST', write: true, body: { content: draft.content, encoding: 'utf-8' } });
    treeEntries.push({ path: draft.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await request(`${prefix}/git/trees`, { method: 'POST', write: true, body: { base_tree: base.commit.tree.sha, tree: treeEntries } });
  const commit = await request(`${prefix}/git/commits`, { method: 'POST', write: true, body: { message: drafts.length === 1 ? first.title : 'docs: improve maintenance documentation', tree: tree.sha, parents: [first.baseSha] } });
  const branch = `repocare/${first.id}`;
  await request(`${prefix}/git/refs`, { method: 'POST', write: true, body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  const pr = await request(`${prefix}/pulls`, { method: 'POST', write: true, body: { title: drafts.length === 1 ? first.title : 'docs: improve maintenance documentation', head: branch, base: metadata.default_branch, body: `根据 RepoCare 体检生成并经维护者确认。\n\n体检版本：${first.baseSha}\n修改文件：${drafts.map(draft => draft.path).join(', ')}`, draft: true } });
  const url = String(pr.html_url || '');
  if (!url.startsWith(first.repoUrl + '/pull/') || !/^\d+$/.test(url.slice((first.repoUrl + '/pull/').length))) throw new Error('GitHub 未返回可确认的 PR 地址，请人工核对。');
  return url;
}
