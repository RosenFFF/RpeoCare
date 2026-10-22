import { createHash } from 'node:crypto';
import type { ActivityItem, ActivityState, ProjectActivity } from '@/contracts/activity';
import type { AuditRun } from '@/contracts/audit';
import type { Draft, ReproductionJob } from '@/contracts/workbench';
import { maintenanceWorkflow } from '@/shared/lib/maintenance-workflow';
import { verificationDecision } from '@/shared/lib/maintenance-verification';
import { planPrerequisites, preflightReadiness, reportPrerequisites } from '@/shared/lib/execution-readiness';
import { agentWorkerOnline, listTasks } from '../agent/store';
import { listSettings } from '../models/store';
import { reproductionWorkerOnline } from '../reproduction/queue';
import { getProject, workbenchDb } from './store';
import { activePolicy } from './policy';
import { recentReviewTasks } from './review-task-store';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const priority: Record<ActivityState, number> = { attention: 0, review: 1, running: 2, complete: 3 };

/** Read-only summaries of saved work. This never starts a model or a repository request. */
export function getProjectActivity(owner?: string): ProjectActivity {
  const empty: ProjectActivity = { scope: '', repoUrl: null, branch: '', items: [], modelConfigured: false, workerOnline: false, sandboxConfigured: false, reproductionWorkerOnline: false };
  if (!owner) return empty;
  const project = getProject(owner);
  if (!project) return empty;
  const db = workbenchDb(), items: ActivityItem[] = [];
  const branch = project.branch || '';
  const add = (item: Omit<ActivityItem, 'revision'>, version = '') => items.push({ ...item, revision: hash(JSON.stringify([item.id, item.state, item.title, item.action, version])) });
  const tasks = listTasks(owner, project.repoUrl, branch);
  const policyRevision = activePolicy(owner, project.repoUrl)?.revision || 0;
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = JSON.stringify([task.kind, task.number || 0, task.anchor || '']);
    if (seen.has(key)) continue;
    seen.add(key);
    if (task.status === 'cancelled') continue;
    task.artifacts.forEach(artifact => {
      if (artifact.verification) artifact.verificationStale = artifact.verification.policyRevision !== policyRevision || !!artifact.superseded
        || !!artifact.verification.acceptanceSource && !task.artifacts.some(parent => parent.kind === 'verification' && !parent.superseded && parent.verification?.fingerprint === artifact.verification!.acceptanceSource!.parentFingerprint);
    });
    const jobs = (db.prepare("SELECT state FROM reproduction_jobs WHERE owner=? AND repo_url=? AND json_extract(state,'$.agentTaskId')=?").all(owner, project.repoUrl, task.id) as { state: string }[]).map(row => JSON.parse(row.state) as ReproductionJob);
    const flow = maintenanceWorkflow(task, jobs);
    const decision = flow.verification?.verification ? verificationDecision(flow.verification.verification, jobs, flow.outdated) : null;
    const running = ['queued', 'running'].includes(task.status) || flow.relevantJobs.some(job => ['queued', 'running'].includes(job.status));
    const blocked = flow.outdated || ['failed', 'paused', 'waiting-input'].includes(task.status) || reportPrerequisites(task).blockers.length > 0
      || flow.relevantJobs.some(job => planPrerequisites(job).blockers.length > 0 || ['blocked', 'unsafe', 'failed', 'not-reproduced'].includes(job.status)
        || job.status === 'awaiting-confirmation' && preflightReadiness(job, jobs).state === 'blocked');
    // A baseline's expected failure is not itself a regression. The paired assessment owns that distinction.
    const paired = !!flow.verification?.verification;
    const pairedProblem = paired && (!['improved', 'pending', 'unconfirmed'].includes(flow.assessment?.state || 'unknown') || decision?.tone === 'danger');
    const waiting = flow.relevantJobs.some(job => job.status === 'awaiting-confirmation');
    const effectiveBlocked = paired ? flow.outdated || ['failed', 'paused', 'waiting-input'].includes(task.status) || reportPrerequisites(task).blockers.length > 0
      || flow.relevantJobs.some(job => planPrerequisites(job).blockers.length > 0 || job.status === 'awaiting-confirmation' && preflightReadiness(job, jobs).state === 'blocked') || pairedProblem : blocked;
    const state: ActivityState = running ? 'running' : effectiveBlocked ? 'attention' : waiting ? 'review' : task.status === 'completed' ? 'complete' : 'review';
    const label = task.kind === 'issue' ? `Issue #${task.number}` : task.kind === 'pr' ? `PR #${task.number}` : task.kind === 'docs' ? '文档调查' : '项目调查';
    const href = task.kind === 'issue' ? `/issues?number=${task.number}` : task.kind === 'pr' ? `/pull-requests?number=${task.number}` : task.kind === 'docs' ? '/improvements' : '/audit';
    const updatedAt = [task.updatedAt, ...jobs.map(job => job.updatedAt)].sort().at(-1)!;
    const showDecision = decision && !running && !waiting;
    add({ id: `task:${task.id}`, title: `${label} · ${showDecision ? decision.title : flow.next.title}`, detail: showDecision ? decision.detail : state === 'complete' ? '阶段记录已保存，请核对目标结果、回归与未覆盖范围。' : flow.next.detail, href, action: state === 'running' ? '查看进度' : state === 'complete' ? '查看结果' : '继续处理', state, updatedAt }, JSON.stringify([flow.verification?.id, flow.assessment?.state, task.artifacts.filter(a => !a.superseded).map(a => a.id)]));
  }
  const auditRow = db.prepare("SELECT state FROM audit_runs WHERE owner=? AND json_extract(state,'$.repoUrl')=? AND COALESCE(json_extract(state,'$.branch'),'')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(owner, project.repoUrl, branch) as { state: string } | undefined;
  if (auditRow) {
    const run = JSON.parse(auditRow.state) as AuditRun;
    if (run.status !== 'cancelled') {
      const state = run.status === 'completed' ? 'complete' : run.status === 'failed' ? 'attention' : 'running';
      add({ id: `audit:${run.id}`, title: state === 'complete' ? '项目体检已完成' : state === 'attention' ? '项目体检需要处理' : '项目体检正在进行', detail: state === 'complete' ? '打开报告，查看检查依据与待完善项。' : '打开执行记录，查看当前进度或失败原因。', href: `/audit?run=${encodeURIComponent(run.id)}`, action: state === 'complete' ? '查看报告' : '查看记录', state, updatedAt: run.updatedAt || run.createdAt });
    }
  }
  const drafts = (db.prepare("SELECT state FROM drafts WHERE owner=? AND json_extract(state,'$.repoUrl')=? AND (json_extract(state,'$.kind')!='file' OR ?='' OR COALESCE(json_extract(state,'$.branch'),'')=?) AND COALESCE(json_extract(state,'$.archived'),0)=0 AND json_extract(state,'$.status') IN ('draft','uncertain','publishing') ORDER BY rowid DESC LIMIT 30").all(owner, project.repoUrl, branch, branch) as { state: string }[]).map(row => JSON.parse(row.state) as Draft);
  for (const draft of drafts) add({ id: `draft:${draft.id}`, title: draft.title, detail: draft.status === 'uncertain' ? '发布结果尚未确认，请先核对远端状态，避免重复提交。' : draft.status === 'publishing' ? '正在提交已确认的内容。' : '草稿已保存，审阅内容与来源后再决定是否交付。', href: `/improvements?draft=${encodeURIComponent(draft.id)}`, action: '审阅草稿', state: draft.status === 'uncertain' ? 'attention' : draft.status === 'publishing' ? 'running' : 'review', updatedAt: draft.createdAt }, String(draft.revision));
  const standalone = (db.prepare("SELECT state FROM reproduction_jobs WHERE owner=? AND repo_url=? AND (?='' OR COALESCE(json_extract(state,'$.branch'),'')=?) AND json_extract(state,'$.agentTaskId') IS NULL AND COALESCE(json_extract(state,'$.purpose'),'')!='environment-preflight' ORDER BY created_at DESC,rowid DESC LIMIT 30").all(owner, project.repoUrl, branch, branch) as { state: string }[]).map(row => JSON.parse(row.state) as ReproductionJob);
  const seenJobs = new Set<string>();
  for (const job of standalone) {
    const key = JSON.stringify([job.purpose, job.issueNumber, job.branch || '']);
    if (seenJobs.has(key)) continue;
    seenJobs.add(key);
    if (job.status === 'cancelled' || job.status === 'draft') continue;
    const journey = job.purpose === 'contributor-journey';
    const state: ActivityState = ['queued', 'running'].includes(job.status) ? 'running' : job.status === 'awaiting-confirmation' ? 'review' : ['blocked', 'unsafe', 'failed'].includes(job.status) ? 'attention' : 'complete';
    add({ id: `execution:${job.id}`, title: journey ? '贡献路径验证' : `Issue #${job.issueNumber} · 复现记录`, detail: state === 'review' ? '计划尚未执行，需要你核对后确认。' : state === 'complete' ? '执行已结束，请查看判据、日志与实际结果。' : state === 'attention' ? '执行未能完成，打开记录查看阻塞与恢复办法。' : '隔离执行正在进行，结果会保留在原任务。', href: journey ? `/audit?run=${encodeURIComponent(job.auditRunId || '')}&tab=journey` : `/issues?number=${job.issueNumber}`, action: state === 'review' ? '审阅计划' : '查看记录', state, updatedAt: job.updatedAt }, job.status);
  }
  const seenReviews = new Set<number>();
  for (const review of recentReviewTasks(owner, project.repoUrl)) {
    if (seenReviews.has(review.number)) continue;
    seenReviews.add(review.number);
    if (review.status === 'cancelled') continue;
    const stale = review.status === 'stale' || (review.policyRevision || 0) !== policyRevision;
    const state: ActivityState = stale || review.status === 'partial' ? 'attention' : review.status === 'completed' ? 'complete' : 'running';
    add({ id: `review:${review.id}`, title: `PR #${review.number} · ${stale ? '审查依据需要更新' : state === 'attention' ? '部分审查未完成' : state === 'complete' ? '审查结果已保存' : '正在审查变更'}`,
      detail: stale ? '项目规则或审查上下文已变化，请打开 PR 重新核对。' : state === 'attention' ? '保留已完成部分，打开 PR 查看失败块与未审范围。' : '审查只覆盖记录的固定版本，不代表测试通过或允许合并。',
      href: `/pull-requests?number=${review.number}`, action: '查看审查', state, updatedAt: review.updatedAt }, state === 'running' ? review.status : JSON.stringify(review.blocks.map(block => [block.id, block.status, block.attempts])));
  }
  // Drafts and independent jobs store resolved branches, while an unselected project branch means default.
  // Without a network request that default cannot be inferred; identify the saved branch explicitly.
  if (!branch) for (const item of items) {
    const savedBranch = item.id.startsWith('draft:') ? drafts.find(draft => item.id === `draft:${draft.id}`)?.branch
      : item.id.startsWith('execution:') ? standalone.find(job => item.id === `execution:${job.id}`)?.branch : undefined;
    if (savedBranch) item.detail = `记录分支：${savedBranch}。${item.detail}`;
  }
  const settings = listSettings(owner);
  return { scope: hash(JSON.stringify([owner, project.repoUrl, branch])), repoUrl: project.repoUrl, branch,
    items: items.sort((a, b) => priority[a.state] - priority[b.state] || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30),
    modelConfigured: Boolean(settings.defaultId || settings.environmentConfigured), workerOnline: agentWorkerOnline(),
    sandboxConfigured: process.env.REPOCARE_REPRO_ENABLED === 'true', reproductionWorkerOnline: reproductionWorkerOnline() };
}
