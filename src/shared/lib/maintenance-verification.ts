import type { VerificationContext, VerificationAssessment, RequirementOutcome } from '@/contracts/maintenance-verification';
import type { ReproductionJob } from '@/contracts/workbench';

export const requirementOutcomeLabels: Record<RequirementOutcome, string> = {
  unconfirmed: '待核对要求', pending: '等待执行', blocked: '环境受阻', improved: '观察到改进', 'still-failing': '改动后仍失败', 'not-demonstrated': '未证明改进', inconclusive: '证据不足', stale: '版本已过期',
};
export const executionFailureLabels = { source: '快照准备失败', sandbox: '沙箱未就绪', dependencies: '依赖准备或导入失败', collection: '测试收集或调用失败', assertion: '测试断言失败', setup: '准备步骤失败', timeout: '执行超时', unknown: '原因未确定' };

export function assessVerification(context: VerificationContext, jobs: ReproductionJob[], stale = false): VerificationAssessment {
  const baseline = jobs.find(job => job.verificationRole === 'baseline' && job.verification?.pairId === context.pairId);
  const patched = jobs.find(job => job.verificationRole === 'patched' && job.verification?.pairId === context.pairId);
  const requirements = context.requirements.map(requirement => {
    const answer = (outcome: RequirementOutcome, reason: string) => ({ requirement, outcome, reason });
    if (stale) return answer('stale', '输入或规则已变化，请基于新版本重新准备。');
    if (!baseline || !patched) return answer('inconclusive', '两组执行记录不完整。');
    if ([baseline, patched].some(job => !job.verification?.confirmedAt || !job.verification.confirmedRequirementIds?.includes(requirement.id))) return answer('unconfirmed', '需在两组执行前核对需求、测试内容及故障信号。');
    if ([baseline, patched].some(job => ['awaiting-confirmation', 'queued', 'running'].includes(job.status))) return answer('pending', '两组结果就绪后再判断。');
    if ([baseline, patched].some(job => job.status === 'blocked')) return answer('blocked', '环境或测试收集受阻，不能据此判断目标问题。');
    if ([baseline, patched].some(job => ['failed', 'unsafe', 'cancelled'].includes(job.status))) return answer('inconclusive', '执行未完成，保留已有记录。');
    if ([baseline, patched].some(job => job.verification?.fingerprint !== context.fingerprint || job.commitSha !== context.baseSha || !job.totalAttempts || job.attemptHistory.length !== job.totalAttempts)) return answer('inconclusive', '计划、版本或尝试记录不完整。');
    const attempts = [...baseline.attemptHistory, ...patched.attemptHistory];
    const environments = new Set(attempts.map(attempt => attempt.environmentFingerprint));
    if (environments.size !== 1 || environments.has(undefined)) return answer('inconclusive', '两组环境指纹未知或不一致，不能做同条件对照。');
    const original = baseline.attemptHistory.map(attempt => attempt.steps?.find(step => step.phase === 'verify' && step.command === requirement.command));
    const changed = patched.attemptHistory.map(attempt => attempt.steps?.find(step => step.phase === 'verify' && step.command === requirement.command));
    if (original.some(step => !step) || changed.some(step => !step)) return answer('inconclusive', '未找到该要求对应的逐次命令结果。');
    if (changed.some(step => step?.code !== 0 || !step.ok)) return answer('still-failing', '至少一次改动后目标用例未通过。');
    if (!original.every(step => step?.code === 1 && step.failureKind === 'assertion' && `${step.stdout || ''}\n${step.stderr || ''}`.includes(requirement.failureSignal))) return answer('not-demonstrated', '原版未稳定命中已确认的断言信号，不能归因于本次改动。');
    if (patched.status !== 'reproduced') return answer('inconclusive', '目标用例通过，但计划内其他验证仍未全部通过。');
    return answer('improved', '同测试、同环境下，原版命中约定故障，改动版的计划内命令全部通过。');
  });
  const order: RequirementOutcome[] = ['stale', 'unconfirmed', 'pending', 'blocked', 'inconclusive', 'still-failing', 'not-demonstrated', 'improved'];
  const state = order.find(state => requirements.some(requirement => requirement.outcome === state)) || 'inconclusive';
  return { state, reason: requirements.find(requirement => requirement.outcome === state)?.reason || '没有需求记录。', requirements,
    limitations: ['结果仅适用于记录的需求、版本、测试和判据；需求与改动的语义对应仍需人工核对。', '测试由项目或候选方案提供；同一测试通过不证明系统没有其他缺陷。', ...(context.sharedTestPaths.length ? [] : ['本次复用原仓库测试，没有额外共享测试改动。']), ...(context.regressionCommands?.length ? [] : ['未安排额外的独立验证命令，不能据此声称其他行为未受影响。'])] };
}
