'use client';

import { CheckCircle2, CircleHelp, Download, GitCompareArrows, ShieldAlert } from 'lucide-react';
import type { AgentArtifact, MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob } from '@/contracts/workbench';
import { assessVerification, executionFailureLabels, requirementOutcomeLabels, verificationCoverage } from '@/shared/lib/maintenance-verification';
import { planPrerequisites, reportPrerequisites } from '@/shared/lib/execution-readiness';
import './maintenance-verification.css';

export function MaintenanceVerification({ artifact, task, jobs, stale }: { artifact: AgentArtifact; task: MaintenanceTask; jobs: ReproductionJob[]; stale?: boolean }) {
  const context = artifact.verification;
  if (!context) return <p>历史方案未包含逐条需求和共享测试依据，请重新准备。</p>;
  const outdated = stale || artifact.verificationStale;
  const assessment = assessVerification(context, jobs, outdated);
  const coverage = verificationCoverage(context, jobs, outdated);
  const improved = assessment.requirements.filter(requirement => requirement.outcome === 'improved').length;
  const pair = jobs.filter(job => artifact.jobIds?.includes(job.id) && job.verification?.pairId === context.pairId);
  const downloadMarkdown = () => {
    const scopeNotes = [...new Set([...(task.report?.scopeLimitations || []), ...reportPrerequisites(task).scope.map(entry => `${entry.text}（人工复核：${entry.reason}）`), ...pair.flatMap(job => [...(job.plan.scopeLimitations || []), ...planPrerequisites(job).scope.map(entry => `${entry.text}（人工复核：${entry.reason}）`)])])];
    const blockers = [...new Set([...reportPrerequisites(task).blockers, ...pair.flatMap(job => planPrerequisites(job).blockers)])];
    const lines = ['# RepoCare 需求对照记录', '', `仓库：${task.repoUrl}`, `任务：${task.kind} #${task.number}`, `原始提交：${context.baseSha}`, `PR head：${context.headSha || '本地候选补丁'}`, `计划指纹：${context.fingerprint}`, `规则版本：${context.policyRevision}`, `目标要求：${requirementOutcomeLabels[assessment.state]}`, `额外回归：${coverage.label}（${coverage.passed}/${coverage.total} 条命令）`, `测试来源：${coverage.testSource}`, `独立验收：${coverage.independent}`, '', ...assessment.requirements.flatMap(({ requirement, outcome, reason }) => [`## ${requirement.id} ${requirement.text}`, `状态：${requirementOutcomeLabels[outcome]}`, `原文来源：${requirement.source}`, `原文：${requirement.quote}`, `生产改动：${requirement.changedPaths.join('、')}`, `测试命令：${requirement.command}`, `预期故障信号：${requirement.failureSignal}`, `说明：${reason}`, '']), '## 额外回归命令', ...coverage.results.map(result => `- ${result.command}：${result.state}`), '', '## 执行前置条件', ...blockers.map(text => `- ${text}`), '', '## 本次明确的范围限制', ...scopeNotes.map(note => `- ${note}`), '', '## 结论范围', ...assessment.limitations.map(text => `- ${text}`), `- ${coverage.independentDetail}`, '- 记录属于固定版本；导出不自动查询最新 GitHub 内容。'];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `repocare-verification-${context.pairId.slice(0, 8)}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const targetIcon = assessment.state === 'improved' ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />;
  const jobLabel = (job: ReproductionJob | undefined) => !job ? '暂无记录' : ({ 'awaiting-confirmation': '待审阅确认', queued: '排队中', running: '执行中', reproduced: '计划命令通过', 'not-reproduced': '存在未通过命令', blocked: '环境受阻', failed: '执行失败', cancelled: '已取消', unsafe: '计划被阻止', draft: '准备中' })[job.status];
  return <section className="mv-panel" aria-label="需求与改动验证">
    <header className="mv-heading"><div><GitCompareArrows size={18} aria-hidden="true" /><h4>需求对照</h4><small>第 {artifact.revision || 1} 版</small></div><span className={`mv-state mv-${assessment.state}`}>{targetIcon}{requirementOutcomeLabels[assessment.state]}</span></header>
    <div className="mv-summary"><strong>{improved}<small> / {context.requirements.length}</small></strong><div><span>目标要求观察到改进</span><p>{assessment.reason}</p></div></div>
    <div className="mv-coverage" aria-label="本次验证覆盖">
      <div className={`mv-coverage-item is-${coverage.state}`}><span>额外回归</span><strong>{coverage.label}</strong><p>{coverage.total ? `${coverage.passed} / ${coverage.total} 条命令在两版全部尝试中通过。` : coverage.detail}</p></div>
      <div className="mv-coverage-item"><span>测试来源</span><strong>{coverage.testSource}</strong><p>{context.sharedTestPaths.length ? `${context.sharedTestPaths.length} 个测试文件在两组中保持相同。` : '当前计划没有新增共享测试改动。'}测试语义仍需人工核对。</p></div>
      <div className="mv-coverage-item is-unknown"><span>独立验收</span><strong>未记录</strong><p>{coverage.independentDetail}</p></div>
    </div>
    <div className="mv-version-pair" aria-label="双版本执行状态"><div><span>01 · 原始版本</span><strong>{outdated ? '历史记录' : assessment.state === 'improved' ? '命中约定目标故障' : jobLabel(pair.find(job => job.verificationRole === 'baseline'))}</strong><code>{context.baseSha.slice(0, 10)}</code></div><GitCompareArrows size={20} aria-hidden="true" /><div><span>02 · 候选版本</span><strong>{outdated ? '历史记录' : jobLabel(pair.find(job => job.verificationRole === 'patched'))}</strong><code>{context.headSha ? context.headSha.slice(0, 10) : '应用当前候选补丁'}</code></div></div>
    <div className="mv-requirements">{assessment.requirements.map(({ requirement, outcome, reason }, index) => <article className={`mv-requirement mv-${outcome}`} key={requirement.id}>
      <div className="mv-requirement-title"><span className="mv-number">{String(index + 1).padStart(2, '0')}</span><h5>{requirement.text}</h5><span className="mv-state">{outcome === 'improved' ? <CheckCircle2 size={14} aria-hidden="true" /> : outcome === 'blocked' || outcome === 'still-failing' ? <ShieldAlert size={14} aria-hidden="true" /> : <CircleHelp size={14} aria-hidden="true" />}{requirementOutcomeLabels[outcome]}</span></div>
      <p>{reason}</p><details className="mv-requirement-detail"><summary>查看原文、改动与测试</summary><div className="mv-evidence-grid"><div><span>原始要求 · {requirement.source}</span><blockquote>{requirement.quote}</blockquote></div><div><span>对应生产改动</span>{requirement.changedPaths.map(path => <code key={path}>{path}</code>)}</div><div><span>同一目标测试</span><code>{requirement.command}</code><small>原版预期断言：{requirement.failureSignal}</small></div></div>
      <details><summary>查看逐次执行依据</summary><div className="mv-attempt-grid">{pair.map(job => <div className="mv-attempts" key={job.id}><strong>{job.verificationRole === 'baseline' ? '原始版本' : '候选版本'}</strong>{!job.attemptHistory.length && <p>尚无执行记录</p>}{job.attemptHistory.map(attempt => { const step = attempt.steps?.find(step => step.command === requirement.command && step.phase === 'verify'); return <div key={attempt.index}><span>第 {attempt.index} 次 · {step?.code === undefined ? '未完成该命令' : `exit ${step.code}`}{step?.failureKind ? ` · ${executionFailureLabels[step.failureKind]}` : ''}</span><pre tabIndex={0}>{step ? `${step.stdout || ''}\n${step.stderr || ''}`.trim() || '没有输出内容，退出码见上方。' : attempt.summary}</pre></div>; })}</div>)}</div></details></details>
    </article>)}</div>
    {coverage.total > 0 && <details className="mv-regressions"><summary>额外回归命令与结果 · {coverage.total} 条</summary>{coverage.results.map(result => <div key={result.command}><code>{result.command}</code><span>{({ passed: '两版全部通过', failed: '存在失败', pending: '待执行', blocked: '环境受阻', unknown: '依据不足', 'not-planned': '未安排', stale: '记录已过期' })[result.state]}</span></div>)}</details>}
    <div className="mv-boundary"><ShieldAlert size={15} aria-hidden="true" /><p>结论仅限所列要求和测试。额外回归通过不代表完整测试集通过，当前记录也未证明独立验收。</p></div>
    <footer className="mv-footer"><details className="mv-scope"><summary>版本指纹与范围限制</summary><dl><dt>生产改动</dt><dd><code>{context.productionHash}</code></dd><dt>共享测试</dt><dd><code>{context.sharedTestsHash}</code></dd><dt>两组计划</dt><dd><code>{context.planHash}</code><code>{context.patchedPlanHash}</code></dd><dt>项目规则</dt><dd>r{context.policyRevision}</dd></dl><ul>{assessment.limitations.map(text => <li key={text}>{text}</li>)}</ul></details><div><button type="button" className="button button-secondary" onClick={downloadMarkdown}><Download size={14} aria-hidden="true" />导出说明</button><a className="button button-secondary" href={`/api/workbench/agent?id=${task.id}&export=${artifact.id}`}><Download size={14} aria-hidden="true" />JSON 与证据</a></div></footer>
  </section>;
}
