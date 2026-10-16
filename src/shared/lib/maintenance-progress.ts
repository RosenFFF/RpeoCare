import type { MaintenanceTask } from '../../contracts/agent';

/** A bounded handoff hint, not evidence of correctness or permission to execute. */
export function maintenanceProgressHint(task: MaintenanceTask) {
  const wantsPatch = /补丁|修复|\bpatch\b|\bfix\b/i.test(task.goal);
  const wantsVerification = /对照|验证|\bverif/i.test(task.goal);
  const active = task.artifacts.filter(artifact => !artifact.superseded);
  const facts = { evidence: task.evidence.length, remainingCalls: Math.max(0, task.budget.maxTurns - task.budget.turns), patch: active.some(a => a.kind === 'patch'), verification: active.some(a => a.kind === 'verification') };
  const hasContext = task.evidence.some(e => e.kind === 'issue' || e.kind === 'pr') && task.evidence.some(e => e.kind === 'file');
  const next = !hasContext ? '先读取任务原文和相关源码。'
    : wantsPatch && !facts.patch ? '当前未保存补丁。证据足够时调用 propose_patch；修改现有文件时 before/after 使用最小且唯一的原文片段，通常数行，不要复制整个文件。证据不足时准确列出缺口。'
      : wantsVerification && facts.patch && !facts.verification ? '当前已有候选补丁，但未保存需求对照。读取必要测试与依赖声明，调用 prepare_verification 或说明具体阻塞。不要重复生成相同补丁。'
        : '核对已保存交付物与真实执行记录，返回本阶段报告。待确认计划不等于已执行。';
  return `阶段检查点（服务端记录）：${JSON.stringify(facts)}。${next}剩余调用少时优先交付可审阅的已有成果和明确缺口；不能为了交付捏造证据或声称测试通过。`;
}
