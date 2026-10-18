import type { MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob } from '@/contracts/workbench';
import { assessVerification, verificationNextAction } from './maintenance-verification';
import { planPrerequisites, reportPrerequisites, preflightReadiness } from './execution-readiness';

export type MaintenanceAction = 'start' | 'stop' | 'restart' | 'supplement' | 'review' | 'read-results' | 'prepare-verification' | 'resume' | 'patch';
export function maintenanceWorkflow(task: MaintenanceTask | undefined, jobs: ReproductionJob[], stale = false) {
  const artifacts = task?.artifacts.filter(artifact => !artifact.superseded) || [];
  const patch = artifacts.find(artifact => artifact.kind === 'patch');
  const verification = artifacts.filter(artifact => artifact.kind === 'verification' || artifact.kind === 'acceptance').at(-1);
  const executionArtifact = verification || artifacts.filter(artifact => artifact.kind === 'reproduction').at(-1);
  const relevantJobs = jobs.filter(job => executionArtifact?.jobIds?.includes(job.id));
  const context = verification?.verification;
  const outdated = stale || !!verification?.verificationStale;
  const assessment = context ? assessVerification(context, relevantJobs, outdated) : undefined;
  const running = task && ['queued', 'running'].includes(task.status);
  const executing = relevantJobs.some(job => ['queued', 'running'].includes(job.status));
  const waiting = relevantJobs.some(job => job.status === 'awaiting-confirmation');
  const environmentBlocked = relevantJobs.some(job => job.status === 'awaiting-confirmation' && preflightReadiness(job, jobs).state === 'blocked');
  const source = !!task?.evidence.some(evidence => evidence.kind === 'file');
  const hasReadResults = relevantJobs.length > 0 && relevantJobs.every(job => task?.evidence.some(evidence => evidence.kind === 'execution'
    && evidence.label.includes(job.id) && evidence.capturedAt >= (job.finishedAt || job.updatedAt)));
  let next: { action: MaintenanceAction; title: string; detail: string; label: string; model: boolean; prompt?: string };
  if (!task) next = { action: 'start', title: '从问题开始，准备可审阅的修复', detail: '读取当前反馈和相关源码，保存候选补丁与验证方案。执行前由你确认。', label: '准备修复建议', model: true };
  else if (running) next = { action: 'stop', title: '正在整理问题与方案', detail: task.events.at(-1)?.message || '当前调查在后台进行，离开页面后仍可恢复。', label: '停止调查', model: false };
  else if (outdated) next = { action: 'restart', title: '输入已变化，需要重新核对', detail: '历史记录仍可查看，请基于当前内容准备新方案。', label: '基于当前版本重新准备', model: true };
  else if (executing) next = { action: 'review', title: '隔离验证正在进行', detail: '分别记录原版与候选版的命令结果，完成后再判断改动。', label: '查看执行进度', model: false };
  else if (task.status === 'cancelled') next = { action: 'resume', title: '当前调查已停止', detail: '已有方案与记录保留，恢复调查后再继续准备或确认。', label: '恢复当前调查', model: true };
  else if ((task.status === 'waiting-input' && !task.report && !waiting) || reportPrerequisites(task).blockers.length || relevantJobs.some(job => planPrerequisites(job).blockers.length)) next = { action: waiting ? 'review' : 'supplement', title: '核对执行前置条件', detail: '真正缺少的环境或需求信息需要补齐；仅影响结论范围的条目可在计划中逐项复核，并保留理由。', label: waiting ? '核对阻塞与范围' : '补充所需信息', model: false };
  else if (waiting && environmentBlocked) next = { action: 'read-results', title: '运行环境未就绪，先修订准备步骤', detail: '已有静态检查发现阻塞，先核对依赖与项目声明，当前计划不能执行。', label: '核对环境并修订计划', model: true,
    prompt: `先用read_execution读取当前两版记录 ${relevantJobs.map(job => job.id).join('、')} 的environmentPreflight。优先选择preparationOptions中的必要声明，用preparationFrom的jobId和optionIds生成实际准备命令；没有选项时依据已读取仓库声明修订setupCommands，无法确认则保留阻塞并追问。不要只修改scopeLimitations，不禁用配置或测试，不自动执行或发布。原模型计划与预检记录继续保留。` };
  else if (waiting) next = { action: 'review', title: '方案已保存，等待你审阅', detail: '核对补丁、测试与预期故障信号，再分别确认两组执行。', label: '审阅并确认计划', model: false };
  else if (relevantJobs.length && !hasReadResults) next = { action: 'read-results', title: '执行已结束，整理实际结论', detail: '读取本次执行记录，说明已验证行为与未覆盖范围。', label: '读取结果并整理结论', model: true,
    prompt: `请先用 read_execution 读取执行记录 ${relevantJobs.map(job => job.id).join('、')}，基于逐次输出整理阶段结论、额外回归和未覆盖范围。不要重新生成相同计划，不自动执行或发布。` };
  else if (context && assessment && !['improved', 'pending', 'unconfirmed'].includes(assessment.state)) {
    const investigate = verificationNextAction(context, relevantJobs);
    next = investigate ? { action: 'read-results', title: investigate.title, detail: investigate.detail, label: '沿当前结果继续调查', model: true, prompt: investigate.prompt }
      : { action: 'resume', title: '需要继续核对方案', detail: '当前结果还不足以支持改进结论。', label: '继续核对', model: true };
  } else if (patch && !verification) next = { action: 'prepare-verification', title: '候选补丁已保存，准备同测试对照', detail: '将问题要求与生产改动、目标测试及额外回归对应起来。', label: '准备需求对照', model: true };
  else if (patch && task.status === 'completed') next = { action: 'patch', title: '阶段结论已保存，可以审阅交付', detail: '核对验证范围后下载候选补丁；局部通过不能代替完整回归。', label: '查看候选补丁', model: false };
  else next = { action: 'resume', title: task.status === 'failed' || task.status === 'paused' ? '已有结果保留，可以继续处理' : '继续完善当前问题', detail: task.notice || task.report?.nextSteps[0] || '沿已保存依据继续，不必重新开始。', label: '继续当前调查', model: true };
  const stage = !source ? 0 : !patch ? 1 : !assessment || ['unconfirmed', 'pending'].includes(assessment.state) || executing ? 2 : 3;
  const stages = ['读取依据', '候选补丁', '对照执行', '阶段结论'].map((label, index) => ({ label,
    state: outdated ? 'stale' : index < stage ? 'done' : index === stage ? (task?.status === 'completed' && hasReadResults && assessment?.state === 'improved' ? 'done' : 'current') : 'pending' }));
  return { next, stages, patch, verification, assessment, relevantJobs, outdated };
}
