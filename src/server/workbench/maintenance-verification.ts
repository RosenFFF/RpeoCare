import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentArtifact, AgentPatchFile, MaintenanceTask } from '@/contracts/agent';
import type { GitItem, ReproductionPlan, ReproductionStep } from '@/contracts/workbench';
import type { VerificationContext, VerificationRequirement } from '@/contracts/maintenance-verification';
import { validateReproductionPlan } from '../reproduction/plan';
import { repositoryPath } from '../agent/repository';
import { githubApi, repoPath } from '../github/api';
import { pytestCommand, commandTokens } from '../../../reproduction/commands.mjs';

export const verificationRequirementsSchema = z.array(z.object({
  text: z.string().trim().min(3).max(500), quote: z.string().trim().min(5).max(1200),
  command: z.string().min(1).max(500), failureSignal: z.string().trim().min(5).max(200),
  changedPaths: z.array(z.string().min(1).max(400)).min(1).max(4),
}).strict()).min(1).max(8);
export const verificationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const testPath = (path: string) => /(^|\/)(?:tests?\/|test_[^/]+\.py$|[^/]+_test\.py$|conftest\.py$)/.test(path);
const dependencyPath = /(^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements[^/]*\.txt|uv\.lock|poetry\.lock|go\.mod|go\.sum)$/;

function sources(item: GitItem) {
  return [
    { label: `#${item.number} 正文`, text: item.body },
    ...(item.comments || []).map(comment => ({ label: `评论 #${comment.id}`, text: comment.body })),
    ...(item.linkedIssues || []).map(issue => ({ label: `关联 Issue #${issue.number}`, text: issue.body })),
  ];
}
export function verificationSourceFingerprint(item: GitItem) {
  return verificationHash({ number: item.number, updatedAt: item.updatedAt, head: item.headSha, base: item.baseSha, sources: sources(item) });
}

export function prepareMaintenanceVerification(input: { task: MaintenanceTask; patch: AgentArtifact; item: GitItem; plan: unknown; requirements: unknown; policyRevision: number }) {
  const { task, patch, item } = input;
  const plan = validateReproductionPlan(input.plan);
  if (!task.commitSha || !patch.files?.length || patch.superseded) throw new Error('请先准备当前版本的补丁。');
  if (plan.mode !== 'test' || plan.oracle.type !== 'all-steps-pass' || [...plan.setup, ...plan.steps].some(step => step.type === 'create-file' || step.background)) throw new Error('对照验证需要无后台进程、无额外写文件的测试计划。');
  if (plan.steps.some(step => step.type !== 'run-test' || !step.command || !pytestCommand(step.command))) throw new Error('需求对照目前仅支持独立 pytest 测试命令，请把每项目标与正常用例分别列为 run-test。');
  if (plan.steps.some(step => commandTokens(step.command!).some(token => /^(?:--(?:override-ini|ignore|deselect|confcutdir|noconftest)|-o)(?:=|$)/.test(token)))) throw new Error('对照命令不允许覆盖测试配置或忽略用例。');
  if (patch.files.some(file => dependencyPath.test(file.path))) throw new Error('对照暂不支持修改依赖清单，请下载补丁后另行验证依赖变化。');
  if (patch.files.some(file => /(^|\/)(?:pytest\.ini|setup\.cfg|tox\.ini)$|(^|\/)(?:\.repocare-python|\.git|\.pytest_cache)(?:\/|$)/.test(file.path))) throw new Error('对照不允许修改执行配置、依赖目录或版本控制目录。');
  const rawRequirements = verificationRequirementsSchema.parse(input.requirements);
  const explicitTests = new Set(rawRequirements.flatMap(requirement => {
    const selectors = commandTokens(requirement.command).filter(token => /^[A-Za-z0-9_./-]+\.py::[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)?(?:\[[^\r\n]*\])?$/.test(token));
    if (selectors.length !== 1) throw new Error('每条要求需使用一个明确的 pytest 文件.py::用例节点，额外回归命令可运行完整测试集。');
    return selectors.map(selector => repositoryPath(`${plan.workingDirectory && plan.workingDirectory !== '.' ? `${plan.workingDirectory}/` : ''}${selector.split('::')[0].replace(/^\.\//, '')}`));
  }));
  const isShared = (file: AgentPatchFile) => testPath(file.path) || explicitTests.has(file.path);
  const shared = patch.files.filter(isShared);
  const production = patch.files.filter(file => !isShared(file));
  if (!production.length) throw new Error('补丁只有测试改动，不能形成生产代码改进对照。');
  patch.files.forEach(file => repositoryPath(file.path));
  const requirements: VerificationRequirement[] = rawRequirements.map((requirement, index) => {
    const source = sources(item).find(source => source.text?.includes(requirement.quote));
    if (!source) throw new Error(`需求 ${index + 1} 的引用未匹配当前问题或关联 Issue 原文。`);
    if (!plan.steps.some(step => step.command === requirement.command)) throw new Error(`需求 ${index + 1} 的测试命令不在验证计划中。`);
    if (requirement.changedPaths.some(path => !production.some(file => file.path === path))) throw new Error(`需求 ${index + 1} 的改动路径不在生产补丁中。`);
    return { ...requirement, source: source.label, id: `R${index + 1}-${verificationHash(requirement).slice(0, 10)}` };
  });
  if (new Set(requirements.map(requirement => requirement.quote)).size !== requirements.length) throw new Error('请合并重复的需求原文。');
  const writes = (files: AgentPatchFile[]): ReproductionStep[] => files.map(file => ({ type: 'create-file', path: file.path, content: file.after }));
  const baseline = validateReproductionPlan({ ...plan, setup: [...plan.setup, ...writes(shared)] });
  const patched = validateReproductionPlan({ ...plan, setup: [...plan.setup, ...writes(shared), ...writes(production)] });
  const baseSha = task.kind === 'pr' ? item.baseSha : task.commitSha;
  if (!baseSha || !/^[a-f0-9]{40}$/i.test(baseSha)) throw new Error('无法固定对照的原始版本。');
  const regressionCommands = plan.steps.map(step => step.command!).filter(command => !requirements.some(requirement => requirement.command === command));
  const inputs = { baseSha, headSha: task.kind === 'pr' ? item.headSha : undefined, patchId: patch.id, productionHash: verificationHash(production), sharedTestsHash: verificationHash(shared), planHash: verificationHash(baseline), patchedPlanHash: verificationHash(patched), policyRevision: input.policyRevision, sourceUpdatedAt: task.sourceUpdatedAt!, sourceFingerprint: verificationSourceFingerprint(item), requirements, sharedTestPaths: shared.map(file => file.path), regressionCommands };
  const verification: VerificationContext = { ...inputs, pairId: randomUUID(), fingerprint: verificationHash(inputs) };
  return { baseline, patched, verification };
}

/** Read every changed file at pinned revisions; partial PRs cannot become execution claims. */
export async function pullVerificationFiles(owner: string, repoUrl: string, item: GitItem, signal?: AbortSignal): Promise<AgentPatchFile[]> {
  if (!item.baseSha || !item.headSha || !item.files?.length || item.filesTruncated || item.files.length > 4 || item.totalChangedFiles !== item.files.length) throw new Error('PR 对照当前限完整可读且至多四个文件的改动；大 PR 请继续使用证据审查。');
  const files: AgentPatchFile[] = [];
  for (const file of item.files) {
    repositoryPath(file.path);
    if (!['modified', 'added'].includes(file.status)) throw new Error('PR 对照暂不支持删除、重命名或二进制文件。');
    const read = async (sha: string) => {
      const raw = await githubApi(owner, `${repoPath(repoUrl)}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, { signal });
      if (raw.type !== 'file' || raw.encoding !== 'base64' || raw.size > 20000) throw new Error('PR 对照文件必须是至多 20KB 的普通文本。');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw.content, 'base64'));
      if (content.includes('\0') || /(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) throw new Error('文件含二进制或疑似凭据，未准备对照。');
      return content;
    };
    files.push({ path: file.path, before: file.status === 'added' ? '' : await read(item.baseSha), after: await read(item.headSha), created: file.status === 'added' });
  }
  return files;
}
