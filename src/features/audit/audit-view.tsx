'use client';

import type { Overview } from '@/contracts/overview';
import { changed } from '@/features/workbench/client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, CircleDashed, CircleHelp, Clock3, Download, FileText, GitBranch, History, Info, ListTree, LoaderCircle, MessageSquare, Plus, RefreshCw, ShieldCheck, Square, X } from 'lucide-react';
import { isTerminal, nodeDefinitions, type AuditCapabilities, type AuditReport, type AuditRun, type Evidence, type NodeId, type NodeStatus, type RunStatus } from '@/contracts/audit';
import '../../shared/styles/maintenance-views.css';
import './audit-workflow.css';
import './audit-studio.css';
import type { ModelSelection } from '@/contracts/models';

const lastRunKey = 'repocare.audit.last-run';
const filters = ['全部', '文档', '协作', '工程'] as const;
const statusLabels: Record<NodeStatus, string> = { pending: '等待执行', running: '正在执行', succeeded: '执行完成', failed: '执行失败', skipped: '已跳过', cancelled: '已取消' };
const runLabels: Record<RunStatus, string> = { queued: '等待执行', running: '体检进行中', completed: '体检完成', failed: '体检未完成', cancelled: '体检已取消' };
const checkLabels = { pass: '已通过', needs_attention: '待完善', unknown: '无法判断' };
const statusOrder = { needs_attention: 0, unknown: 1, pass: 2 };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `请求失败（${response.status}），请稍后重试。`);
  return body as T;
}

function safeEvidenceUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && /^\/[^/]+\/[^/]+\/blob\/[^/]+\/.+/.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="aw-muted">此节点暂未提供文件证据。</p>;
  return <ul className="aw-evidence-list">{evidence.map((item, index) => {
    const url = safeEvidenceUrl(item.url);
    return <li key={`${item.path}-${index}`}><div className="aw-evidence-path"><FileText size={13} aria-hidden="true" />{url ? <a href={url} target="_blank" rel="noopener noreferrer">{item.path}</a> : <code>{item.path}</code>}</div>{item.note && <p>{item.note}</p>}{item.excerpt && <pre>{item.excerpt}</pre>}</li>;
  })}</ul>;
}

function StatusIcon({ status }: { status: NodeStatus }) {
  if (status === 'running') return <LoaderCircle size={17} className="aw-spin" aria-hidden="true" />;
  if (status === 'succeeded') return <Check size={17} aria-hidden="true" />;
  if (status === 'failed') return <X size={17} aria-hidden="true" />;
  if (status === 'cancelled') return <Square size={13} aria-hidden="true" />;
  if (status === 'skipped') return <CircleHelp size={17} aria-hidden="true" />;
  return <Clock3 size={17} aria-hidden="true" />;
}

function dateLabel(date: string) {
  return new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function ModelStamp({ model }: { model?: ModelSelection }) {
  if (!model) return null;
  return <span className="aw-model-stamp">{model.name} · <code>{model.modelId}</code> · v{model.revision}{model.source === 'environment' ? ' · 服务端配置' : ''}</span>;
}

function AgentActivity({ run }: { run: AuditRun }) {
  const events = run.agentEvents || [];
  return <div className="aw-agent-activity"><span className="aw-detail-label">Agent 执行记录</span>
    {events.length ? <ol aria-label="Agent 实际工具调用记录">{events.map(event => <li key={event.index} className={event.failed ? 'aw-agent-event-failed' : ''}>
      <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
      <span>{event.kind === 'tool_end' ? event.failed ? '×' : '✓' : '·'}</span><p>{event.message}</p>
    </li>)}</ol> : <p className="aw-muted">{run.model ? '执行后展示实际工具操作，不展示模型内部推理。' : '本次未启用 Agent。可在工作区设置中添加模型连接。'}</p>}
  </div>;
}

function markdown(report: AuditReport) {
  const text = (value: string) => value.replace(/\r/g, '').replace(/([\\`*_[\]<>])/g, '\\$1');
  return [`# RepoCare 项目体检报告`, '', `仓库：${text(report.repository.fullName)}`, `分支：${text(report.repository.branch)}`, `提交：${report.repository.sha}`, `生成时间：${report.generatedAt}`, '', `## 检查范围`, '', text(report.scope), '', `Agent 状态：${report.agentStatus === 'completed' ? '分析完成' : report.agentStatus === 'disabled' ? '未启用，仅规则检查' : '分析失败，保留规则结果'}`, ...(report.model ? ['', `模型：${text(report.model.name)} / ${text(report.model.modelId)} / v${report.model.revision}`] : []), '', ...report.warnings.flatMap(value => [`> ${text(value).replace(/\n/g, '\n> ')}`, '']), ...report.checks.flatMap(check => [
    `## ${text(check.title)} · ${checkLabels[check.status]}`, '', `类别：${check.category}；来源：${check.source === 'agent' ? 'Agent 分析' : '规则检查'}`, '', text(check.summary), '', '### 依据', '', ...check.evidence.flatMap(item => [`- 文件：${text(item.path)}`, ...(safeEvidenceUrl(item.url) ? [`  链接：${safeEvidenceUrl(item.url)}`] : []), ...(item.note ? [`  ${text(item.note)}`] : []), ...(item.excerpt ? ['', ...item.excerpt.split('\n').map(line => `    ${line}`), ''] : [])]), '', ...(check.suggestion ? ['### 改进建议', '', text(check.suggestion), ''] : []),
  ]), '---', '检查结论仅对应上述提交版本。配置存在不代表已执行或测试通过。', ''].join('\n');
}

function downloadReport(report: AuditReport, format: 'json' | 'md') {
  const content = format === 'json' ? JSON.stringify(report, null, 2) : markdown(report);
  const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `repocare-${report.repository.name}-${report.repository.sha.slice(0, 7)}.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Report({ report, onNotify }: { report: AuditReport; onNotify: (message: string) => void }) {
  const [filter, setFilter] = useState<(typeof filters)[number]>('全部');
  const [expanded, setExpanded] = useState<string | null>(null);
  const passed = report.checks.filter(item => item.status === 'pass').length;
  const attention = report.checks.filter(item => item.status === 'needs_attention').length;
  const unknown = report.checks.filter(item => item.status === 'unknown').length;
  const visible = report.checks.filter(item => filter === '全部' || item.category === filter).sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  return <section className="aw-report" aria-labelledby="aw-report-title">
    <div className="aw-section-heading"><div><span className="aw-section-label"><ShieldCheck size={15} aria-hidden="true" />本次体检报告</span><h2 id="aw-report-title">{report.repository.fullName}</h2><p><GitBranch size={13} aria-hidden="true" />{report.repository.branch}<code>{report.repository.sha.slice(0, 7)}</code><span>{dateLabel(report.generatedAt)}</span></p></div><div className="aw-downloads"><Link className="button button-secondary" href="/overview">查看项目概览</Link>{(['md', 'json'] as const).map(format => <button key={format} className="button button-secondary" onClick={() => { downloadReport(report, format); onNotify(`已导出 ${format === 'md' ? 'Markdown' : 'JSON'} 体检报告。`); }}><Download size={14} aria-hidden="true" />{format === 'md' ? 'Markdown' : 'JSON'}</button>)}</div></div>
    <div className="aw-report-stats"><div><strong>{passed}</strong><span><Check size={14} aria-hidden="true" />检查通过</span></div><div><strong>{attention}</strong><span><CircleDashed size={14} aria-hidden="true" />待完善</span></div><div><strong>{unknown}</strong><span><CircleHelp size={14} aria-hidden="true" />无法判断</span></div><p>{report.scope}<span>检查结果对应本次提交，不是项目质量评分。</span></p></div>
    {report.model && <div className="aw-report-model"><ModelStamp model={report.model} /></div>}
    {report.agentStatus !== 'completed' && <div className="aw-notice"><Info size={15} aria-hidden="true" /><p>{report.agentStatus === 'disabled' ? '本次仅执行规则检查，Agent 内容分析未启用。' : 'Agent 内容分析未完成，以下保留已完成的规则检查。'}</p></div>}
    {report.warnings.length > 0 && <div className="aw-notice aw-notice-warning"><Info size={15} aria-hidden="true" /><ul>{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    <div className="mv-section-title"><div><h2>维护检查清单</h2><p>先查看待完善项，展开结论可核对原始文件。</p></div><span className="mv-small-meta">共 {report.checks.length} 项检查</span></div>
    <div className="mv-filter-row" aria-label="按检查类别筛选">{filters.map(item => <button key={item} className={`mv-filter ${filter === item ? 'mv-filter-active' : ''}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}<span>{item === '全部' ? report.checks.length : report.checks.filter(check => check.category === item).length}</span></button>)}</div>
    <div className="mv-check-list"><div className="mv-list-head" aria-hidden="true"><span>检查项目</span><span>状态</span><span /></div>{visible.map(item => {
      const open = expanded === item.id;
      const statusClass = item.status === 'pass' ? 'passed' : item.status === 'needs_attention' ? 'pending' : 'unknown';
      return <article className={`mv-check ${open ? 'mv-check-open' : ''}`} key={item.id}><button type="button" className="mv-check-trigger" aria-expanded={open} aria-controls={`aw-check-${item.id}`} onClick={() => setExpanded(open ? null : item.id)}><span className="mv-check-name"><span className={`mv-check-symbol mv-${statusClass}`}>{item.status === 'pass' ? <Check size={15} aria-hidden="true" /> : item.status === 'unknown' ? <CircleHelp size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}</span><span><strong>{item.title}</strong><span className="mv-check-summary">{item.summary}</span></span></span><span className={`mv-check-status mv-status-${statusClass}`}>{checkLabels[item.status]}</span><ChevronDown size={16} className={open ? 'mv-chevron-open' : ''} aria-hidden="true" /></button>{open && <div id={`aw-check-${item.id}`} className="mv-check-detail"><div><span className="mv-detail-label"><FileText size={13} aria-hidden="true" />{item.source === 'agent' ? 'Agent 分析依据' : '规则检查依据'}</span><EvidenceList evidence={item.evidence} /></div><div><span className="mv-detail-label">改进建议</span><p>{item.suggestion || '本项暂无补充建议，请结合项目实际情况判断。'}</p></div></div>}</article>;
    })}{visible.length === 0 && <p className="aw-empty-filter">此类别暂无检查结果。</p>}</div>
    <div className="mv-bottom-note"><ShieldCheck size={15} aria-hidden="true" /><p>只读检查不会修改仓库，也不会运行仓库脚本。配置存在不代表测试通过；是否采用建议，由你决定。</p></div>
  </section>;
}

export function AuditView({ onNotify }: { onNotify: (message: string) => void }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [capabilities, setCapabilities] = useState<AuditCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [run, setRun] = useState<AuditRun | null>(null);
  const [history, setHistory] = useState<AuditRun[]>([]);
  const [selected, setSelected] = useState<NodeId>('repository');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [panel, setPanel] = useState<'conversation' | 'report'>('conversation');
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectedRunId = useRef<string | null>(null);
  const busy = useRef(false);
  const loadVersion = useRef(0);
  const active = !!run && !isTerminal(run.status);

  const updateSnapshot = useCallback((snapshot: AuditRun) => {
    if (selectedRunId.current !== snapshot.id) return;
    setRun(previous => previous && previous.id === snapshot.id && previous.seq > snapshot.seq ? previous : snapshot);
    setHistory(previous => {
      const existing = previous.find(item => item.id === snapshot.id);
      if (existing && existing.seq > snapshot.seq) return previous;
      return [snapshot, ...previous.filter(item => item.id !== snapshot.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    });
  }, []);

  const rememberRun = useCallback((id: string) => {
    selectedRunId.current = id;
    try { localStorage.setItem(lastRunKey, id); } catch { /* URL recovery remains available. */ }
    const url = new URL(window.location.href); url.searchParams.delete('new'); url.searchParams.set('run', id);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    selectedRunId.current = id; setLoading(true); setError(''); setRun(null); setConnected(false); setPanel('conversation'); setHistoryOpen(false);
    try {
      const snapshot = await request<AuditRun>(`/api/audit/runs/${encodeURIComponent(id)}`);
      if (version !== loadVersion.current) return;
      rememberRun(snapshot.id); updateSnapshot(snapshot); changed(); setRepoUrl(snapshot.repoUrl); setBranch(snapshot.branch || '');
      setSelected(snapshot.nodes.find(item => item.status === 'running')?.id || snapshot.nodes.find(item => item.status === 'failed')?.id || 'repository');
    } catch (cause) {
      if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : '无法读取体检任务，请重试。');
    } finally { if (version === loadVersion.current) setLoading(false); }
  }, [rememberRun, updateSnapshot]);

  useEffect(() => {
    let disposed = false;
    const fetchCapabilities = () => request<AuditCapabilities>('/api/audit/capabilities').then(value => { if (!disposed) { setCapabilities(value); setCapabilityError(false); } }).catch(() => { if (!disposed) setCapabilityError(true); });
    void (async () => {
      // This read does not rotate ownership; creation/settings bootstrap the session.
      await fetchCapabilities();
      if (disposed) return;
      void request<{ runs: AuditRun[] }>('/api/audit/runs?limit=8').then(value => {
        if (!disposed) setHistory(previous => [...new Map([...value.runs, ...previous].map(item => [item.id, item])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8));
      }).catch(() => { /* Run loading reports its own error. */ });
      const url = new URL(window.location.href);
      const id = url.searchParams.get('run');
      if (id) { void loadRun(id); return; }
      try {
        const overview = await request<Overview>('/api/workbench/overview');
        if (disposed) return;
        if (!url.searchParams.has('new') && overview.latestRun) { void loadRun(overview.latestRun.id); return; }
        if (overview.project) { setRepoUrl(overview.project.repoUrl); setBranch(overview.project.branch || ''); }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '项目读取失败，请重试。'); }
      if (!disposed) setLoading(false);
    })();
    const timer = window.setInterval(fetchCapabilities, 15000);
    const onPopState = () => { const value = new URL(window.location.href).searchParams.get('run'); if (value) void loadRun(value); };
    window.addEventListener('popstate', onPopState);
    return () => { disposed = true; ++loadVersion.current; window.clearInterval(timer); window.removeEventListener('popstate', onPopState); };
  }, [loadRun]);

  useEffect(() => {
    if (run && isTerminal(run.status)) changed();
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!run || isTerminal(run.status)) return;
    const id = run.id;
    let disposed = false;
    const source = new EventSource(`/api/audit/runs/${encodeURIComponent(id)}/events`);
    source.onopen = () => { if (!disposed) setConnected(true); };
    source.addEventListener('snapshot', event => {
      if (disposed) return;
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as AuditRun;
        if (snapshot.id !== id || !Array.isArray(snapshot.nodes)) return;
        updateSnapshot(snapshot); setConnected(true);
        if (isTerminal(snapshot.status)) source.close();
      } catch { setConnected(false); }
    });
    source.onerror = () => { if (!disposed) setConnected(false); };
    const timer = window.setInterval(() => {
      void request<AuditRun>(`/api/audit/runs/${encodeURIComponent(id)}`).then(snapshot => { if (!disposed) updateSnapshot(snapshot); }).catch(() => { if (!disposed) setConnected(false); });
    }, 10000);
    return () => { disposed = true; source.close(); window.clearInterval(timer); };
  }, [run?.id, active, updateSnapshot]); // A stream survives snapshots; reconnecting never creates a task.

  async function submit(event?: FormEvent, retryId?: string) {
    event?.preventDefault();
    if (busy.current || active) return;
    setError('');
    if (!retryId) {
      try {
        const url = new URL(repoUrl.trim());
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) throw new Error();
      } catch { setError('请输入GitHub 仓库地址，例如 https://github.com/owner/repository。'); return; }
    }
    busy.current = true; setSubmitting(true);
    try {
      const snapshot = await request<AuditRun>(retryId ? `/api/audit/runs/${encodeURIComponent(retryId)}/retry` : '/api/audit/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: retryId ? undefined : JSON.stringify({ repoUrl: repoUrl.trim(), branch: branch || undefined }) });
      ++loadVersion.current; rememberRun(snapshot.id); setRun(snapshot); updateSnapshot(snapshot); setSelected('repository'); setConnected(false); setLoading(false);
      setPanel('conversation'); changed();
      onNotify('体检任务已创建，将按真实执行进度更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建体检任务，请重试。'); }
    finally { busy.current = false; setSubmitting(false); }
  }

  async function cancel() {
    if (!run || !active || busy.current) return;
    busy.current = true; setSubmitting(true); setError('');
    try {
      updateSnapshot(await request<AuditRun>(`/api/audit/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' }));
      onNotify('已请求取消体检。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法取消，请重试。'); }
    finally { busy.current = false; setSubmitting(false); }
  }

  const selectedNode = run?.nodes.find(item => item.id === selected);
  const currentNode = run?.nodes.find(item => item.status === 'running');
  const finished = run?.nodes.filter(item => ['succeeded', 'skipped', 'cancelled', 'failed'].includes(item.status)).length || 0;
  const report = run && isTerminal(run.status) ? run.report : undefined;

  function newTask() {
    if (active || submitting) return;
    ++loadVersion.current; selectedRunId.current = null;
    setRun(null); setRepoUrl(''); setError(''); setLoading(false); setPanel('conversation'); setHistoryOpen(false);
    try { localStorage.removeItem(lastRunKey); } catch { /* Optional preference. */ }
    const url = new URL(window.location.href); url.searchParams.delete('run'); window.history.replaceState(window.history.state, '', url);
    window.setTimeout(() => document.getElementById('as-repo-url')?.focus(), 0);
  }
  const stages = run?.nodes || nodeDefinitions.map(item => ({ ...item, status: 'pending' as const, message: '等待发起任务' }));
  const summary = report ? `${report.checks.length} 项检查已完成，${report.checks.filter(item => item.status === 'needs_attention').length} 项待完善，${report.checks.filter(item => item.status === 'unknown').length} 项需要进一步确认。` : '';

  return <div className={`mv-page aw-page as-studio${panel === 'report' ? ' as-report-open' : ''}`}>
    {historyOpen && <section className="as-history-panel" id="as-history" aria-label="历史体检任务"><div><h2>最近任务</h2><button type="button" className="icon-button" aria-label="关闭历史任务" onClick={() => setHistoryOpen(false)}><X size={16} /></button></div>{history.length ? history.map(item => <button type="button" key={item.id} disabled={loading || submitting} aria-current={run?.id === item.id ? 'true' : undefined} onClick={() => void loadRun(item.id)}><GitBranch size={15} /><span><strong>{item.repository?.fullName || item.repoUrl.replace('https://github.com/', '')}</strong><small>{dateLabel(item.createdAt)} · {runLabels[item.status]}</small></span></button>) : <p>完成第一次体检后，可以在这里找回执行记录。</p>}</section>}
    <div className="as-workspace">
      <section className="as-main" aria-label="体检任务工作区">
        <div className="as-toolbar"><nav aria-label="任务视图">{([{ id: 'conversation', label: '任务对话', icon: MessageSquare }, { id: 'report', label: '体检报告', icon: FileText }] as const).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={panel === id} onClick={() => setPanel(id)}><Icon size={15} />{label}{id === 'report' && report && <span>{report.checks.length}</span>}</button>)}</nav><div className="as-toolbar-actions"><button type="button" className="icon-button" aria-label="历史任务" title="历史任务" aria-expanded={historyOpen} aria-controls="as-history" onClick={() => setHistoryOpen(value => !value)}><History size={16} /></button><button type="button" className="icon-button" aria-label="新任务" title="新任务" disabled={active || submitting} onClick={newTask}><Plus size={17} /></button></div></div>
        <div className="as-content" key={`${run?.id || 'new'}-${panel}`}>
          {loading ? <div className="aw-loading" role="status"><LoaderCircle size={19} className="aw-spin" />正在恢复任务…</div> : panel === 'report' ? report ? <Report key={report.runId} report={report} onNotify={onNotify} /> : <div className="as-placeholder"><FileText size={26} /><h2>报告会在这里汇总</h2><p>{active ? '体检正在进行。完成后可查看每项结论、原始证据并导出报告。' : '发起一次体检，获得有文件依据的维护建议。'}</p><button type="button" onClick={() => setPanel('conversation')}>返回任务对话</button></div> : !run ? <div className="as-welcome"><span className="as-welcome-icon"><Bot size={30} strokeWidth={1.5} /></span><h2>一起看看，这个项目还缺什么。</h2><p>填写 GitHub 仓库地址和分支，开始第一次体检。<br />完成后，项目概览会自动更新为真实项目数据。</p><div className="as-scope"><span><FileText size={16} />文档与贡献指南</span><span><GitBranch size={16} />协作模板</span><span><ShieldCheck size={16} />工程规范</span></div><button type="button" className="as-example" onClick={() => { setRepoUrl('https://github.com/octocat/Hello-World'); document.getElementById('as-repo-url')?.focus(); }}>试填示例仓库 <span>octocat/Hello-World</span></button></div> : <div className="as-conversation">
            <header className="as-task-context"><div className="as-message-meta">体检任务 <time>{dateLabel(run.createdAt)}</time></div><h1><a href={run.repoUrl} target="_blank" rel="noopener noreferrer">{run.repoUrl.replace('https://github.com/', '')}</a></h1><p>检查文档、协作规范与工程配置。</p></header>
            <article className="as-message as-agent-message"><span className="as-avatar"><Bot size={19} /></span><div className="as-message-body"><div className="as-message-meta">RepoCare <span>执行记录</span></div><p>{run.status === 'queued' ? '任务已收到，等待执行服务领取。' : '本次检查会固定到同一提交版本，所有文件引用都对应这个版本。'}</p>{run.repository && <div className="as-commit"><GitBranch size={13} /><span>{run.repository.branch}</span><code>{run.repository.sha.slice(0, 7)}</code></div>}
              <div className="as-stage-messages">{run.nodes.filter(item => item.status !== 'pending').map(item => <button type="button" className={`as-stage-message aw-text-${item.status}`} key={item.id} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}><StatusIcon status={item.status} /><span><span className="as-stage-title"><strong>{item.label}</strong><span className="as-stage-label">{statusLabels[item.status]}</span></span><small>{item.message}</small></span></button>)}</div>
              {run.agentEvents && run.agentEvents.length > 0 && <details className="as-tools"><summary>查看 {run.agentEvents.filter(event => event.kind === 'tool_start').length} 次工具调用与模型轮次</summary><AgentActivity run={run} /></details>}
              {active && <p className="as-live-status" role="status"><LoaderCircle size={14} className="aw-spin" />{currentNode?.message || '正在等待执行…'}</p>}
              {run.error && <p className="as-error" role="alert">{run.error}</p>}{run.status === 'cancelled' && <p>任务已取消，已有执行记录保留。可以重新发起体检。</p>}
              {!active && !report && <button type="button" className="as-retry" disabled={submitting} onClick={() => void submit(undefined, run.id)}><RefreshCw size={13} />重新体检最新提交</button>}
            </div></article>
            {report && <section className="as-result" aria-labelledby="as-result-title">
              <div className="as-result-heading"><span className="as-result-icon"><FileText size={24} aria-hidden="true" /></span><h2 id="as-result-title">{report.agentStatus === 'failed' ? '规则报告已生成，AI 分析未完成' : report.agentStatus === 'disabled' ? '基础规则报告已生成' : '体检报告已生成'}</h2></div>
              <p className="as-result-summary">{summary}</p>
              {report.agentStatus !== 'completed' && <p className="as-result-note">{report.agentStatus === 'disabled' ? '本次未启用模型，未包含 AI 内容分析。' : run.nodes.find(item => item.id === 'agent')?.message}</p>}
              <div className="as-result-actions"><button type="button" className="button button-primary" onClick={() => setPanel('report')}><FileText size={16} aria-hidden="true" />打开完整报告</button><Link className="as-result-link" href="/overview">查看项目概览</Link><Link className="as-result-link" href="/improvements">生成改进草稿</Link></div>
              <footer className="as-result-footer"><span>仓库有新提交？可重新体检更新报告。</span><button type="button" className="as-retry" disabled={submitting} onClick={() => void submit(undefined, run.id)}><RefreshCw size={14} aria-hidden="true" />{submitting ? '正在创建任务…' : '重新体检最新提交'}</button></footer>
              {error && <p className="as-error" role="alert">{error}</p>}
            </section>}
          </div>}
        </div>
        {panel === 'conversation' && !report && <div className="as-composer-area">
          {error && <div className="aw-notice aw-notice-error" role="alert"><Info size={15} /><p>{error}</p>{!run && selectedRunId.current && <button type="button" onClick={() => void loadRun(selectedRunId.current!)}>重新读取</button>}</div>}
          {!report && (active ? <div className="as-active-composer"><div><span>正在体检</span><strong>{run?.repository?.fullName || repoUrl.replace('https://github.com/', '')}</strong><small>{branch || run?.repository?.branch || '默认分支'} · 任务执行中，仓库地址已锁定</small></div><button type="button" className="as-cancel" aria-label="停止体检" disabled={submitting || run?.cancelRequested} onClick={() => void cancel()}>{run?.cancelRequested ? '正在停止…' : <><Square size={14} />停止体检</>}</button></div> : <><form className="as-composer" onSubmit={event => void submit(event)}><label htmlFor="as-repo-url">发送仓库，开始体检</label><div className="as-input-row"><input id="as-repo-url" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" required disabled={submitting || loading} autoComplete="off" spellCheck={false} aria-describedby="as-input-help" /><button type="submit" className="as-send" aria-label="发送仓库并开始体检" title="发送仓库并开始体检" disabled={submitting || loading || !repoUrl.trim()}>{submitting ? <LoaderCircle size={18} className="aw-spin" /> : <ArrowUp size={20} />}</button></div><div className="as-composer-meta"><label>分支<input aria-label="体检分支" value={branch} onChange={event => setBranch(event.target.value)} placeholder="默认分支" disabled={submitting} style={{ maxWidth: 130, border: 0, background: "transparent", color: "inherit" }} /></label><span><Bot size={13} />{capabilities?.model?.modelId || '基础规则模式'}</span><a href="/settings">配置模型</a></div></form><p id="as-input-help" className="as-input-help">公开仓库可直接体检 · 私有仓库请先在 <Link href="/settings">工作区设置</Link> 完成 GitHub 授权</p></>)}
        </div>}
      </section>
      <div className="as-inspector-shell" inert={panel === 'report'} aria-hidden={panel === 'report'}><div className="as-inspector-clip">
      <aside className="as-inspector" aria-label="执行轨迹与证据"><header><h2><ListTree size={16} />执行轨迹</h2><span>{finished} / 5</span></header><div className="as-service" role="status"><span className={`aw-state-dot ${capabilities?.workerOnline && !capabilityError ? 'aw-state-online' : ''}`} />{capabilityError ? '服务状态暂不可用' : capabilities?.workerOnline ? '执行服务在线' : '等待执行服务连接'}{active && <small>{connected ? '进度实时更新' : '正在重连进度'}</small>}</div>
        <ol className="as-timeline">{stages.map((item, index) => <li key={item.id}><button type="button" disabled={!run} aria-pressed={!!run && selected === item.id} onClick={() => setSelected(item.id)}><span className={`as-step-icon aw-text-${item.status}`}><StatusIcon status={item.status} /></span><span><strong>{item.label}</strong><small>{!run ? `步骤 ${index + 1}` : statusLabels[item.status]}</small></span></button></li>)}</ol>
        <section className="as-context"><h3>本次上下文</h3><dl><dt>仓库</dt><dd>{run?.repository?.fullName || run?.repoUrl.replace('https://github.com/', '') || '等待选择'}</dd><dt>模型</dt><dd>{run ? run.model?.modelId || '未启用，规则检查' : capabilities?.model?.modelId || '未配置'}</dd>{run?.repository && <><dt>提交</dt><dd><code>{run.repository.sha.slice(0, 7)}</code></dd></>}</dl>{capabilities?.modelError && <p className="as-warning">{capabilities.modelError}</p>}<a href="/settings">管理模型连接</a></section>
        {selectedNode && <section className="as-evidence"><h3>{selectedNode.label}<span className={`aw-text-${selectedNode.status}`}>{statusLabels[selectedNode.status]}</span></h3><p>{selectedNode.message}</p>{selectedNode.startedAt && <time>{dateLabel(selectedNode.startedAt)}{selectedNode.finishedAt && ` · ${Math.max(0, (Date.parse(selectedNode.finishedAt) - Date.parse(selectedNode.startedAt)) / 1000).toFixed(1)} 秒`}</time>}{selected === 'agent' && <AgentActivity run={run!} />}<h4>文件依据</h4><EvidenceList evidence={selectedNode.evidence || []} /></section>}
        {!run && <div className="as-boundary"><ShieldCheck size={18} /><p>读取公开文件，保留引用依据。<br />不会修改仓库或运行项目脚本。</p></div>}
      </aside>
      </div></div>
    </div>
  </div>;
}
