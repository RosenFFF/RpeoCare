import { z } from 'zod';
import { policyFields, policyKinds, type PolicyDocument, type ProjectPolicy, type ProjectRule } from '../../contracts/policy';
import { workbenchDb } from './store';
import { githubApi, repoPath } from '../github/api';

export const ruleSchema = z.object({ id: z.string().min(1).max(80), kind: z.enum(policyKinds), title: z.string().trim().min(1).max(100), value: z.string().trim().max(1200), field: z.enum(Object.keys(policyFields) as [keyof typeof policyFields, ...Array<keyof typeof policyFields>]).optional(), category: z.enum(['bug', 'feature', 'question', 'documentation', 'performance', 'compatibility', 'security', 'other']).optional(), appliesTo: z.enum(['issue', 'pr', 'both']), source: z.object({ kind: z.enum(['manual', 'repository']), path: z.string().max(300).optional(), commitSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(), excerpt: z.string().max(1600).optional(), line: z.number().int().positive().optional() }).strict() }).strict().superRefine((r, ctx) => {
  if (['required-field', 'supported-version', 'label-map'].includes(r.kind) && r.appliesTo !== 'issue' || ['required-check', 'test-change'].includes(r.kind) && r.appliesTo !== 'pr') ctx.addIssue({ code: 'custom', message: '规则类型与适用流程不一致。' });
  if (r.kind === 'required-field' && !r.field) ctx.addIssue({ code: 'custom', message: '请选择必填信息字段。' });
  if (['label-map', 'required-check', 'command', 'guidance'].includes(r.kind) && !r.value) ctx.addIssue({ code: 'custom', message: '规则内容不能为空。' });
  if (r.kind === 'label-map' && !r.category) ctx.addIssue({ code: 'custom', message: '标签映射需要目标分类。' });
  if (r.kind === 'supported-version' && !/^[a-z][a-z0-9. -]{0,35}\s*\|\s*\d+\.\d+(?:\.\d+)?(?:\s*\|\s*\d+\.\d+(?:\.\d+)?)*$/i.test(r.value)) ctx.addIssue({ code: 'custom', message: '版本格式示例：Python | 3.10 | 3.11 | 3.12，仅支持版本前缀列表。' });
  if (r.source.kind === 'repository' && (!r.source.path || !r.source.commitSha || !r.source.excerpt || !r.source.line)) ctx.addIssue({ code: 'custom', message: '仓库来源需要固定提交、路径、行号及原文。' });
  if (r.source.path && (r.source.path.startsWith('/') || r.source.path.split('/').some(s => s === '..' || s === '.') || r.source.path.includes('\\'))) ctx.addIssue({ code: 'custom', message: '来源路径无效。' });
});
export const rulesSchema = z.array(ruleSchema).max(24).refine(rules => new Set(rules.map(r => r.id)).size === rules.length, '规则编号不能重复。').refine(rules => { const labels = rules.filter(r => r.kind === 'label-map').map(r => r.value.toLowerCase()); return new Set(labels).size === labels.length; }, '同一标签只能保留一条分类映射。');
function database() { const db = workbenchDb(); db.exec('CREATE TABLE IF NOT EXISTS project_policies(owner TEXT NOT NULL, repo TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(owner,repo)); CREATE TABLE IF NOT EXISTS project_policy_versions(owner TEXT NOT NULL, repo TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(owner,repo,revision));'); return db; }
export function policyDocument(owner: string, repo: string): PolicyDocument { const row = database().prepare('SELECT state FROM project_policies WHERE owner=? AND repo=?').get(owner, repo) as { state: string } | undefined; return row ? JSON.parse(row.state) : { revision: 0, active: null, draft: null }; }
export const activePolicy = (owner: string, repo: string) => policyDocument(owner, repo).active;
export function savePolicyDraft(owner: string, repo: string, revision: number, input: unknown) {
  const rules = rulesSchema.parse(input), db = database(); db.exec('BEGIN IMMEDIATE');
  try { const current = policyDocument(owner, repo); if (current.revision !== revision) throw new Error('项目规则已被修改，请刷新后合并更改。'); const next: PolicyDocument = { revision: revision + 1, active: current.active, draft: { revision: revision + 1, repoUrl: repo, rules, updatedAt: new Date().toISOString() } }; db.prepare('INSERT INTO project_policies VALUES(?,?,?) ON CONFLICT(owner,repo) DO UPDATE SET state=excluded.state').run(owner, repo, JSON.stringify(next)); db.exec('COMMIT'); return next; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export async function confirmPolicy(owner: string, repo: string, revision: number, signal?: AbortSignal) {
  const current = policyDocument(owner, repo); if (!current.draft || current.revision !== revision) throw new Error('候选规则已变化，请刷新并重新审阅。');
  const sources = new Map<string, string>();
  for (const rule of current.draft.rules) if (rule.source.kind === 'repository') {
    const source = rule.source, key = `${source.commitSha}:${source.path}`;
    if (!sources.has(key)) sources.set(key, await sourceText(owner, repo, source.path!, source.commitSha!, signal));
    const excerpt = sources.get(key)!.split('\n').slice(source.line! - 1).join('\n');
    if (!excerpt.startsWith(source.excerpt!)) throw new Error(`规则「${rule.title}」的来源原文不匹配，请重新读取或改为维护者手动约定。`);
  }
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try { if (policyDocument(owner, repo).revision !== revision) throw new Error('规则已变化，未启用旧版本。'); const policy: ProjectPolicy = { ...current.draft, confirmedAt: new Date().toISOString() }; const next: PolicyDocument = { revision: revision + 1, active: policy, draft: null }; db.prepare('INSERT INTO project_policy_versions VALUES(?,?,?,?)').run(owner, repo, policy.revision, JSON.stringify(policy)); db.prepare('UPDATE project_policies SET state=? WHERE owner=? AND repo=?').run(JSON.stringify(next), owner, repo); db.exec('COMMIT'); return next; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
async function sourceText(owner: string, repo: string, path: string, sha: string, signal?: AbortSignal) {
  const data = await githubApi(owner, `${repoPath(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, { signal });
  if (data.type !== 'file' || data.encoding !== 'base64' || data.size > 80000) throw new Error('规则来源必须是 80 KB 以内的普通文本文件。');
  return Buffer.from(data.content, 'base64').toString('utf8').replace(/\r\n/g, '\n');
}
export async function discoverPolicy(owner: string, repo: string, branch?: string, signal?: AbortSignal) {
  const meta = await githubApi(owner, repoPath(repo), { signal }), commit = await githubApi(owner, `${repoPath(repo)}/commits/${encodeURIComponent(branch || meta.default_branch)}`, { signal });
  const sha = commit.sha; if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('无法固定项目约定来源版本。');
  const tree = await githubApi(owner, `${repoPath(repo)}/git/trees/${commit.commit.tree.sha}?recursive=1`, { signal });
  const paths = (tree.tree as { path: string; type: string }[]).filter(x => x.type === 'blob' && /^(?:README\.md|CONTRIBUTING\.md|package\.json|pyproject\.toml|\.github\/(?:CONTRIBUTING\.md|ISSUE_TEMPLATE\/[^/]+\.(?:md|ya?ml)))$/i.test(x.path)).slice(0, 8);
  const rules: ProjectRule[] = [], warnings: string[] = tree.truncated ? ['GitHub 目录清单截断，候选规则不代表全部项目约定。'] : [];
  for (const { path } of paths) {
    try { const text = await sourceText(owner, repo, path, sha, signal), lines = text.split('\n');
      const add = (line: number, input: Omit<ProjectRule, 'id' | 'source'>) => { if (rules.length < 24) rules.push({ ...input, id: `source-${rules.length + 1}`, source: { kind: 'repository', path, commitSha: sha, line: line + 1, excerpt: lines.slice(line, line + 3).join('\n').slice(0, 1600) } }); };
      if (/package\.json$/i.test(path)) { const pkg = JSON.parse(text); for (const [name, command] of Object.entries(pkg.scripts || {})) if (/^(?:test|lint|typecheck|check)$/.test(name) && typeof command === 'string') { const line = Math.max(0, lines.findIndex(x => x.includes(`"${name}"`))); add(line, { kind: 'command', title: `验证命令：${name}`, value: `npm run ${name}`, appliesTo: 'both' }); } }
      if (/ISSUE_TEMPLATE/i.test(path)) for (const [field, pattern] of Object.entries({ runtime: /python version|node(?:\.js)? version|runtime|运行时|语言版本/i, platform: /operating system|\bos\b|platform|操作系统|平台/i, reproduction: /reproduc|steps to|复现/i, expected: /expected|预期/i, actual: /actual|observed|实际行为/i })) { const line = lines.findIndex(x => pattern.test(x)); if (line >= 0) add(line, { kind: 'required-field', title: policyFields[field as keyof typeof policyFields], field: field as keyof typeof policyFields, value: '', category: 'bug', appliesTo: 'issue' }); }
      if (/contributing|readme|pyproject/i.test(path)) { const line = lines.findIndex(x => /requires-python|supported versions?|支持版本|npm (?:test|run)|python3? -m pytest|go test/i.test(x)); if (line >= 0) add(line, { kind: 'guidance', title: `待核对约定：${path}`, value: lines.slice(line, line + 3).join('\n').slice(0, 1000), appliesTo: 'both' }); }
    } catch { signal?.throwIfAborted(); warnings.push(`${path} 未能读取或解析，请手动补充。`); }
  }
  return { rules, commitSha: sha, warnings: [...warnings, '候选规则按文本线索提取，必填性及适用范围须由维护者修改并确认。'] };
}
