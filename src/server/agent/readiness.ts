import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrerequisiteReview } from '@/contracts/execution-readiness';
import type { ReproductionJob } from '@/contracts/workbench';
import { planPrerequisites, reportPrerequisites, reportReviewKey, requiresPythonPreflight } from '@/shared/lib/execution-readiness';
import { getTask } from './store';
import { getReproductionJob, updateReproductionJob, workbenchDb } from '../workbench/store';
import { activePolicy } from '../workbench/policy';

export const readinessHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeEntry = z.object({ index: z.number().int().min(0).max(19), reason: z.string().trim().min(8).max(500) }).strict();
export const prerequisiteReviewSchema = z.object({ updatedAt: z.string(), artifactId: z.string().uuid(), fingerprint: z.string().min(1).max(100),
  planScopes: z.array(scopeEntry).max(20), reportScopes: z.array(scopeEntry).max(12) }).strict();

function currentProposal(owner: string, taskId: string, artifactId: string, fingerprint: string) {
  const task = getTask(owner, taskId);
  if (!task || ['queued', 'running', 'cancelled'].includes(task.status)) throw new Error('请先等待调查结束并刷新当前方案。');
  const artifact = task.artifacts.find(item => item.id === artifactId && !item.superseded && item.jobIds?.length);
  if (!artifact || (artifact.verification?.fingerprint || artifact.fingerprint) !== fingerprint) throw new Error('方案已变化，请重新核对当前版本。');
  if (artifact.verification && artifact.verification.policyRevision !== (activePolicy(owner, task.repoUrl)?.revision || 0)) throw new Error('项目规则已变化，请重新准备方案。');
  const jobs = artifact.jobIds!.map(id => getReproductionJob(owner, id));
  if (jobs.some(job => job.agentTaskId !== task.id || job.repoUrl !== task.repoUrl)) throw new Error('只有尚未确认执行的当前计划可以复核。');
  return { task, artifact, jobs };
}

/** Explicit human classification, retained separately from immutable model plans. */
export function reviewPrerequisites(owner: string, taskId: string, value: unknown) {
  const input = prerequisiteReviewSchema.parse(value), database = workbenchDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const { task, jobs } = currentProposal(owner, taskId, input.artifactId, input.fingerprint);
    if (task.updatedAt !== input.updatedAt) throw new Error('任务记录已更新，请刷新后复核。');
    if (jobs.some(job => job.status !== 'awaiting-confirmation')) throw new Error('只有尚未确认执行的当前计划可以复核。');
    const now = new Date().toISOString();
    const create = (source: string[], sourceKey: string, entries: { index: number; reason: string }[], previous: PrerequisiteReview[] = [], planHash?: string) => {
      if (previous.length >= 10) throw new Error('复核记录达到上限，请新建范围明确的任务。');
      if (new Set(entries.map(entry => entry.index)).size !== entries.length || entries.some(entry => entry.index >= source.length)) throw new Error('复核条目已变化或重复。');
      return [...previous, { sourceKey, source: [...source], scopeEntries: entries, reviewedAt: now, ...(planHash ? { planHash } : {}) }];
    };
    if (jobs.some(job => JSON.stringify(job.plan.missingInformation) !== JSON.stringify(jobs[0].plan.missingInformation))) throw new Error('两组前置条件不同，请分别准备一致的方案。');
    task.prerequisiteReviews = create(task.report?.missingInformation || [], reportReviewKey(task), input.reportScopes, task.prerequisiteReviews);
    const reviewed = jobs.map(job => updateReproductionJob(owner, job.id, { prerequisiteReviews: create(job.plan.missingInformation, job.id, input.planScopes, job.prerequisiteReviews, readinessHash(job.plan)) }));
    if (task.status === 'waiting-input' && !reportPrerequisites(task).blockers.length && reviewed.every(job => !planPrerequisites(job).blockers.length)) task.status = 'awaiting-confirmation';
    task.updatedAt = now;
    task.events.push({ at: now, message: '维护者复核前置条件；原计划保留，执行仍需单独确认。' });
    task.events = task.events.slice(-120);
    database.prepare('UPDATE maintenance_tasks SET state=?,status=? WHERE owner=? AND id=?').run(JSON.stringify(task), task.status, owner, task.id);
    database.exec('COMMIT'); return task;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function requestEnvironmentPreflight(owner: string, taskId: string, input: { artifactId: string; fingerprint: string; jobId: string }) {
  const database = workbenchDb(); database.exec('BEGIN IMMEDIATE');
  try {
    const { task, jobs } = currentProposal(owner, taskId, input.artifactId, input.fingerprint), source = jobs.find(job => job.id === input.jobId);
    if (!source || source.status !== 'awaiting-confirmation' || !requiresPythonPreflight(source.plan)) throw new Error('当前预检仅支持当前方案的Python测试计划。');
    if (source.preflightJobId) {
      const existing = getReproductionJob(owner, source.preflightJobId);
      if (['queued', 'running'].includes(existing.status)) { database.exec('COMMIT'); return existing; }
    }
    const count = database.prepare("SELECT count(*) AS n FROM reproduction_jobs WHERE owner=? AND repo_url=? AND status IN ('queued','running')").get(owner, task.repoUrl) as { n: number };
    if (count.n >= 2) throw new Error('当前项目已有两个执行或预检任务，请稍后重试。');
    const now = new Date().toISOString();
    const job: ReproductionJob = { id: randomUUID(), repoUrl: source.repoUrl, branch: source.branch, commitSha: source.commitSha, issueNumber: source.issueNumber, sourceUpdatedAt: source.sourceUpdatedAt,
      agentTaskId: task.id, purpose: 'environment-preflight', preflightForJobId: source.id, plan: source.plan, status: 'queued', phase: 'source',
      progress: '等待固定Runner检查环境；不安装依赖、不运行项目代码。', totalAttempts: 1, totalSteps: 0, attempts: 0, successfulAttempts: 0, attemptHistory: [], artifacts: [], createdAt: now, updatedAt: now };
    database.prepare('INSERT INTO reproduction_jobs VALUES (?,?,?,?,?,?,?,?)').run(job.id, owner, job.repoUrl, job.issueNumber, job.status, JSON.stringify(job), now, now);
    updateReproductionJob(owner, source.id, { preflightJobId: job.id });
    database.exec('COMMIT'); return job;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function assertEnvironmentPreflight(owner: string, job: ReproductionJob, review?: { preflightId: string; confirmed: boolean; prerequisiteReviewedAt?: string }) {
  if (!review?.confirmed || review.preflightId !== job.preflightJobId) throw new Error('请先检查并核对当前计划的运行环境。');
  const check = getReproductionJob(owner, review.preflightId), result = check.preflight;
  if (check.purpose !== 'environment-preflight' || check.preflightForJobId !== job.id || check.status !== 'reproduced' || !result || result.status === 'blocked'
    || result.planHash !== readinessHash(job.plan) || result.commitSha !== job.commitSha || !Number.isFinite(Date.parse(result.checkedAt)) || Date.parse(result.checkedAt) > Date.now() + 60000 || Date.now() - Date.parse(result.checkedAt) > 30 * 60_000) throw new Error('预检未完成、存在阻塞或已经过期，请重新检查环境。');
  if (review.prerequisiteReviewedAt !== job.prerequisiteReviews?.at(-1)?.reviewedAt) throw new Error('前置条件复核已更新，请重新审阅。');
  return result;
}
