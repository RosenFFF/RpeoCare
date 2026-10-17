import type { VerificationContext, VerificationAssessment, RequirementOutcome } from '@/contracts/maintenance-verification';
import type { ReproductionJob } from '@/contracts/workbench';

export const requirementOutcomeLabels: Record<RequirementOutcome, string> = {
  unconfirmed: '待核对要求', pending: '等待执行', blocked: '环境受阻', improved: '观察到改进', 'still-failing': '改动后仍失败', 'not-demonstrated': '未证明改进', inconclusive: '证据不足', stale: '版本已过期',
};
export const executionFailureLabels = { source: '快照准备失败', sandbox: '沙箱未就绪', dependencies: '依赖准备或导入失败', collection: '测试收集或调用失败', assertion: '测试断言失败', setup: '准备步骤失败', timeout: '执行超时', unknown: '原因未确定' };

export type RegressionState = 'passed' | 'failed' | 'pending' | 'blocked' | 'unknown' | 'not-planned' | 'stale';
/** Extra regression coverage needs complete, reviewed records from both versions. */
export function verificationCoverage(context: VerificationContext, jobs: ReproductionJob[], stale = false) {
  const commands = [...new Set(context.regressionCommands || [])];
  const pair = ['baseline', 'patched'].map(role => jobs.find(job => job.verificationRole === role && job.verification?.pairId === context.pairId));
  const recordsValid = pair.every(job => job && job.verification?.fingerprint === context.fingerprint && job.commitSha === context.baseSha);
  const reviewed = pair.every(job => job?.verification?.confirmedAt && context.requirements.every(requirement => job.verification?.confirmedRequirementIds?.includes(requirement.id)));
  const complete = pair.every(job => job && !!job.totalAttempts && job.attemptHistory.length === job.totalAttempts);
  const environments = new Set(pair.flatMap(job => job?.attemptHistory.map(attempt => attempt.environmentFingerprint) || []));
  const results = commands.map(command => {
    let state: RegressionState;
    const steps = pair.flatMap(job => job?.attemptHistory.map(attempt => attempt.steps?.find(step => step.phase === 'verify' && step.command === command)) || []);
    if (stale) state = 'stale';
    else if (!recordsValid) state = 'unknown';
    else if (pair.some(job => job && ['awaiting-confirmation', 'queued', 'running'].includes(job.status))) state = 'pending';
    else if (!reviewed) state = 'unknown';
    else if (pair.some(job => job?.status === 'blocked')) state = 'blocked';
    else if (!complete || environments.size !== 1 || environments.has(undefined) || pair.some(job => job && ['failed', 'unsafe', 'cancelled'].includes(job.status))) state = 'unknown';
    else if (steps.some(step => step?.code !== undefined && step.code !== 0)) state = 'failed';
    else if (!steps.length || steps.some(step => !step || step.code !== 0 || !step.ok)) state = 'unknown';
    else state = 'passed';
    return { command, state };
  });
  const order: RegressionState[] = ['stale', 'blocked', 'failed', 'pending', 'unknown', 'passed'];
  const state: RegressionState = stale ? 'stale' : results.length ? order.find(state => results.some(result => result.state === state)) || 'unknown' : 'not-planned';
  const labels: Record<RegressionState, string> = { passed: '两版回归通过', failed: '回归存在失败', pending: '回归等待执行', blocked: '回归环境受阻', unknown: '回归依据不足', 'not-planned': '未安排额外回归', stale: '回归记录已过期' };
  return { state, label: labels[state], passed: results.filter(result => result.state === 'passed').length, total: commands.length, results,
    detail: state === 'passed' ? '两版全部尝试中的额外回归命令均通过，仅覆盖所列命令。' : state === 'not-planned' ? '目前只检查目标要求，其他行为尚未由额外命令验证。' : '核对两版逐次记录后再判断其他行为是否受影响。',
    testSource: context.sharedTestPaths.length ? '候选测试共享到两版' : '复用仓库现有测试',
    independent: '未记录独立验收来源', independentDetail: '当前记录没有独立验收测试的来源标记，不能推断已由独立测试验证。' };
}

/** Derive the next investigation from saved evidence; this never queues execution or calls a model. */
export function verificationNextAction(context: VerificationContext, jobs: ReproductionJob[], stale = false) {
  const assessment = assessVerification(context, jobs, stale);
  const pair = jobs.filter(job => job.verification?.pairId === context.pairId && ['baseline', 'patched'].includes(job.verificationRole || ''));
  if (['stale', 'pending', 'unconfirmed'].includes(assessment.state) || pair.length !== 2) return null;
  const failedCommands = [...new Set(pair.flatMap(job => [...(job.dependencySteps || []), ...job.attemptHistory.flatMap(attempt => attempt.steps || [])].filter(step => step.code !== undefined && step.code !== 0).map(step => step.command).filter((command): command is string => Boolean(command))))];
  const focus = assessment.requirements.filter(r => r.outcome !== 'improved');
  const targets = (focus.length ? focus : assessment.requirements).map(r => ({ id: r.requirement.id, command: r.requirement.command, paths: r.requirement.changedPaths, outcome: r.outcome }));
  const next = assessment.state === 'blocked'
    ? { title: '先定位执行阻塞', detail: '读取依赖和收集日志，核对环境与仓库声明。环境未就绪前，保留修复判断。', instruction: '先区分依赖导入、测试收集、准备和版本故障，引用实际失败命令及输出。只根据仓库声明提议受支持的环境调整；不为消除报错而修改业务代码或削弱测试。' }
    : assessment.state === 'still-failing'
      ? { title: '沿失败用例继续定位', detail: '对照未通过要求、生产路径与实际断言，修订当前候选方案。', instruction: '先读改动后仍失败的目标输出，再按对应 changedPaths 读取源码和候选差异。以原始固定提交提出完整修订，不在旧补丁上叠加猜测。' }
      : assessment.state === 'not-demonstrated'
        ? { title: '核对原版为何没有命中', detail: '确认测试能触及原始问题，再判断候选改动的作用。', instruction: '核对目标测试是否覆盖原文要求、选定版本是否含故障、failureSignal 是否真实。不得为了显示改进故意让原版失败或弱化改动版断言。' }
        : assessment.state === 'improved'
          ? { title: '核对本次验证的覆盖边界', detail: '整理已证实范围、额外回归和未覆盖行为，形成可审阅说明。', instruction: '整理选定要求的执行证据和未覆盖范围；没有额外回归时明确指出。不得把局部通过写成完整修复或批准合并。无需重复执行已有相同计划。' }
          : { title: '补齐缺失的对照依据', detail: '优先核对环境指纹、尝试记录及其他回归命令。', instruction: '先确认记录完整性和环境指纹，再检查目标以外的回归失败。证据不足时明确缺哪一项，不从单个通过结果推断修复。' };
  return { ...next, jobIds: pair.map(job => job.id), targets, failedCommands,
    prompt: `请基于已保存的需求对照继续调查。先分别用 read_execution 读取 ${pair.map(job => job.id).join('、')}。当前机器状态：${assessment.state}。${next.instruction}\n关注范围（数据）：${JSON.stringify({ targets, failedCommands })}\n不自动确认或执行新计划，不发布 GitHub 内容；准备的新方案仍需人工核对。` };
}

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
