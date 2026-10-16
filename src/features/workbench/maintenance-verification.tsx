'use client';

import { CheckCircle2, CircleHelp, Download, FileCheck2, GitCompareArrows, ShieldAlert } from 'lucide-react';
import type { AgentArtifact, MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob } from '@/contracts/workbench';
import { assessVerification, executionFailureLabels, requirementOutcomeLabels, verificationNextAction } from '@/shared/lib/maintenance-verification';
import './maintenance-verification.css';

export function MaintenanceVerification({ artifact, task, jobs, stale, onInvestigate, busy }: { artifact: AgentArtifact; task: MaintenanceTask; jobs: ReproductionJob[]; stale?: boolean; onInvestigate?: (content: string) => void; busy?: boolean }) {
  const context = artifact.verification;
  if (!context) return <p>历史方案未包含逐条需求和共享测试依据，请重新准备。</p>;
  const assessment = assessVerification(context, jobs, stale || artifact.verificationStale);
  const next = verificationNextAction(context, jobs, stale || artifact.verificationStale);
  const improved = assessment.requirements.filter(requirement => requirement.outcome === 'improved').length;
  const downloadMarkdown = () => {
    const lines = ['# RepoCare 需求对照记录', '', `仓库：${task.repoUrl}`, `任务：${task.kind} #${task.number}`, `原始提交：${context.baseSha}`, `PR head：${context.headSha || '本地候选补丁'}`, `计划指纹：${context.fingerprint}`, `规则版本：${context.policyRevision}`, `整体状态：${requirementOutcomeLabels[assessment.state]}`, '', ...assessment.requirements.flatMap(({ requirement, outcome, reason }) => [`## ${requirement.id} ${requirement.text}`, `状态：${requirementOutcomeLabels[outcome]}`, `原文来源：${requirement.source}`, `原文：${requirement.quote}`, `生产改动：${requirement.changedPaths.join('、')}`, `测试命令：${requirement.command}`, `预期故障信号：${requirement.failureSignal}`, `说明：${reason}`, '']), '## 结论范围', ...assessment.limitations.map(text => `- ${text}`), '- 记录属于固定版本；导出不自动查询最新 GitHub 内容。'];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `repocare-verification-${context.pairId.slice(0, 8)}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="mv-panel" aria-label="需求与改动验证">
    <header className="mv-heading"><div><GitCompareArrows size={19} aria-hidden="true" /><h4>每条要求，都能追溯依据</h4></div><span className={`mv-state mv-${assessment.state}`}>{requirementOutcomeLabels[assessment.state]}</span></header>
    <div className="mv-summary"><div><strong>{improved}<small> / {context.requirements.length}</small></strong><span>要求观察到改进</span></div><p role="status" aria-atomic="true">{assessment.reason}</p></div>
    <div className="mv-context"><span>原版 <code>{context.baseSha.slice(0, 10)}</code></span><span>{context.headSha ? <>PR <code>{context.headSha.slice(0, 10)}</code></> : '候选补丁'}</span><span>规则 r{context.policyRevision}</span><span>{context.sharedTestPaths.length} 个测试改动共享到两组</span><span>{context.regressionCommands?.length||0} 项额外验证命令</span></div>
    {next && <div className="mv-next"><div><strong>{next.title}</strong><p>{next.detail}</p><small>基于当前执行记录 · 继续调查会调用已配置模型</small></div>{onInvestigate && <button type="button" className="button button-secondary" disabled={busy} onClick={() => onInvestigate(next.prompt)}>继续此项调查</button>}</div>}
    <div className="mv-requirements">{assessment.requirements.map(({ requirement, outcome, reason }, index) => <article className={`mv-requirement mv-${outcome}`} key={requirement.id}>
      <div className="mv-requirement-title"><span className="mv-number">{String(index + 1).padStart(2, '0')}</span><h5>{requirement.text}</h5><span className="mv-state">{outcome === 'improved' ? <CheckCircle2 size={14} aria-hidden="true" /> : outcome === 'blocked' || outcome === 'still-failing' ? <ShieldAlert size={14} aria-hidden="true" /> : <CircleHelp size={14} aria-hidden="true" />}{requirementOutcomeLabels[outcome]}</span></div>
      <p>{reason}</p><div className="mv-evidence-grid"><div><span>原始要求 · {requirement.source}</span><blockquote>{requirement.quote}</blockquote></div><div><span>对应生产改动</span>{requirement.changedPaths.map(path => <code key={path}>{path}</code>)}</div><div><span>同一回归命令</span><code>{requirement.command}</code><small>原版预期断言：{requirement.failureSignal}</small></div></div>
      <details><summary>逐次执行依据</summary>{jobs.filter(job => artifact.jobIds?.includes(job.id)).map(job => <div className="mv-attempts" key={job.id}><strong>{job.verificationRole === 'baseline' ? '原始版本' : '应用改动'}</strong>{!job.attemptHistory.length && <p>尚无执行记录</p>}{job.attemptHistory.map(attempt => { const step = attempt.steps?.find(step => step.command === requirement.command && step.phase === 'verify'); return <div key={attempt.index}><span>第 {attempt.index} 次 · {step?.code === undefined ? '未完成该命令' : `exit ${step.code}`}{step?.failureKind ? ` · ${executionFailureLabels[step.failureKind]}` : ''}</span><pre tabIndex={0}>{step ? `${step.stdout || ''}\n${step.stderr || ''}`.trim() || '没有输出内容，退出码见上方。' : attempt.summary}</pre></div>; })}</div>)}</details>
    </article>)}</div>
    <footer className="mv-footer"><p><FileCheck2 size={15} aria-hidden="true" />{assessment.limitations[0]}</p><div><button type="button" className="button button-secondary" onClick={downloadMarkdown}><Download size={14} aria-hidden="true" />导出说明</button><a className="button button-secondary" href={`/api/workbench/agent?id=${task.id}&export=${artifact.id}`}><Download size={14} aria-hidden="true" />完整 JSON 与证据索引</a></div></footer>
    <details className="mv-scope"><summary>查看指纹与验证范围</summary><dl><dt>生产改动</dt><dd><code>{context.productionHash}</code></dd><dt>共享测试</dt><dd><code>{context.sharedTestsHash}</code></dd><dt>两组计划</dt><dd><code>{context.planHash}</code><code>{context.patchedPlanHash}</code></dd></dl><ul>{assessment.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
  </section>;
}
