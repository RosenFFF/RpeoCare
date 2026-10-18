'use client';

import { useState } from 'react';
import { ArrowRight, Check, CircleHelp, FileCode2, GitCommitHorizontal, LoaderCircle, RefreshCw, Search, Square, Workflow } from 'lucide-react';
import type { AgentWorkspaceData } from '@/contracts/agent';
import { reportPrerequisites } from '@/shared/lib/execution-readiness';
import { maintenanceWorkflow } from '@/shared/lib/maintenance-workflow';
import { EvidenceLinks, MaintenanceArtifact } from './maintenance-artifacts';
import './maintenance-task-workspace.css';

/** Reveal the existing review or evidence section without issuing a request. */
function reveal(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  let parent: HTMLElement | null = element;
  while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
  element.scrollIntoView({ block: 'start' });
  const focus = element instanceof HTMLDetailsElement ? element.querySelector('summary') : element;
  if (focus instanceof HTMLElement) { if (focus.tagName !== 'SUMMARY' && !focus.hasAttribute('tabindex')) focus.tabIndex = -1; focus.focus({ preventScroll: true }); }
}

export function MaintenanceTaskWorkspace({ title, actionLabel, data, error, busy, stale, onStart, onAction, onRefresh }: {
  title: string; actionLabel: string; data: AgentWorkspaceData | null; error: string; busy: boolean; stale: boolean;
  onStart: () => Promise<boolean>; onAction: (body: unknown) => Promise<boolean>; onRefresh: () => void;
}) {
  const [message, setMessage] = useState('');
  const task = data?.task;
  const workflow = maintenanceWorkflow(task, data?.jobs || [], stale);
  const { next } = workflow;
  const scope = `maintenance-${task?.id || 'new'}`;
  const active = !!task && ['queued', 'running'].includes(task.status);
  const status = task ? ({ queued: '等待处理', running: '调查中', 'waiting-input': '需要补充', 'awaiting-confirmation': '等待审阅', completed: '阶段结束', paused: '已暂停', failed: '需要处理', cancelled: '已停止' })[task.status] : '尚未开始';
  const nextDisabled = busy || !data || (next.model && !data.workerOnline);
  const artifacts = task?.artifacts.filter(artifact => !artifact.superseded) || [];
  const history = task?.artifacts.filter(artifact => artifact.superseded) || [];
  const rank = (kind: string) => kind === 'acceptance' ? 2 : kind === 'verification' ? 1 : 0;
  const ordered = [...artifacts].sort((a, b) => rank(b.kind) - rank(a.kind));
  const prepare = () => task && onAction({ action: 'message', id: task.id, content: '请读取当前问题原文、项目规则和测试配置，准备逐条需求与同测试双版本对照。requirements 只列原版预期失败的缺陷要求；另在 regressionCommands 安排正常行为回归。引用精确原文并核对首个失败信号，不能编造、执行或发布。' });
  const runNext = () => {
    if (next.action === 'start' || next.action === 'restart') { void onStart(); return; }
    if (!task) return;
    if (next.action === 'review') { reveal(`maintenance-review-${workflow.verification?.id || artifacts.find(artifact => artifact.kind === 'reproduction')?.id}`); return; }
    if (next.action === 'patch') { reveal(`maintenance-artifact-${workflow.patch?.id}`); return; }
    if (next.action === 'supplement') { reveal(`${scope}-supplement`); return; }
    if (next.action === 'prepare-verification') { void prepare(); return; }
    void onAction({ action: next.action === 'stop' ? 'cancel' : next.action === 'read-results' ? 'message' : 'resume', id: task.id, ...(next.prompt ? { content: next.prompt } : {}) });
  };
  return <section className="maintenance-support ma-workspace ma-task-workspace" aria-label={title} aria-busy={busy}>
    <header className="ma-task-header"><div><Workflow size={19} aria-hidden="true" /><h3>{title}</h3><span className={`ma-task-state ${active ? 'is-active' : ''}`}>{active && <LoaderCircle size={12} className="ma-spin" aria-hidden="true" />}{data ? status : '正在读取记录'}</span></div><button type="button" className="ma-refresh" onClick={onRefresh} disabled={busy} aria-label="刷新维护记录"><RefreshCw size={15} aria-hidden="true" /></button></header>
    {error && <p className="ma-notice" role="alert">{error}</p>}
    {!data ? <p className="ma-loading" role="status">{error ? '暂时无法读取维护记录，请刷新重试。' : '正在读取当前问题的维护记录…'}</p> : <>
      <ol className="ma-journey" aria-label="修复与验证流程">{workflow.stages.map((stage, index) => <li key={stage.label} className={`is-${stage.state}`} aria-current={stage.state === 'current' ? 'step' : undefined}><span>{stage.state === 'done' ? <Check size={13} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}</span><strong>{stage.label}</strong><small>{stage.state === 'done' ? '已有记录' : stage.state === 'current' ? '当前阶段' : stage.state === 'stale' ? '需重新核对' : '尚未到达'}</small></li>)}</ol>
      <div className="ma-next-action"><div className="ma-next-icon"><ArrowRight size={20} aria-hidden="true" /></div><div><span className="ma-section-kicker">下一步</span><h4>{next.title}</h4><p role="status" aria-atomic="true">{next.detail}</p></div><div className="ma-next-control"><button type="button" className={`button ${next.action === 'stop' ? 'button-secondary' : 'button-primary'}`} onClick={runNext} disabled={nextDisabled}>{next.action === 'stop' ? <Square size={13} aria-hidden="true" /> : null}{next.action === 'start' ? actionLabel : next.label}{next.action !== 'stop' && <ArrowRight size={14} aria-hidden="true" />}</button><small>{next.model ? '此操作会调用已配置模型' : next.action === 'stop' ? '保留已保存结果' : '查看记录，不调用模型'}</small></div></div>
      {!data.workerOnline && <p className="ma-inline-note">调查服务暂未连接，已有结果仍可查看；模型操作暂不可用。</p>}
      {task?.notice && !active && <p className="ma-notice">{task.notice.replaceAll('Agent', '调查')}</p>}
      {workflow.outdated && <p className="ma-notice">当前显示历史版本依据，不能据此确认新执行或推断当前版本通过。</p>}
      {task && <>
        <div className="ma-task-context"><span><GitCommitHorizontal size={14} aria-hidden="true" />{task.commitSha ? task.commitSha.slice(0, 10) : '源码版本待固定'}</span><span>{task.branch || '分支待确认'}</span><span>{task.evidence.length} 项读取依据</span><span>{workflow.patch?.files?.length || 0} 个候选文件</span><a href={`#${scope}-evidence`} onClick={() => reveal(`${scope}-evidence`)}>查看依据 <ArrowRight size={12} aria-hidden="true" /></a></div>
        {reportPrerequisites(task).blockers.length ? <div className="ma-questions"><h4><CircleHelp size={15} aria-hidden="true" />需要补充的线索</h4><ul>{reportPrerequisites(task).blockers.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
        {(task.report?.scopeLimitations?.length||reportPrerequisites(task).scope.length)?<details className="maintenance-support-evidence"><summary>本阶段结论范围</summary><ul>{[...(task.report?.scopeLimitations||[]),...reportPrerequisites(task).scope.map(entry=>`${entry.text}（人工复核：${entry.reason}）`)].map((text,index)=><li key={index}>{text}</li>)}</ul></details>:null}
        {ordered.map(artifact => <MaintenanceArtifact key={artifact.id} artifact={artifact} task={task} data={data} busy={busy || workflow.outdated} stale={workflow.outdated} action={onAction} />)}
        {task.report && <details className="ma-report-disclosure"><summary><FileCode2 size={15} aria-hidden="true" />阶段说明与发现<span>{task.report.findings.length} 项发现</span></summary><div className="maintenance-support-report"><p>{task.report.summary}</p>{task.report.findings.map((finding, index) => <details key={index}><summary><span className={finding.certainty === 'supported' ? 'ma-supported' : 'ma-hypothesis'}>{finding.certainty === 'supported' ? '有依据' : '待验证'}</span>{finding.title}</summary><p>{finding.detail}</p><EvidenceLinks task={task} ids={finding.evidenceIds} />{finding.certainty === 'supported' && finding.evidenceIds.length > 0 && <button type="button" disabled={busy || workflow.outdated} onClick={() => void onAction({ action: 'remember', id: task.id, content: finding.detail, evidenceIds: finding.evidenceIds })}>确认并记为项目约定</button>}</details>)}{task.report.nextSteps.length > 0 && <><h5>后续建议</h5><ol>{task.report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></>}</div></details>}
        <details className="maintenance-supplement" id={`${scope}-supplement`} open={task.status === 'waiting-input'}><summary>补充线索或调整方向</summary><form onSubmit={async event => { event.preventDefault(); if (await onAction({ action: 'message', id: task.id, content: message })) setMessage(''); }}><label htmlFor={`${scope}-message`}>补充信息</label><textarea id={`${scope}-message`} required maxLength={4000} value={message} onChange={event => setMessage(event.target.value)} placeholder="补充运行环境、实际现象，或需要核对的行为…" /><button type="submit" className="button button-secondary" disabled={busy || workflow.outdated || active || !message.trim() || !data.workerOnline}>补充并继续<ArrowRight size={14} aria-hidden="true" /></button><small>提交后调用模型；当前方案执行仍需单独确认。</small></form></details>
        <details className="maintenance-support-evidence" id={`${scope}-evidence`}><summary><Search size={14} aria-hidden="true" />调查依据<span>{task.evidence.length} 项</span></summary>{!task.evidence.length && <p>尚无读取记录。</p>}{task.evidence.map(evidence => <details key={evidence.id} id={`maintenance-${task.id}-${evidence.id}`}><summary>{evidence.label}</summary><small>固定版本 {evidence.commitSha.slice(0, 10)}</small>{evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">查看原始来源</a>}<pre tabIndex={0}>{evidence.excerpt}</pre></details>)}</details>
        {data.memories.length > 0 && <details className="maintenance-support-evidence"><summary>已确认的项目约定 · {data.memories.length}</summary>{data.memories.map(memory => <div className="maintenance-memory" key={memory.id}><p>{memory.content}</p><small>依据提交 {memory.commitSha.slice(0, 10)}，后续分析仍需重新核对。</small><button type="button" disabled={busy} onClick={() => void onAction({ action: 'archive-memory', memoryId: memory.id })}>停用此约定</button></div>)}</details>}
        {history.length > 0 && <details className="ma-history"><summary>历史方案 · {history.length} 项</summary>{history.slice().reverse().map(artifact => <MaintenanceArtifact key={artifact.id} artifact={artifact} task={task} data={data} busy={true} stale={true} action={onAction} />)}</details>}
      </>}
      {!task && <p className="ma-empty-footnote">补丁和验证方案会保存在此处。人工审阅后执行，结果与原始证据一同保留。</p>}
    </>}
  </section>;
}
