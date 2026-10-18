import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentArtifact, AgentPatchFile } from '@/contracts/agent';
import { getTask } from './store';
import { assertReadableSource } from './repository';
import { activePolicy } from '../workbench/policy';
import { createReproductionJob, getReproductionJob, workbenchDb } from '../workbench/store';
import { maintenanceTestPlan, prepareMaintenanceVerification, testPath, verificationHash } from '../workbench/maintenance-verification';
import type { GitItem } from '@/contracts/workbench';
import { dependencyCommand } from '../../../reproduction/commands.mjs';

const testName = z.string().regex(/^test_[A-Za-z0-9_]+$/);
export const acceptanceInputSchema = z.object({
  artifactId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), updatedAt: z.string(),
  content: z.string().min(10).max(20000), note: z.string().trim().min(8).max(500),
  declaration: z.enum(['withheld', 'reviewed-candidate']),
  targets: z.array(z.object({ requirementId: z.string().max(40), testName, failureSignal: z.string().trim().min(5).max(200) }).strict()).min(1).max(8),
  normalTests: z.array(testName).min(1).max(8),
  setupCommands: z.array(z.string().min(1).max(500)).max(4).optional(),
}).strict();

/** Human-supplied checks are a separate pair; model plans and their results stay intact. */
export function prepareAcceptance(owner: string, taskId: string, value: unknown) {
  const input = acceptanceInputSchema.parse(value), db = workbenchDb();
  assertReadableSource(input.content);
  if (Buffer.byteLength(input.content) > 20000) throw new Error('验收测试最多 20KB。');
  db.exec('BEGIN IMMEDIATE');
  try {
    const task = getTask(owner, taskId);
    if (!task || task.updatedAt !== input.updatedAt || ['queued', 'running', 'cancelled'].includes(task.status)) throw new Error('任务已变化，请等待调查结束并刷新。');
    const parent = task.artifacts.find(a => a.id === input.artifactId && a.kind === 'verification' && !a.superseded);
    const context = parent?.verification;
    if (!context || context.fingerprint !== input.fingerprint || context.policyRevision !== (activePolicy(owner, task.repoUrl)?.revision || 0)) throw new Error('原方案或项目规则已变化，请重新准备。');
    const originalJobs = (parent.jobIds || []).map(id => getReproductionJob(owner, id));
    if (originalJobs.length !== 2 || originalJobs.some(job => job.agentTaskId !== task.id || job.verification?.fingerprint !== context.fingerprint || ['queued', 'running'].includes(job.status))) throw new Error('原对照正在执行或记录不完整，请稍后准备验收。');
    const baseline = originalJobs.find(job => job.verificationRole === 'baseline');
    const patched = originalJobs.find(job => job.verificationRole === 'patched');
    if (!baseline || !patched || originalJobs.some(job => job.repoUrl !== task.repoUrl || job.commitSha !== context.baseSha)
      || verificationHash(baseline.plan) !== context.planHash || verificationHash(patched.plan) !== context.patchedPlanHash) throw new Error('原对照版本或计划指纹不匹配，请重新准备。');
    const patch = task.artifacts.find(a => a.id === parent.patchId && !a.superseded);
    if (!patch?.files?.length || patch.id !== context.patchId) throw new Error('原候选补丁不可用。');
    const previous = task.artifacts.filter(a => a.kind === 'acceptance');
    if (previous.flatMap(a => a.jobIds || []).some(id => ['queued', 'running'].includes(getReproductionJob(owner, id).status))) throw new Error('已有验收正在执行，请等待结束。');
    if (previous.length >= 3 || task.artifacts.length >= 12) throw new Error('验收方案已达到保存上限，请新建任务。');
    if (new Set(input.targets.map(target => target.requirementId)).size !== input.targets.length) throw new Error('每条要求只安排一个目标验收节点。');
    const names = [...input.targets.map(target => target.testName), ...input.normalTests];
    if (new Set(names).size !== names.length) throw new Error('目标与正常行为测试节点不能重复。');
    if (names.some(name => !new RegExp(`^def ${name}\\s*\\(`, 'm').test(input.content))) throw new Error('请提供每个节点对应的顶层 pytest 测试函数。');
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const path = `repocare_acceptance_${randomUUID().replaceAll('-', '')}.py`;
    const command = (name: string) => `python3 -m pytest ${path}::${name} -q`;
    const production = patch.files.filter(file => !testPath(file.path) && !context.sharedTestPaths.includes(file.path));
    if (!production.length || production.length > 3) throw new Error('验收对照支持至多三个生产文件及一个独立测试文件。');
    if (verificationHash(production) !== context.productionHash) throw new Error('生产补丁指纹已变化，请重新准备原对照。');
    const files: AgentPatchFile[] = [...production, { path, before: '', after: input.content, created: true }];
    const requirements = input.targets.map(target => {
      const requirement = context.requirements.find(r => r.id === target.requirementId);
      if (!requirement) throw new Error('验收要求不属于当前方案。');
      return { text: requirement.text, quote: requirement.quote, changedPaths: requirement.changedPaths, command: command(target.testName), failureSignal: target.failureSignal };
    });
    const row = db.prepare('SELECT internal FROM maintenance_tasks WHERE owner=? AND id=?').get(owner, taskId) as { internal: string };
    const cached = JSON.parse(row.internal).cache;
    if (cached.visibility !== 'public') throw new Error('隔离验收仅支持公开仓库。');
    const item: GitItem = JSON.parse(cached.item || '{}');
    const commands = input.setupCommands ?? baseline.plan.setup.filter(step => step.type === 'run-command').map(step => step.command!);
    if (commands.some(command => !/^python3? -m pip /.test(command) || !dependencyCommand(command))) throw new Error('人工验收准备仅支持已声明的受限 Python 依赖安装。');
    const plan = maintenanceTestPlan({ requirements, regressionCommands: input.normalTests.map(command), setupCommands: commands, missingInformation: baseline.plan.missingInformation, scopeLimitations: [...(baseline.plan.scopeLimitations || []), '人工提供验收只覆盖本方案所列行为；独立性来自提交者声明。'] });
    plan.environment = structuredClone(baseline.plan.environment);
    if (baseline.plan.workingDirectory && baseline.plan.workingDirectory !== '.') throw new Error('人工验收暂限根目录执行的计划。');
    const prepared = prepareMaintenanceVerification({ task, item, patch: { ...patch, files }, plan, requirements, policyRevision: context.policyRevision });
    const source = { kind: 'maintainer-supplied' as const, declaration: input.declaration, note: input.note, recordedAt: new Date().toISOString(), testPath: path, contentHash, parentFingerprint: context.fingerprint };
    prepared.verification.acceptanceSource = source;
    prepared.verification.fingerprint = verificationHash({ ...prepared.verification, pairId: undefined, fingerprint: undefined });
    const jobs = [prepared.baseline, prepared.patched].map((plan, index) => createReproductionJob(owner, { repoUrl: task.repoUrl, branch: baseline.branch, commitSha: context.baseSha, issueNumber: task.number!, sourceUpdatedAt: task.sourceUpdatedAt!, agentTaskId: task.id, plan, verificationRole: index ? 'patched' : 'baseline', verification: prepared.verification }));
    previous.forEach(a => { a.superseded = true; });
    const artifact: AgentArtifact = { id: randomUUID(), kind: 'acceptance', title: '人工提供的验收对照', createdAt: source.recordedAt, revision: previous.length + 1, patchId: patch.id, evidenceIds: [...parent.evidenceIds], verification: prepared.verification, jobIds: jobs.map(job => job.id), files: [files.at(-1)!] };
    task.artifacts.push(artifact);
    task.updatedAt = source.recordedAt;
    task.events.push({ at: source.recordedAt, message: '人工验收方案已保存，未执行；原模型方案与结果保留。' });
    task.events = task.events.slice(-120);
    db.prepare('UPDATE maintenance_tasks SET state=? WHERE owner=? AND id=?').run(JSON.stringify(task), owner, task.id);
    db.exec('COMMIT'); return task;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
