import type { MaintenanceTask } from '../../contracts/agent';

const explorationTools = new Set(['read_item', 'list_files', 'search_files', 'read_file', 'read_project_rules', 'read_verification_environment']);
/** Keep the hard budget, reserving a report slot and a short delivery window. */
export function maintenanceToolAllowed(task: MaintenanceTask, name: string) {
  if (task.budget.turns >= task.budget.maxTurns || task.budget.tools >= task.budget.maxTools - 1) return name === 'submit_report';
  const hasContext = task.evidence.some(e => e.kind === 'issue' || e.kind === 'pr') && task.evidence.some(e => e.kind === 'file');
  if (hasContext && (task.budget.maxTurns - task.budget.turns <= 1 || task.budget.maxTools - task.budget.tools <= 2)) return name === 'submit_report';
  return !(hasContext && task.budget.maxTurns - task.budget.turns <= 2 && explorationTools.has(name));
}

/** A bounded handoff hint, not evidence of correctness or permission to execute. */
export function maintenanceProgressHint(task: MaintenanceTask, reportRejected = false) {
  const wantsPatch = /补丁|修复|\bpatch\b|\bfix\b/i.test(task.goal);
  const wantsVerification = /对照|验证|\bverif/i.test(task.goal);
  const active = task.artifacts.filter(artifact => !artifact.superseded);
  const facts = { evidence: task.evidence.length, remainingCalls: Math.max(0, task.budget.maxTurns - task.budget.turns), patch: active.some(a => a.kind === 'patch'), verification: active.some(a => a.kind === 'verification') };
  const hasContext = task.evidence.some(e => e.kind === 'issue' || e.kind === 'pr') && task.evidence.some(e => e.kind === 'file');
  const next = !hasContext ? '先读取任务原文和相关源码。'
    : wantsPatch && !facts.patch ? '当前未保存补丁。证据足够时调用 propose_patch；修改现有文件时 before/after 使用最小且唯一的原文片段，通常数行，不要复制整个文件。证据不足时准确列出缺口。'
      : wantsVerification && facts.patch && !facts.verification ? '当前已有候选补丁，但未保存需求对照。读取必要测试与依赖声明，调用 prepare_verification 或说明具体阻塞。不要重复生成相同补丁。'
        : '核对已保存交付物与真实执行记录，返回本阶段报告。待确认计划不等于已执行。若仅等待人工确认或执行，请在summary注明未运行，missingInformation留空；只有阻止选定步骤执行的真实缺口才列入missingInformation。';
  return `阶段检查点（服务端记录）：${JSON.stringify(facts)}。${reportRejected ? '上次报告未通过校验。先修正报告，不继续调查；逐字复制实际证据编号，不能猜测或自动缩写。只有交付状态时findings可以为空。' : next}${facts.remainingCalls <= 4 ? '现在进入收尾：停止扩展无关源码范围，优先保存已有最小候选、可审阅计划或明确的未完成结论。' : ''}最后两次请求用于报告及一次校验纠错，不增加总预算。本任务可引用证据编号（数据）：${JSON.stringify(task.evidence.map(e => e.id))}。不能为了交付捏造证据或声称测试通过。`;
}

/** Describe saved state without adopting an unvalidated model report. */
export function maintenanceHandoff(task: MaintenanceTask, reportRejected: boolean) {
  const active = task.artifacts.filter(artifact => !artifact.superseded);
  return `系统阶段记录：本阶段未完成，${reportRejected ? '模型报告未通过格式或证据校验' : '没有新的已校验阶段报告'}。已保留 ${task.evidence.length} 条读取或执行依据、${active.length} 份当前交付物，其中补丁 ${active.filter(a => a.kind === 'patch').length} 份、对照计划 ${active.filter(a => a.kind === 'verification' || a.kind === 'acceptance').length} 份。模型请求 ${task.budget.turns}/${task.budget.maxTurns}，工具调用 ${task.budget.tools}/${task.budget.maxTools}。这些数量不证明修复或测试通过；原记录保留，需审阅后再决定是否继续。`;
}
