import type { Draft } from '../../contracts/workbench';
import { githubApi, repoPath } from '../github/api';
import { getOverview } from './overview';

export async function checkPublication(owner: string, draft: Draft): Promise<NonNullable<Draft['publication']>> {
  if (draft.kind !== 'file') {
    if (!draft.publishedUrl) throw new Error('评论发布结果无法自动确认，请到原始讨论核对；不会自动重发。');
    const url = new URL(draft.publishedUrl);
    if (url.origin !== 'https://github.com' || !draft.publishedUrl.startsWith(draft.repoUrl + '/')) throw new Error('评论来源地址无效。');
    const id = draft.kind === 'issue' ? url.hash.match(/^#issuecomment-(\d+)$/)?.[1] : url.hash.match(/^#pullrequestreview-(\d+)$/)?.[1];
    if (!id) throw new Error('评论标识不足，无法自动核对，请到 GitHub 检查。');
    const comment = await githubApi(owner, draft.kind === 'issue' ? `${repoPath(draft.repoUrl)}/issues/comments/${id}` : `${repoPath(draft.repoUrl)}/pulls/${draft.number}/reviews/${id}`);
    if (comment.html_url !== draft.publishedUrl || comment.body !== draft.content) throw new Error('远程评论内容或地址已变化，请人工核对。');
    return { ...draft.publication, state: 'comment', checkedAt: new Date().toISOString(), verification: 'not-verified' };
  }
  const branch = draft.publication?.branch || `repocare/${draft.id}`;
  let number: number;
  const prefix = `${draft.repoUrl}/pull/`;
  if (draft.publishedUrl?.startsWith(prefix) && /^\d+$/.test(draft.publishedUrl.slice(prefix.length))) number = Number(draft.publishedUrl.slice(prefix.length));
  else {
    const login = new URL(draft.repoUrl).pathname.split('/')[1];
    const rows = await githubApi(owner, `${repoPath(draft.repoUrl)}/pulls?state=all&head=${encodeURIComponent(login + ':' + branch)}&per_page=10`);
    const found = Array.isArray(rows) ? rows.find(row => row.head?.ref === branch && row.head?.repo?.html_url === draft.repoUrl) : undefined;
    if (!found || !Number.isSafeInteger(found.number)) throw new Error('未找到可确认的 PR。结果保持待核对，请到 GitHub 人工检查，不会自动重发。');
    number = found.number;
  }
  const pull = await githubApi(owner, `${repoPath(draft.repoUrl)}/pulls/${number}`);
  if (pull.head?.ref !== branch || pull.head?.repo?.html_url !== draft.repoUrl || !['open', 'closed'].includes(pull.state)) throw new Error('PR 来源不匹配，保持原状态并人工核对。');
  let verification: 'not-verified' | 'passed' | 'needs-attention' = 'not-verified', verificationRunId: string | undefined;
  const report = getOverview(owner).report;
  if (pull.merged && /^[a-f0-9]{40}$/i.test(pull.merge_commit_sha || '') && report?.repository.url === draft.repoUrl && (!draft.branch || draft.branch === report.repository.branch)) {
    let includesMerge = report.repository.sha === pull.merge_commit_sha;
    if (!includesMerge) {
      const comparison = await githubApi(owner, `${repoPath(draft.repoUrl)}/compare/${pull.merge_commit_sha}...${report.repository.sha}`);
      includesMerge = comparison.status === 'ahead' || comparison.status === 'identical';
    }
    const checks = report.checks.filter(check => draft.source?.type === 'audit-check' && check.id === draft.source.checkId);
    if (includesMerge && checks.length) { verification = checks.every(check => check.status === 'pass') ? 'passed' : 'needs-attention'; verificationRunId = report.runId; }
  }
  return { ...draft.publication, url: `${draft.repoUrl}/pull/${number}`, branch, state: pull.merged ? 'merged' : pull.state, checkedAt: new Date().toISOString(), mergeSha: pull.merged ? pull.merge_commit_sha : undefined, verification, verificationRunId };
}
