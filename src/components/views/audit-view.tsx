'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Check, ChevronDown, CircleDashed, CircleHelp, Clock3, Download, FileText, GitBranch, History, Info, LoaderCircle, Play, RefreshCw, ShieldCheck, Square, X } from 'lucide-react';
import { isTerminal, nodeDefinitions, type AuditCapabilities, type AuditNode, type AuditReport, type AuditRun, type Evidence, type NodeId, type NodeStatus, type RunStatus } from '@/lib/audit/types';
import '@xyflow/react/dist/style.css';
import './maintenance-views.css';
import './audit-workflow.css';
import type { ModelSelection } from '@/lib/models/types';

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

type FlowNodeData = { auditNode: AuditNode; index: number; vertical: boolean; active: boolean; select: (id: NodeId) => void };
type WorkflowNode = Node<FlowNodeData, 'audit'>;

function AuditFlowNode({ data }: NodeProps<WorkflowNode>) {
  const item = data.auditNode;
  return <div className={`aw-flow-node aw-node-${item.status} ${data.active ? 'aw-node-selected' : ''}`}>
    <Handle type="target" position={data.vertical ? Position.Top : Position.Left} isConnectable={false} />
    <button type="button" className="nodrag nopan" onClick={() => data.select(item.id)} aria-pressed={data.active} aria-label={`${data.index + 1}. ${item.label}，${statusLabels[item.status]}，查看详情`}>
      <span className="aw-node-top"><span className="aw-node-index">{String(data.index + 1).padStart(2, '0')}</span><StatusIcon status={item.status} /></span>
      <strong>{item.label}</strong><span className="aw-node-status">{statusLabels[item.status]}{typeof item.completed === 'number' && typeof item.total === 'number' && item.total > 0 ? ` · ${item.completed}/${item.total}` : ''}</span>
    </button>
    <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} isConnectable={false} />
  </div>;
}
const nodeTypes = { audit: AuditFlowNode };

function Workflow({ run, selected, onSelect }: { run: AuditRun; selected: NodeId; onSelect: (id: NodeId) => void }) {
  const [vertical, setVertical] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const resetViewport = useRef(() => {});
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let timer = 0;
    const fit = () => {
      const nodeHeight = element.querySelector<HTMLElement>('.aw-flow-node')?.offsetHeight || 94;
      const graphWidth = vertical ? 164 : 206 * (nodeDefinitions.length - 1) + 164;
      const graphHeight = vertical ? 141 * (nodeDefinitions.length - 1) + nodeHeight : nodeHeight;
      const zoom = Math.min(1.05, (element.clientWidth - 40) / graphWidth, (element.clientHeight - 40) / graphHeight);
      if (zoom > 0) setViewport({ x: (element.clientWidth - graphWidth * zoom) / 2, y: (element.clientHeight - graphHeight * zoom) / 2, zoom });
    };
    resetViewport.current = fit;
    const observer = new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(fit, 120); });
    observer.observe(element);
    timer = window.setTimeout(fit, 120);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [vertical]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const sync = () => setVertical(query.matches);
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const nodes = useMemo<WorkflowNode[]>(() => run.nodes.map((item, index) => ({
    id: item.id, type: 'audit', position: vertical ? { x: 0, y: index * 141 } : { x: index * 206, y: 0 },
    data: { auditNode: item, index, vertical, active: selected === item.id, select: onSelect },
    draggable: false, selectable: false, focusable: false,
  })), [run.nodes, selected, onSelect, vertical]);
  const edges = useMemo<Edge[]>(() => run.nodes.slice(1).map((item, index) => ({
    id: `${run.nodes[index].id}-${item.id}`, source: run.nodes[index].id, target: item.id, type: 'smoothstep', animated: false,
    className: item.status === 'running' || item.status === 'succeeded' ? 'aw-edge-active' : '',
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border-strong)', width: 16, height: 16 },
  })), [run.nodes]);
  return <div className="aw-flow" ref={container} aria-label="体检执行流程，选择节点查看详情">
    <ReactFlow<WorkflowNode> key={vertical ? 'vertical' : 'horizontal'} nodes={nodes} edges={edges} nodeTypes={nodeTypes} viewport={viewport} onViewportChange={setViewport} minZoom={.45} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesFocusable={false} nodesFocusable={false} zoomOnScroll={false} panOnScroll={false} preventScrolling={false} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大流程图', 'controls.zoomOut.ariaLabel': '缩小流程图', 'controls.fitView.ariaLabel': '适应画布' }}>
      <Background gap={22} size={1} color="var(--line)" />
      <Controls showInteractive={false} position="bottom-right" onFitView={() => resetViewport.current()} />
    </ReactFlow>
  </div>;
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
    <div className="aw-section-heading"><div><span className="aw-section-label"><ShieldCheck size={15} aria-hidden="true" />本次体检报告</span><h2 id="aw-report-title">{report.repository.fullName}</h2><p><GitBranch size={13} aria-hidden="true" />{report.repository.branch}<code>{report.repository.sha.slice(0, 7)}</code><span>{dateLabel(report.generatedAt)}</span></p></div><div className="aw-downloads">{(['md', 'json'] as const).map(format => <button key={format} className="button button-secondary" onClick={() => { downloadReport(report, format); onNotify(`已导出 ${format === 'md' ? 'Markdown' : 'JSON'} 体检报告。`); }}><Download size={14} aria-hidden="true" />{format === 'md' ? 'Markdown' : 'JSON'}</button>)}</div></div>
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
  const [capabilities, setCapabilities] = useState<AuditCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const [run, setRun] = useState<AuditRun | null>(null);
  const [history, setHistory] = useState<AuditRun[]>([]);
  const [selected, setSelected] = useState<NodeId>('repository');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [connected, setConnected] = useState(false);
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
    const url = new URL(window.location.href); url.searchParams.set('run', id);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const version = ++loadVersion.current;
    selectedRunId.current = id; setLoading(true); setError(''); setRun(null); setConnected(false);
    try {
      const snapshot = await request<AuditRun>(`/api/audit/runs/${encodeURIComponent(id)}`);
      if (version !== loadVersion.current) return;
      rememberRun(snapshot.id); updateSnapshot(snapshot); setRepoUrl(snapshot.repoUrl);
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
      let id = url.searchParams.get('run');
      if (!id) { try { id = localStorage.getItem(lastRunKey); } catch { /* No saved task. */ } }
      if (id) void loadRun(id); else setLoading(false);
    })();
    const timer = window.setInterval(fetchCapabilities, 15000);
    const onPopState = () => { const value = new URL(window.location.href).searchParams.get('run'); if (value) void loadRun(value); };
    window.addEventListener('popstate', onPopState);
    return () => { disposed = true; ++loadVersion.current; window.clearInterval(timer); window.removeEventListener('popstate', onPopState); };
  }, [loadRun]);

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
      } catch { setError('请输入公开 GitHub 仓库地址，例如 https://github.com/owner/repository。'); return; }
    }
    busy.current = true; setSubmitting(true);
    try {
      const snapshot = await request<AuditRun>(retryId ? `/api/audit/runs/${encodeURIComponent(retryId)}/retry` : '/api/audit/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: retryId ? undefined : JSON.stringify({ repoUrl: repoUrl.trim() }) });
      ++loadVersion.current; rememberRun(snapshot.id); setRun(snapshot); updateSnapshot(snapshot); setSelected('repository'); setConnected(false); setLoading(false);
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

  return <div className="mv-page aw-page">
    <div className="page-heading mv-heading"><div><span className="eyebrow">项目体检</span><h1>看清项目，维护有据。</h1><p>检查真实仓库的文档、协作规范与工程配置，每一步都有迹可循。</p></div><span className="aw-readonly"><ShieldCheck size={15} aria-hidden="true" />只读检查</span></div>
    <section className="aw-repo-entry" aria-labelledby="aw-repo-title"><div className="aw-entry-intro"><h2 id="aw-repo-title">从一个 GitHub 仓库开始</h2><p>支持公开仓库，检查默认分支的当前提交。</p></div><form className="aw-repo-form" onSubmit={event => void submit(event)}><div><label htmlFor="aw-repo-url">仓库地址</label><div className="aw-repo-input"><GitBranch size={17} aria-hidden="true" /><input id="aw-repo-url" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" required disabled={active || submitting} spellCheck={false} autoComplete="url" aria-describedby="aw-repo-help" /></div></div><button type="submit" className="button button-primary" disabled={active || submitting || loading}>{submitting && !active ? <LoaderCircle size={15} className="aw-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{active ? '体检进行中' : submitting ? '正在创建…' : '开始体检'}</button></form><div id="aw-repo-help" className="aw-capabilities"><span><span className={`aw-state-dot ${capabilities?.workerOnline && !capabilityError ? 'aw-state-online' : ''}`} />{capabilityError ? '执行服务状态暂时不可用' : capabilities ? capabilities.workerOnline ? '执行服务已连接' : '执行服务离线，任务将在启动后执行' : '正在连接执行服务…'}</span><span>{capabilities ? capabilities.agentConfigured ? '已启用 Agent 内容分析' : capabilities.model ? '默认模型配置待补全' : '仅规则检查 · Agent 未配置' : '正在读取检查能力'}</span>{capabilities && !capabilities.githubAuthenticated && <span>公开接口额度有限</span>}</div></section>
    <div className="aw-model-selection"><div>{capabilities?.model ? <><span>新任务使用</span><ModelStamp model={capabilities.model} /></> : <span>添加模型连接，启用文档内容分析。</span>}{capabilities?.modelError && <p role="status">{capabilities.modelError}</p>}</div><a href="/settings">模型设置</a></div>
    {error && <div className="aw-notice aw-notice-error" role="alert"><Info size={16} aria-hidden="true" /><p>{error}</p>{!run && selectedRunId.current && <button type="button" onClick={() => void loadRun(selectedRunId.current!)}>重新读取</button>}</div>}
    <div className="aw-history"><label htmlFor="aw-history-select"><History size={15} aria-hidden="true" />最近体检</label><select id="aw-history-select" value={run?.id || ''} disabled={submitting || loading || history.length === 0} onChange={event => { if (event.target.value) void loadRun(event.target.value); }}><option value="">{loading ? '正在恢复任务…' : history.length ? '选择一份执行记录' : '尚无体检记录'}</option>{history.map(item => <option key={item.id} value={item.id}>{item.repository?.fullName || item.repoUrl.replace('https://github.com/', '')} · {dateLabel(item.createdAt)} · {runLabels[item.status]}</option>)}</select>{run && <span className="aw-run-id">任务 {run.id.slice(0, 8)}</span>}</div>
    {loading && <div className="aw-loading" role="status"><LoaderCircle size={19} className="aw-spin" aria-hidden="true" />正在读取体检记录…</div>}
    {!loading && !run && <section className="aw-empty" aria-labelledby="aw-empty-title"><div className="aw-empty-symbol"><GitBranch size={29} strokeWidth={1.4} aria-hidden="true" /></div><h2 id="aw-empty-title">让每一项结论，都能回到项目本身。</h2><p>输入仓库地址后，系统会读取文件、核对规则，并将结果整理为可追溯的报告。</p><ol>{nodeDefinitions.map((item, index) => <li key={item.id}><span>{index + 1}</span>{item.label}</li>)}</ol><span className="aw-empty-caption">执行完成前不展示预设结果。未配置 Agent 时，仍可完成基础规则检查。</span></section>}
    {run && <section className="aw-execution" aria-labelledby="aw-execution-title"><div className="aw-execution-heading"><div><h2 id="aw-execution-title">{runLabels[run.status]}</h2><p role="status" aria-live="polite">{run.cancelRequested && active ? '正在结束当前操作，取消完成后将保留执行记录。' : currentNode ? `${currentNode.label}：${currentNode.message}` : run.status === 'queued' ? '任务已保存，正在等待执行服务领取。' : run.status === 'completed' ? '执行记录已保存，报告已生成。' : run.error || '你可以重新发起一次体检。'}</p></div><div className="aw-execution-actions">{active ? <button className="button button-secondary" onClick={() => void cancel()} disabled={submitting || run.cancelRequested}><Square size={13} aria-hidden="true" />{run.cancelRequested ? '取消中…' : '取消体检'}</button> : <button className="button button-secondary" onClick={() => void submit(undefined, run.id)} disabled={submitting}><RefreshCw size={14} aria-hidden="true" />重新体检</button>}</div></div><div className="aw-execution-meta"><span>{finished} / {run.nodes.length} 节点已结束</span><ModelStamp model={run.model} />{run.repository && <span><GitBranch size={12} aria-hidden="true" />{run.repository.fullName} / {run.repository.branch}<code>{run.repository.sha.slice(0, 7)}</code></span>}{active && <span className={connected ? '' : 'aw-reconnecting'}>{connected ? '实时进度已连接' : '正在重新连接 · 定期同步状态'}</span>}</div><Workflow run={run} selected={selected} onSelect={setSelected} />{selectedNode && <div className="aw-node-detail"><div><span className={`aw-node-detail-status aw-text-${selectedNode.status}`}><StatusIcon status={selectedNode.status} />{statusLabels[selectedNode.status]}</span><h3>{selectedNode.label}</h3><p>{selectedNode.message || '此节点将在前置步骤完成后执行。'}</p>{selectedNode.startedAt && <span className="aw-node-time">开始于 {dateLabel(selectedNode.startedAt)}{selectedNode.finishedAt ? `，用时 ${Math.max(0, (Date.parse(selectedNode.finishedAt) - Date.parse(selectedNode.startedAt)) / 1000).toFixed(1)} 秒` : ''}</span>}</div><div>{selected === 'agent' && <AgentActivity run={run} />}<span className="aw-detail-label">执行依据</span><EvidenceList evidence={selectedNode.evidence || []} /></div></div>}{run.error && <div className="aw-run-error" role="alert"><Info size={15} aria-hidden="true" />{run.error}</div>}</section>}
    {report && <Report key={report.runId} report={report} onNotify={onNotify} />}
  </div>;
}
