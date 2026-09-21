import { createDraft, getSnapshot } from './store';
import { assistant } from './assistant';
import { getRun } from '../audit/store';
import { getItem } from '../github/api';

const paths: Record<string, string> = { readme: 'README.md', contributing: 'CONTRIBUTING.md', 'issue-template': '.github/ISSUE_TEMPLATE/bug_report.md', 'pr-template': '.github/pull_request_template.md', 'agent-readme-clarity': 'README.md', 'agent-contributing-clarity': 'CONTRIBUTING.md', 'agent-command-consistency': 'README.md' };
export async function fileDraft(owner: string, runId: string, checkId: string, signal?: AbortSignal) {
  const run = getRun(runId, owner), snapshot = getSnapshot(runId), path = paths[checkId];
  const check = run?.report?.checks.find(item => item.id === checkId);
  if (!run?.report || !snapshot || !path || !check) throw new Error('此检查暂不支持生成文件草稿，或旧任务没有文件快照，请重新体检。');
  if (snapshot.treeTruncated) throw new Error('快照目录不完整，请重新体检后生成草稿。');
  const existing = snapshot.contents.find(file => file.path === path);
  if (existing?.error || existing?.truncated || (!existing && snapshot.files.some(file => file.path === path))) throw new Error('原文件未完整读取，不能生成可发布的替换草稿。');
  const before = existing?.content || '';
  if (before.length > 20_000) throw new Error('原文件超过草稿编辑限制，不能安全地生成完整替换内容。');
  const content = await assistant(owner, 'file-draft', `生成 ${path} 的完整 Markdown 文件内容，不要代码围栏、前言或解释。保留原有正确内容，只完善给定问题。未知安装命令不要编造，标记待维护者确认。不得包含密钥或未经证实的承诺。`, { repository: snapshot.repository, check, before, files: snapshot.contents.filter(file => !file.error).map(file => ({ path: file.path, content: file.content.slice(0, 9000) })) }, [], signal);
  return createDraft(owner, { kind: 'file', repoUrl: run.repoUrl, runId, path, before, content, baseSha: run.repository!.sha, title: `docs: improve ${path}` });
}
export async function itemDraft(owner: string, repoUrl: string, kind: 'issue' | 'review', number: number, signal?: AbortSignal) {
  const item = await getItem(owner, repoUrl, kind === 'issue' ? 'issues' : 'pulls', number);
  let budget = 50_000;
  const files = item.files?.map(file => { const patch = file.patch?.slice(0, Math.max(0, budget)); budget -= patch?.length || 0; return { ...file, patch, omitted: patch?.length !== file.patch?.length }; });
  const content = await assistant(owner, kind, kind === 'issue' ? '分析 Issue：给出问题分类、已提供信息、缺失的复现信息和建议下一步。生成可直接审阅的友好回复草稿，不重复索要已给出的信息。' : '分析 PR 的实际 Diff，生成审阅评论草稿。逐项注明文件路径，区分确定问题与需要确认的问题。文件列表仅首 100 个，patch 可能截断，不能声称全量审查或测试通过。', { ...item, files, body: item.body.slice(0, 20000) }, [], signal);
  return createDraft(owner, { kind, repoUrl, number, baseSha: item.headSha || '', before: '', content, title: `${kind === 'issue' ? 'Issue 回复' : 'PR 审阅'} #${number}` });
}
