'use client';
import { useState } from 'react';
import { ClipboardCheck, FlaskConical, ShieldAlert } from 'lucide-react';
import type { AgentArtifact, AgentWorkspaceData, MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob } from '@/contracts/workbench';
import { planPrerequisites, preflightReadiness, reportPrerequisites, requiresPythonPreflight } from '@/shared/lib/execution-readiness';
import './maintenance-readiness.css';

type Action = (body: unknown) => Promise<boolean>;
export function PrerequisiteReview({ task, artifact, jobs, disabled, action }: { task: MaintenanceTask; artifact: AgentArtifact; jobs: ReproductionJob[]; disabled: boolean; action: Action }) {
  const plan = jobs[0]?.plan.missingInformation || [], report = task.report?.missingInformation || [];
  const planReview = jobs[0] ? planPrerequisites(jobs[0]) : undefined;
  const reportReview = reportPrerequisites(task);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries([
    ...(planReview?.review?.scopeEntries || []).map(entry => [`plan:${entry.index}`, true]),
    ...(reportReview.review?.scopeEntries || []).map(entry => [`report:${entry.index}`, true]),
  ]));
  const [reasons, setReasons] = useState<Record<string, string>>(() => Object.fromEntries([
    ...(planReview?.review?.scopeEntries || []).map(entry => [`plan:${entry.index}`, entry.reason]),
    ...(reportReview.review?.scopeEntries || []).map(entry => [`report:${entry.index}`, entry.reason]),
  ]));
  const [saved, setSaved] = useState(false);
  if (!plan.length && !report.length) return null;
  const rows = [...plan.map((text, index) => ({ text, index, group: 'plan' })), ...report.map((text, index) => ({ text, index, group: 'report' }))];
  const allowed = !disabled && jobs.length > 0 && jobs.every(job => job.status === 'awaiting-confirmation') && !['queued', 'running', 'cancelled'].includes(task.status);
  const valid = rows.every(row => !selected[`${row.group}:${row.index}`] || (reasons[`${row.group}:${row.index}`]?.trim().length || 0) >= 8);
  const submit = async () => {
    const entries = (group: string) => rows.filter(row => row.group === group && selected[`${group}:${row.index}`]).map(row => ({ index: row.index, reason: reasons[`${group}:${row.index}`].trim() }));
    setSaved(await action({ action: 'review-prerequisites', id: task.id, artifactId: artifact.id, fingerprint: artifact.verification?.fingerprint || artifact.fingerprint, updatedAt: task.updatedAt, planScopes: entries('plan'), reportScopes: entries('report') }));
  };
  return <details className="ma-prerequisite-review"><summary><ClipboardCheck size={16} aria-hidden="true" />核对阻塞与范围 <span>{planReview?.blockers.length || 0} 项计划前置条件</span></summary>
    <p>默认保留模型列出的阻塞。只有你确认某项仅影响结论范围时，才将它归为范围限制并说明理由。原计划、原文和历次复核都会保留。</p>
    <fieldset disabled={!allowed}><legend>逐项复核</legend>{rows.map(row => { const key = `${row.group}:${row.index}`; return <div className="ma-prerequisite-row" key={key}><small>{row.group === 'plan' ? '计划前置条件' : '阶段报告缺口'}</small><p>{row.text}</p><label><input type="checkbox" checked={!!selected[key]} onChange={event => { setSelected(current => ({ ...current, [key]: event.target.checked })); setSaved(false); }} />这项仅限制结论范围，不阻止当前选定命令</label>{selected[key] && <label className="ma-scope-reason">复核理由（至少 8 字）<textarea maxLength={500} value={reasons[key] || ''} onChange={event => { setReasons(current => ({ ...current, [key]: event.target.value })); setSaved(false); }} placeholder="说明当前命令为何能执行，以及哪些行为仍未覆盖" /></label>}</div>; })}</fieldset>
    <button type="button" className="button button-secondary" disabled={!allowed || !valid} onClick={() => void submit()}>保存人工复核</button>{saved && <p role="status">复核已保存。运行环境检查和执行确认仍需分别完成。</p>}
    {(planReview?.review || reportReview.review) && <p role="status">最近复核：{new Date((planReview?.review || reportReview.review)!.reviewedAt).toLocaleString('zh-CN')} · 已保留原始前置条件与复核理由。</p>}
    <small>保存复核不调用模型、不运行代码，也不会忽略环境预检发现的真实阻塞。</small>
  </details>;
}

export function ExecutionReadiness({ task, artifact, job, data, disabled, action }: { task: MaintenanceTask; artifact: AgentArtifact; job: ReproductionJob; data: AgentWorkspaceData; disabled: boolean; action: Action }) {
  const state = preflightReadiness(job, data.jobs), prerequisites = planPrerequisites(job);
  const scopes = [...(job.plan.scopeLimitations || []), ...prerequisites.scope.map(entry => `${entry.text}（人工复核：${entry.reason}）`)];
  const report = state.check?.preflight;
  const supported = requiresPythonPreflight(job.plan);
  return <section className={`ma-readiness is-${state.state}`} aria-label="执行准备情况">
    <header><FlaskConical size={17} aria-hidden="true" /><strong>{supported ? state.label : '此类计划暂不提供Python环境预检'}</strong></header>
    <div className="ma-readiness-counts"><span><strong>{prerequisites.blockers.length}</strong> 项执行前置条件</span><span><strong>{scopes.length}</strong> 项范围限制</span><span>执行前仍需人工确认</span></div>
    {prerequisites.blockers.length > 0 && <div className="ma-readiness-blockers"><h5><ShieldAlert size={14} aria-hidden="true" />需要先解决</h5><ul>{prerequisites.blockers.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
    {scopes.length > 0 && <details><summary>本次结论不覆盖的范围</summary><ul>{scopes.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
    {supported && <><p>检查当前固定代码与候选中的版本声明、选定测试和祖先 conftest。不会安装依赖、收集测试或运行项目代码。</p><button type="button" className="button button-secondary" disabled={disabled || !data.sandboxConfigured || !data.reproductionWorkerOnline || state.state === 'running' || job.status !== 'awaiting-confirmation' || ['queued', 'running', 'cancelled'].includes(task.status)} onClick={() => void action({ action: 'preflight', id: task.id, artifactId: artifact.id, fingerprint: artifact.verification?.fingerprint || artifact.fingerprint, jobId: job.id })}>{state.state === 'running' ? '环境检查中…' : report ? '重新检查环境' : '检查运行环境'}</button></>}
    {state.check?.error && <p role="status">{state.check.error}</p>}
    {report && <details open={state.state === 'blocked' || state.state === 'review'}><summary>查看检查结果 · Python {report.runtime.python || '未知'} · pytest {report.runtime.pytest || '未知'}</summary><ul className="ma-environment-checks">{report.checks.map(check => <li key={check.id} className={`is-${check.status}`}><strong>{({ pass: '已检查', warning: '需核对', blocked: '受阻', unknown: '未知' })[check.status]} · {check.title}</strong><p>{check.detail}</p>{check.path && <code>{check.path}</code>}{check.remedy && <small>{check.remedy}</small>}</li>)}</ul><p>{new Date(report.checkedAt).toLocaleString('zh-CN')} · 结果有效期 30 分钟，Runner 或计划变化需重新检查。</p><ul>{report.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>}
  </section>;
}
