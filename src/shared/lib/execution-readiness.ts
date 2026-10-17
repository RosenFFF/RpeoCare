import type { PrerequisiteReview } from '@/contracts/execution-readiness';
import type { MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob, ReproductionPlan } from '@/contracts/workbench';
export const requiresPythonPreflight = (plan: ReproductionPlan) => plan.mode === 'test' && (plan.environment.language?.toLowerCase() === 'python' || plan.steps.some(step => /^(?:python3?\s+-m\s+)?pytest\b/.test(step.command || '')));

export function reviewedPrerequisites(source: string[], sourceKey: string, reviews?: PrerequisiteReview[]) {
  const review = reviews?.at(-1);
  const valid = review?.sourceKey === sourceKey && JSON.stringify(review.source) === JSON.stringify(source)
    && new Set(review.scopeEntries.map(entry => entry.index)).size === review.scopeEntries.length
    && review.scopeEntries.every(entry => Number.isInteger(entry.index) && entry.index >= 0 && entry.index < source.length && entry.reason.trim());
  const entries = valid ? review.scopeEntries : [];
  return { blockers: source.filter((_, index) => !entries.some(entry => entry.index === index)),
    scope: entries.map(entry => ({ text: source[entry.index], reason: entry.reason })), review: valid ? review : undefined };
}
export const planPrerequisites = (job: ReproductionJob) => reviewedPrerequisites(job.plan.missingInformation, job.id, job.prerequisiteReviews);
export const reportReviewKey = (task: MaintenanceTask) => `${task.id}:report:${task.reportRevision || 0}`;
export const reportPrerequisites = (task: MaintenanceTask) => reviewedPrerequisites(task.report?.missingInformation || [], reportReviewKey(task), task.prerequisiteReviews);

export function preflightReadiness(job: ReproductionJob, jobs: ReproductionJob[]) {
  const check = jobs.find(candidate => candidate.id === job.preflightJobId && candidate.purpose === 'environment-preflight' && candidate.preflightForJobId === job.id);
  if (!check) return { state: 'missing' as const, label: '尚未检查运行环境', check };
  if (['queued', 'running'].includes(check.status)) return { state: 'running' as const, label: '正在检查运行环境', check };
  if (!['reproduced', 'blocked'].includes(check.status) || !check.preflight || check.preflight.commitSha !== job.commitSha) return { state: 'unknown' as const, label: '预检未完成，请查看原因', check };
  const checkedAt = Date.parse(check.preflight.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() + 60000 || Date.now() - checkedAt > 30 * 60000) return { state: 'unknown' as const, label: '预检已过期，请重新检查', check };
  return { state: check.preflight.status, label: ({ ready: '已检查所列环境条件', review: '环境检查有待核对项', blocked: '运行环境存在阻塞' })[check.preflight.status], check };
}
