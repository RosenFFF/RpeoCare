'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowUpRight, Bot, Check, ChevronLeft, ChevronRight, CircleDot,
  Download, ExternalLink, FlaskConical, Globe2, Languages, List, MessageSquare, Play, RefreshCw, Search, ShieldCheck,
  Sparkles, Square, Tag, UserRound, X,
} from 'lucide-react';
import type {
  GitComment, GitItem, IssueCategory, IssuePriority, IssueReadinessLevel, IssueTriage, IssueWorkflowStatus, ReproductionJob,
} from '@/contracts/workbench';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

type CategoryFilter = 'all' | IssueCategory;
type StatusFilter = 'all' | IssueWorkflowStatus | 'untriaged';

const CATEGORY_META: Record<IssueCategory, { label: string; short: string; color: string }> = {
  bug: { label: 'Bug 报告', short: 'Bug', color: 'red' },
  feature: { label: '功能建议', short: '功能', color: 'blue' },
  question: { label: '使用咨询', short: '咨询', color: 'violet' },
  documentation: { label: '文档规范', short: '文档', color: 'amber' },
  performance: { label: '性能问题', short: '性能', color: 'orange' },
  compatibility: { label: '兼容性', short: '兼容', color: 'cyan' },
  security: { label: '安全问题', short: '安全', color: 'red' },
  other: { label: '其他', short: '其他', color: 'slate' },
};

const PRIORITY_META: Record<IssuePriority, { label: string; color: string }> = {
  high: { label: '高优先级', color: 'red' },
  medium: { label: '中优先级', color: 'amber' },
  low: { label: '低优先级', color: 'slate' },
  unknown: { label: '待判断', color: 'slate' },
};

const STATUS_META: Record<Exclude<StatusFilter, 'all' | 'untriaged'>, { label: string; color: string }> = {
  'needs-info': { label: '待补充信息', color: 'amber' },
  'ready-to-reproduce': { label: '准备复现', color: 'cyan' },
  'ready-to-reply': { label: '可以回复', color: 'blue' },
  investigate: { label: '需要调查', color: 'violet' },
  replied: { label: '已回复', color: 'green' },
  'manual-review': { label: '人工判断', color: 'slate' },
};

function triageStatus(triage?: IssueTriage): IssueWorkflowStatus | 'untriaged' {
  return triage?.workflowStatus || 'untriaged';
}
function statusLabel(status: StatusFilter) {
  if (status === 'all') return '全部处理状态';
  if (status === 'untriaged') return '尚未分诊';
  return STATUS_META[status].label;
}
function dateLabel(value: string) {
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }
  catch { return value; }
}
function categoryFor(item: GitItem) { return item.triage?.category || null; }
function commentTranslation(triage: IssueTriage | undefined, comment: GitComment) {
  return triage?.commentsZh.find(item => item.id === comment.id)?.bodyZh || '';
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`issue-badge issue-badge-${tone}`}>{children}</span>;
}

function IssueCard({ item, selected, onClick }: { item: GitItem; selected: boolean; onClick: () => void }) {
  const category = item.triage?.category ? CATEGORY_META[item.triage.category] : null;
  const priority = item.triage?.priority ? PRIORITY_META[item.triage.priority] : null;
  const status = triageStatus(item.triage);
  return <button type="button" className={`issue-list-row ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
    <span className="issue-row-marker" aria-hidden="true" />
    <span className="issue-row-main">
      <span className="issue-row-topline"><span className="issue-number">#{item.number}</span><strong>{item.title}</strong></span>
      <span className="issue-row-meta"><UserRound size={12} />{item.author || '未知作者'}<span className="issue-meta-separator" />{dateLabel(item.updatedAt)}<span className="issue-meta-separator" />{item.commentCount ?? item.comments?.length ?? 0} 条评论</span>
    </span>
    <span className="issue-row-tags">
      {category ? <Badge tone={category.color}>{category.short}</Badge> : <Badge tone="slate">未分诊</Badge>}
      {priority && priority.label !== '待判断' && <Badge tone={priority.color}>{priority.label.replace('优先级', '')}</Badge>}
      {status !== 'untriaged' && <Badge tone={STATUS_META[status as keyof typeof STATUS_META]?.color || 'slate'}>{statusLabel(status)}</Badge>}
    </span>
    <ChevronRight size={16} className="issue-row-chevron" aria-hidden="true" />
  </button>;
}

function Metric({ value, label, detail, tone }: { value: number; label: string; detail?: string; tone?: string }) {
  return <div className={`issue-metric ${tone ? `is-${tone}` : ''}`}><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>;
}

function TriageValue({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="issue-triage-value"><dt>{label}</dt><dd>{children}</dd></div>;
}

function TextList({ items, empty = '暂无记录' }: { items?: string[]; empty?: string }) {
  return items?.length ? <ul className="issue-text-list">{items.map(item => <li key={item}>{item}</li>)}</ul> : <span className="issue-empty-value">{empty}</span>;
}

function ReadinessBadge({ level }: { level?: IssueReadinessLevel }) {
  const meta = level === 'ready' ? { label: '可进入复现', tone: 'green' } : level === 'partial' ? { label: '部分准备', tone: 'amber' } : { label: '信息不足', tone: 'red' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function TriageReadiness({ triage, busy, onDraft, onReproduction }: { triage: IssueTriage; busy: boolean; onDraft: () => void; onReproduction: () => void }) {
  const score = Math.max(0, Math.min(100, triage.readinessScore ?? (triage.needsMoreInfo ? 45 : 70)));
  const level = triage.readinessLevel || (triage.needsMoreInfo ? 'partial' : 'ready');
  const canReproduce = triage.category === 'bug' && level === 'ready';
  return <section className="issue-readiness-card">
    <div className="issue-readiness-heading"><div><span className="issue-section-kicker">ACTION READINESS</span><h4>处理准备度</h4></div><ReadinessBadge level={level} /></div>
    <div className="issue-readiness-score"><strong>{score}</strong><span>/ 100</span><i><b style={{ width: `${score}%` }} /></i></div>
    <p className="issue-readiness-copy">{level === 'ready' ? '信息已基本满足项目级调查或复现准备条件。' : level === 'partial' ? '可以继续人工调查，但建议先补齐关键环境或行为信息。' : '当前更适合先向贡献者请求补充信息，不建议直接执行复现。'}</p>
    <div className="issue-readiness-columns"><div><strong>判断依据</strong><TextList items={triage.rationale} empty="暂无依据" /></div><div><strong>阻塞项</strong><TextList items={triage.readinessBlockers} empty="没有标记的阻塞项" /></div></div>
    <div className="issue-next-actions"><span>建议下一步</span><div>{canReproduce ? <button type="button" className="button button-primary" onClick={onReproduction} disabled={busy}><FlaskConical size={12} />生成复现方案</button> : <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={12} />生成补充信息回复</button>}{canReproduce && <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={12} />生成回复草稿</button>}</div></div>
  </section>;
}

function TriageReview({ triage, busy, onReview }: { triage: IssueTriage; busy: boolean; onReview: (change: { category: IssueCategory; priority: IssuePriority; status: IssueWorkflowStatus; note?: string }) => void }) {
  const [category, setCategory] = useState<IssueCategory>(triage.review?.category || triage.category);
  const [priority, setPriority] = useState<IssuePriority>(triage.review?.priority || triage.priority);
  const [status, setStatus] = useState<IssueWorkflowStatus>(triage.review?.workflowStatus || triage.workflowStatus);
  const [note, setNote] = useState(triage.review?.note || '');
  useEffect(() => { setCategory(triage.review?.category || triage.category); setPriority(triage.review?.priority || triage.priority); setStatus(triage.review?.workflowStatus || triage.workflowStatus); setNote(triage.review?.note || ''); }, [triage.analyzedAt, triage.review?.confirmedAt]);
  const confirmed = Boolean(triage.review?.confirmedAt);
  return <section className="issue-review-card"><div className="issue-review-heading"><div><span className="issue-section-kicker">MAINTAINER REVIEW</span><h4>维护者确认</h4></div><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '已确认' : '待确认'}</Badge></div><p>AI 结果只是建议。确认后会记录维护者最终判断，不覆盖原始 AI 分析。</p><div className="issue-review-fields"><label><span>最终类型</span><select value={category} onChange={event => setCategory(event.target.value as IssueCategory)} disabled={busy}>{Object.entries(CATEGORY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span>最终优先级</span><select value={priority} onChange={event => setPriority(event.target.value as IssuePriority)} disabled={busy}>{Object.entries(PRIORITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span>最终状态</span><select value={status} onChange={event => setStatus(event.target.value as IssueWorkflowStatus)} disabled={busy}>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="可选：记录人工判断依据" maxLength={1000} disabled={busy} /><button type="button" className="button button-secondary" onClick={() => onReview({ category, priority, status, note })} disabled={busy}>保存维护者判断</button></section>;
}

function SimilarIssues({ items, onOpen }: { items: GitItem[]; onOpen: (item: GitItem) => void }) {
  if (!items.length) return null;
  return <section className="issue-aside-section issue-similar-section"><div className="issue-aside-heading"><div><span className="issue-section-kicker">RELATED SIGNALS</span><h3><CircleDot size={16} />可能相关</h3></div><span className="issue-section-count">本页候选</span></div><p className="issue-similar-note">基于标题、正文和分诊类型的轻量匹配，仅供维护者确认，不会自动标记重复。</p><div className="issue-similar-list">{items.map(item => <button key={item.number} type="button" onClick={() => onOpen(item)}><span><b>#{item.number}</b>{item.title}</span><ChevronRight size={13} /></button>)}</div></section>;
}

function IssueConversation({ item, triage }: { item: GitItem; triage?: IssueTriage }) {
  const comments = item.comments || [];
  return <section className="issue-detail-section issue-conversation-section">
    <div className="issue-section-heading"><div><span className="issue-section-kicker">CONVERSATION</span><h3><MessageSquare size={16} />讨论时间线</h3></div><span className="issue-section-count">{comments.length + 1} 条内容</span></div>
    <div className="issue-timeline">
      <article className="issue-timeline-entry is-root">
        <div className="issue-timeline-avatar"><CircleDot size={15} /></div>
        <div className="issue-timeline-content">
          <div className="issue-timeline-meta"><strong>{item.author || '未知作者'}</strong><span>Issue 正文 · {dateLabel(item.updatedAt)}</span></div>
          <div className="issue-language-columns"><div><span className="issue-language-label"><Globe2 size={12} />原文</span><pre>{item.body || '没有描述'}</pre></div><div className="issue-translation"><span className="issue-language-label"><Languages size={12} />中文译文</span><p>{triage?.bodyZh || '完成 AI 分诊后显示中文翻译。'}</p></div></div>
        </div>
      </article>
      {comments.map(comment => <article className="issue-timeline-entry" key={comment.id}>
        <div className="issue-timeline-avatar"><MessageSquare size={14} /></div>
        <div className="issue-timeline-content">
          <div className="issue-timeline-meta"><strong>{comment.author || '未知作者'}</strong><span>评论 · {dateLabel(comment.createdAt)}</span><a href={comment.url} target="_blank" rel="noopener noreferrer" aria-label={`在 GitHub 查看评论 ${comment.id}`}><ExternalLink size={12} /></a></div>
          <div className="issue-language-columns"><div><span className="issue-language-label"><Globe2 size={12} />原文</span><pre>{comment.body || '空评论'}</pre></div><div className="issue-translation"><span className="issue-language-label"><Languages size={12} />中文译文</span><p>{commentTranslation(triage, comment) || '完成 AI 分诊后显示中文翻译。'}</p></div></div>
        </div>
      </article>)}
    </div>
  </section>;
}

function IssueMaintenance({ item, canWrite, busy, onUpdate }: { item: GitItem; canWrite: boolean; busy: boolean; onUpdate: (change: { state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] }) => void }) {
  const [labels, setLabels] = useState(item.labels.join(', '));
  const [assignees, setAssignees] = useState((item.assignees || []).join(', '));
  const [pending, setPending] = useState<{ state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] } | null>(null);
  useEffect(() => { setLabels(item.labels.join(', ')); setAssignees((item.assignees || []).join(', ')); }, [item.number, item.updatedAt, item.labels.join('|'), (item.assignees || []).join('|')]);
  const split = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
  const save = (state?: 'open' | 'closed') => setPending({ state, labels: split(labels), assignees: split(assignees) });
  return <section className="issue-aside-section issue-maintenance-section"><div className="issue-aside-heading"><div><span className="issue-section-kicker">GITHUB ACTIONS</span><h3><ShieldCheck size={16} />维护动作</h3></div>{canWrite ? <Badge tone="green">可写入</Badge> : <Badge>只读</Badge>}</div>{!canWrite ? <p className="issue-maintenance-note">连接有写入权限的 GitHub 账户后，可以在确认后修改状态、标签和指派人。</p> : <><div className="issue-maintenance-state"><span>Issue 状态</span><div><button type="button" className={item.state === 'open' ? 'is-active' : ''} onClick={() => save('open')} disabled={busy}>开放</button><button type="button" className={item.state === 'closed' ? 'is-active' : ''} onClick={() => save('closed')} disabled={busy}>关闭</button></div></div><label className="issue-maintenance-field"><span>标签 <small>用逗号分隔</small></span><input value={labels} onChange={event => setLabels(event.target.value)} disabled={busy} /></label><label className="issue-maintenance-field"><span>指派给 <small>GitHub 用户名，用逗号分隔</small></span><input value={assignees} onChange={event => setAssignees(event.target.value)} disabled={busy} /></label><button type="button" className="button button-secondary issue-maintenance-save" onClick={() => save()} disabled={busy}>保存标签与指派</button>{item.triage?.suggestedLabels.some(label => !item.labels.includes(label)) && <button type="button" className="issue-apply-suggestions" onClick={() => { setLabels([...new Set([...item.labels, ...item.triage!.suggestedLabels])].join(', ')); }}>应用 AI 建议标签到编辑框</button>}{pending && <div className="issue-maintenance-confirm"><p>确认将这些维护动作写入 GitHub？</p><div><button type="button" className="button button-primary" onClick={() => { onUpdate(pending); setPending(null); }} disabled={busy}>确认写入</button><button type="button" className="button button-secondary" onClick={() => setPending(null)} disabled={busy}>取消</button></div></div>}</>}</section>;
}


const REPRO_STATUS: Record<ReproductionJob['status'], { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'slate' },
  'awaiting-confirmation': { label: '等待确认', tone: 'amber' },
  queued: { label: '排队中', tone: 'blue' },
  running: { label: '隔离执行中', tone: 'blue' },
  reproduced: { label: '稳定复现', tone: 'green' },
  'not-reproduced': { label: '未稳定复现', tone: 'amber' },
  blocked: { label: '环境阻塞', tone: 'amber' },
  unsafe: { label: '计划不安全', tone: 'red' },
  failed: { label: '执行失败', tone: 'red' },
  cancelled: { label: '已取消', tone: 'slate' },
};
const REPRO_MODE: Record<ReproductionJob['plan']['mode'], string> = { browser: '浏览器交互', http: 'HTTP 接口', test: '项目测试', command: '命令验证' };
const EVIDENCE_LABEL: Record<string, string> = { stdout: '标准输出', stderr: '错误输出', screenshot: '页面截图', trace: '浏览器 Trace', video: '操作视频', network: '网络记录', console: '控制台', stacktrace: '堆栈', 'test-result': '测试结果', plan: '执行计划', result: '机器结果', 'source-log': '源码快照日志' };

const REPRO_PHASES: { id: NonNullable<ReproductionJob['phase']>; label: string; detail: string }[] = [
  { id: 'planning', label: '方案确认', detail: '审阅机器判据、风险和执行步骤' },
  { id: 'source', label: '准备固定版本', detail: '获取仓库并锁定提交 SHA' },
  { id: 'dependencies', label: '准备测试依赖', detail: '按计划准备项目依赖' },
  { id: 'execution', label: '隔离执行验证', detail: '在 Runner 中执行测试步骤' },
  { id: 'evidence', label: '整理证据报告', detail: '收集日志、截图并生成结论' },
];
const REPRO_PHASE_ORDER = new Map(REPRO_PHASES.map((phase, index) => [phase.id, index]));
const RUNNING_REPRO_STATUSES: ReproductionJob['status'][] = ['queued', 'running'];
const TERMINAL_REPRO_STATUSES: ReproductionJob['status'][] = ['reproduced', 'not-reproduced', 'blocked', 'unsafe', 'failed', 'cancelled'];

function phaseState(job: ReproductionJob, phase: typeof REPRO_PHASES[number]['id']) {
  const current = job.phase || 'planning';
  const currentIndex = REPRO_PHASE_ORDER.get(current) ?? 0;
  const phaseIndex = REPRO_PHASE_ORDER.get(phase) ?? 0;
  if (TERMINAL_REPRO_STATUSES.includes(job.status)) {
    if (job.status === 'reproduced' || job.status === 'not-reproduced') return phase === 'evidence' ? 'done' : phaseIndex <= 4 ? 'done' : 'pending';
    if (job.status === 'blocked' || job.status === 'failed' || job.status === 'unsafe' || job.status === 'cancelled') return phaseIndex < currentIndex ? 'done' : phase === current ? 'error' : 'pending';
  }
  if (phase === current) return 'active';
  return phaseIndex < currentIndex ? 'done' : 'pending';
}

function ReproductionTimeline({ job }: { job: ReproductionJob }) {
  const currentStep = job.currentStep || 0;
  const totalSteps = job.totalSteps || job.plan.setup.length + job.plan.steps.length;
  const stepPercent = totalSteps ? Math.min(100, Math.round(currentStep / totalSteps * 100)) : 0;
  return <section className="issue-repro-timeline" aria-label="复现执行流程">
    <div className="issue-repro-timeline-heading"><div><span>执行流程</span><strong>{job.status === 'running' ? '后台正在执行隔离验证' : job.status === 'queued' ? '已进入执行队列' : job.status === 'awaiting-confirmation' ? '等待维护者确认' : job.status === 'reproduced' || job.status === 'not-reproduced' ? '验证流程已完成' : '流程已停止'}</strong></div><span>{job.currentAttempt ? `第 ${job.currentAttempt} / ${job.totalAttempts || 3} 次` : '尚未开始'}</span></div>
    <ol className="issue-repro-timeline-list">{REPRO_PHASES.map(phase => { const state = phaseState(job, phase.id); return <li key={phase.id} className={`is-${state}`}><span className="issue-repro-timeline-marker" aria-hidden="true">{state === 'done' ? '✓' : state === 'error' ? '!' : REPRO_PHASES.indexOf(phase) + 1}</span><div><strong>{phase.label}</strong><small>{state === 'active' ? (job.currentStepLabel || job.progress || phase.detail) : phase.detail}</small></div></li>; })}</ol>
    {(RUNNING_REPRO_STATUSES.includes(job.status) || job.phase === 'dependencies' || job.phase === 'execution') && <div className="issue-repro-live-progress"><div className="issue-repro-live-progress-top"><span>{job.currentStepLabel || job.progress || '正在执行'}</span><strong>{currentStep}/{totalSteps} 步</strong></div><div className="issue-repro-progress-track"><i style={{ width: `${stepPercent}%` }} /></div><small>{job.phase === 'dependencies' ? '依赖准备阶段可能需要更长时间；执行期会自动关闭网络。' : '页面每 2 秒同步一次 Worker 状态，离开页面后任务仍会继续。'}</small></div>}
  </section>;
}

function ReproductionPanel({ jobs, selectedId, workerOnline, sandboxConfigured, busy, onAction, onSelect }: {
  jobs: ReproductionJob[];
  selectedId: string | null;
  workerOnline: boolean;
  sandboxConfigured: boolean;
  busy: boolean;
  onAction: (action: 'confirm' | 'cancel' | 'refresh', jobId: string) => void;
  onSelect: (jobId: string) => void;
}) {
  const job = jobs.find(item => item.id === selectedId) || jobs[0];
  if (!job) return null;
  const status = REPRO_STATUS[job.status];
  const terminal = TERMINAL_REPRO_STATUSES.includes(job.status);
  return <section className={`issue-repro-panel is-${job.status}`}>
    <div className="issue-repro-heading">
      <div><span className="issue-section-kicker">REPRODUCTION LAB / EVIDENCE FIRST</span><h3><FlaskConical size={17} />Bug 复现实验</h3></div>
      <div className="issue-repro-state"><span className={`issue-worker-dot ${workerOnline ? 'is-online' : ''}`} />{workerOnline ? '队列 Worker 在线' : '队列 Worker 离线'}<Badge tone={sandboxConfigured ? 'green' : 'amber'}>{sandboxConfigured ? 'Docker 沙箱已启用' : 'Docker 沙箱关闭'}</Badge><Badge tone={status.tone}>{status.label}</Badge></div>
    </div>
    {jobs.length > 1 && <div className="issue-repro-history" aria-label="复现任务历史">{jobs.map(item => <button type="button" key={item.id} className={item.id === job.id ? 'is-active' : ''} onClick={() => onSelect(item.id)} aria-pressed={item.id === job.id}><span>#{item.issueNumber} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span><Badge tone={REPRO_STATUS[item.status].tone}>{REPRO_STATUS[item.status].label}</Badge></button>)}</div>}
    <ReproductionTimeline job={job} />
    <div className="issue-repro-overview"><div><span>固定提交</span><strong>{job.commitSha ? job.commitSha.slice(0, 12) : '已记录于计划'}</strong></div><div><span>复现策略</span><strong>{REPRO_MODE[job.plan.mode]}</strong></div><div><span>置信度</span><strong>{job.plan.confidence === 'high' ? '高' : job.plan.confidence === 'medium' ? '中' : '低'}</strong></div><div><span>机器判据</span><strong>{job.plan.oracle.type} = {job.plan.oracle.value}</strong></div><div><span>稳定性</span><strong>{job.attempts ? `${job.successfulAttempts}/${job.attempts} 次命中` : '等待执行'}</strong></div></div>
    <p className="issue-repro-summary">{job.plan.summary}</p>
    {(job.progress || job.error) && <div className={`issue-repro-progress ${job.error ? 'is-error' : ''}`}><span>{job.phase ? `阶段 · ${job.phase}` : '状态'}</span><p>{job.error || job.progress}</p></div>}
    <div className="issue-repro-columns">
      <details open><summary>环境与执行步骤 <span>{job.plan.setup.length + job.plan.steps.length} 步</span></summary><div className="issue-repro-detail"><p className="issue-repro-expected"><span>预期故障</span>{job.plan.expected}</p>{job.plan.setup.length > 0 && <ol>{job.plan.setup.map((step, index) => <li key={`setup-${index}`}><b>准备</b><code>{step.command || step.path || step.target || step.type}</code></li>)}</ol>}<ol>{job.plan.steps.map((step, index) => <li key={`step-${index}`}><b>{index + 1}</b><code>{step.command || step.target || step.path || step.type}</code>{step.expected && <small>{step.expected}</small>}</li>)}</ol></div></details>
      <details><summary>风险、缺失信息与证据 <span>{job.plan.evidence.length} 类证据</span></summary><div className="issue-repro-detail"><div className="issue-repro-chipset">{job.plan.evidence.map(item => <span key={item}>{EVIDENCE_LABEL[item] || item}</span>)}</div>{job.plan.missingInformation.length > 0 && <div className="issue-repro-note is-warning"><strong>仍缺少</strong><TextList items={job.plan.missingInformation} /></div>}{job.plan.risks.length > 0 && <div className="issue-repro-note"><strong>执行风险</strong><TextList items={job.plan.risks} /></div>}</div></details>
    </div>
    {job.attemptHistory.length > 0 && <div className="issue-repro-attempts">{job.attemptHistory.map(attempt => <div key={attempt.index} className={`is-${attempt.result}`}><span>尝试 {attempt.index}</span><strong>{attempt.result === 'reproduced' ? '命中故障' : attempt.result === 'not-reproduced' ? '未命中' : '执行失败'}</strong><small>{(attempt.durationMs / 1000).toFixed(1)}s · {attempt.summary}</small></div>)}</div>}
    {job.artifacts.length > 0 && <div className="issue-repro-evidence"><div><span>证据链</span><small>每个文件均记录 SHA-256，下载时重新校验</small></div><div>{job.artifacts.map(artifact => <a key={artifact.id} href={`/api/workbench/reproduction/artifacts/${artifact.id}?job=${job.id}`}><Download size={12} />{EVIDENCE_LABEL[artifact.kind] || artifact.kind}<small>{Math.max(1, Math.round(artifact.size / 1024))} KB</small></a>)}</div></div>}
    <div className="issue-repro-actions">
      {job.status === 'awaiting-confirmation' && <button type="button" className="button button-primary" onClick={() => onAction('confirm', job.id)} disabled={busy}><Play size={13} />确认隔离执行</button>}
      {['awaiting-confirmation', 'queued'].includes(job.status) && <button type="button" className="button button-secondary" onClick={() => onAction('cancel', job.id)} disabled={busy}><Square size={12} />取消任务</button>}
      {(job.status === 'queued' || job.status === 'running' || terminal) && <button type="button" className="button button-secondary" onClick={() => onAction('refresh', job.id)} disabled={busy}><RefreshCw size={12} />刷新状态</button>}
      {!sandboxConfigured && job.status === 'awaiting-confirmation' && <span className="issue-repro-blocked-note">Docker Runner 未启用。确认后任务会安全阻塞，不会在宿主机执行。</span>}
      {sandboxConfigured && !workerOnline && job.status === 'awaiting-confirmation' && <span className="issue-repro-blocked-note">复现 Worker 离线。确认后进入队列，Worker 启动后才会执行。</span>}
      {job.status !== 'awaiting-confirmation' && <span>每次执行使用固定 commit；执行期断网、只读根文件系统、无 capabilities，并限制 CPU / 内存 / 进程数。</span>}
    </div>
  </section>;
}
function IssueDetail({ item, relatedItems, busy, canWrite, reproductions, reproductionSelectedId, reproductionWorkerOnline, reproductionSandboxConfigured, onReproduction, onSelectReproduction, onAnalyze, onDraft, onStatus, onUpdate, onShowList, onOpenRelated, onReview }: { item: GitItem; relatedItems: GitItem[]; busy: boolean; canWrite: boolean; reproductions: ReproductionJob[]; reproductionSelectedId: string | null; reproductionWorkerOnline: boolean; reproductionSandboxConfigured: boolean; onReproduction: (action: 'plan' | 'confirm' | 'cancel' | 'refresh', jobId?: string) => void; onSelectReproduction: (id: string) => void; onAnalyze: (force?: boolean) => void; onDraft: () => void; onStatus: (status: IssueWorkflowStatus) => void; onUpdate: (change: { state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] }) => void; onShowList: () => void; onOpenRelated: (item: GitItem) => void; onReview: (change: { category: IssueCategory; priority: IssuePriority; status: IssueWorkflowStatus; note?: string }) => void }) {

  const triage = item.triage;
  const category = triage?.category ? CATEGORY_META[triage.category] : null;
  const priority = triage?.priority ? PRIORITY_META[triage.priority] : null;
  const confirmedCategory = triage?.review?.category ? CATEGORY_META[triage.review.category] : null;
  const confirmedPriority = triage?.review?.priority ? PRIORITY_META[triage.review.priority] : null;
  const fresh = Boolean(triage && triage.sourceUpdatedAt === item.updatedAt);
  return <section className="issue-detail-panel" aria-label={`Issue #${item.number} 详情`}>
    <header className="issue-detail-header">
      <div className="issue-detail-title"><div className="issue-detail-eyebrow"><span>ISSUE #{item.number}</span><span className={`issue-state-dot ${item.state === 'open' ? 'is-open' : ''}`} />{item.state === 'open' ? '开放中' : '已关闭'}</div><h2>{item.title}</h2>{triage?.titleZh && <p className="issue-title-translation"><Languages size={13} />{triage.titleZh}</p>}<div className="issue-detail-meta"><span><UserRound size={13} />{item.author || '未知作者'}</span><span>更新于 {dateLabel(item.updatedAt)}</span>{item.assignees?.length ? <span>指派给 {item.assignees.join(', ')}</span> : <span>尚未指派</span>}{item.milestone && <span>里程碑：{item.milestone}</span>}</div></div>
      <div className="issue-detail-actions"><button type="button" className="button button-secondary issue-show-list" onClick={onShowList} disabled={busy}><List size={14} />显示 Issue 列表</button><a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />GitHub</a>{triage?.category === 'bug' && triage.readinessLevel === 'ready' ? <button type="button" className="button button-secondary" onClick={() => onReproduction('plan')} disabled={busy}><Sparkles size={14} />生成复现方案</button> : triage ? <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={14} />先补充信息</button> : null}<button type="button" className="button button-primary" onClick={onDraft} disabled={busy}><MessageSquare size={14} />生成回复草稿</button></div>
    </header>
    <div className="issue-detail-statusbar"><div className="issue-status-summary">{category ? <Badge tone={category.color}>AI：{category.label}</Badge> : <Badge>尚未分诊</Badge>}{priority && <Badge tone={priority.color}>AI：{priority.label}</Badge>}{confirmedCategory && <Badge tone={confirmedCategory.color}>最终：{confirmedCategory.label}</Badge>}{confirmedPriority && <Badge tone={confirmedPriority.color}>最终：{confirmedPriority.label}</Badge>}{triage?.needsMoreInfo && <Badge tone="amber">需要补充信息</Badge>}<span className="issue-source-note">{triage ? (fresh ? `AI 分析于 ${dateLabel(triage.analyzedAt)}` : '原文已更新，需要重新分析') : '尚未建立 AI 分诊建议'}</span></div><div className="issue-detail-status-actions">{triage && <label className="issue-status-select"><span>处理状态</span><select value={triage.workflowStatus} onChange={event => onStatus(event.target.value as IssueWorkflowStatus)} disabled={busy}>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>}<button type="button" className="button button-secondary" onClick={() => onAnalyze(Boolean(triage))} disabled={busy}><RefreshCw size={14} />{busy ? '处理中…' : triage ? '重新分析' : '开始 AI 分诊'}</button></div></div>
    {reproductions.length > 0 && <ReproductionPanel jobs={reproductions} selectedId={reproductionSelectedId} workerOnline={reproductionWorkerOnline} sandboxConfigured={reproductionSandboxConfigured} busy={busy} onAction={onReproduction} onSelect={onSelectReproduction} />}
    <div className="issue-detail-body">
      <div className="issue-detail-main"><IssueConversation item={item} triage={triage} /></div>
      <aside className="issue-detail-aside">
        <section className="issue-aside-section issue-triage-card"><div className="issue-aside-heading"><div><span className="issue-section-kicker">AI TRIAGE</span><h3><Bot size={16} />分诊建议</h3></div>{triage && <Badge tone="blue">建议</Badge>}</div>{!triage ? <div className="issue-aside-empty"><Sparkles size={22} /><p>分析后会提取问题类型、优先级、缺失信息和下一步建议。</p><button type="button" className="button button-primary" onClick={() => onAnalyze(false)} disabled={busy}>分析并翻译</button></div> : <><dl className="issue-triage-grid"><TriageValue label="问题类型"><Badge tone={category?.color}>{category?.label || '其他'}</Badge></TriageValue><TriageValue label="优先级"><Badge tone={priority?.color}>{priority?.label || '待判断'}</Badge></TriageValue><TriageValue label="置信度"><span className="issue-confidence">{triage.confidence === 'high' ? '高' : triage.confidence === 'medium' ? '中' : '低'}</span></TriageValue><TriageValue label="建议动作"><span>{({ 'request-information': '请求补充信息', reply: '直接回复', investigate: '先调查', 'consider-feature': '评估功能', close: '考虑关闭', 'manual-review': '人工判断' } as Record<string, string>)[triage.suggestedAction]}</span></TriageValue></dl><div className="issue-triage-callout"><ShieldCheck size={15} /><span>{triage.summaryZh}</span></div><TriageReadiness triage={triage} busy={busy} onDraft={onDraft} onReproduction={() => onReproduction('plan')} /><div className="issue-fact-block"><h4>实际 / 预期 / 环境</h4><dl><TriageValue label="实际行为">{triage.actualBehavior || '未提取'}</TriageValue><TriageValue label="预期行为">{triage.expectedBehavior || '未说明'}</TriageValue><TriageValue label="运行环境">{triage.environment || '未提供'}</TriageValue></dl></div></>}</section>
        {triage && <><section className="issue-aside-section"><div className="issue-aside-heading"><h3><AlertCircle size={16} />还缺什么</h3><span className="issue-section-count">{triage.missingInformation.length} 项</span></div><TextList items={triage.missingInformation} /></section><section className="issue-aside-section"><div className="issue-aside-heading"><h3><Check size={16} />已经提供</h3></div><TextList items={triage.providedInformation} empty="模型没有识别到明确上下文" /></section><section className="issue-aside-section"><div className="issue-aside-heading"><h3><Tag size={16} />建议标签</h3></div><div className="issue-label-cloud">{triage.suggestedLabels.length ? triage.suggestedLabels.map(label => <Badge key={label} tone="slate">{label}</Badge>) : <span className="issue-empty-value">暂无建议</span>}</div></section></>} {triage && <TriageReview triage={triage} busy={busy} onReview={onReview} />}<SimilarIssues items={relatedItems} onOpen={onOpenRelated} /><IssueMaintenance item={item} canWrite={canWrite} busy={busy} onUpdate={onUpdate} />
      </aside>
    </div>
  </section>;
}

export function GitItems({ kind }: { kind: 'issues' | 'pulls' }) {
  const { data } = useWorkbench();
  const [items, setItems] = useState<GitItem[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategory] = useState<CategoryFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reproductions, setReproductions] = useState<ReproductionJob[]>([]);
  const [reproductionWorkerOnline, setReproductionWorkerOnline] = useState(false);
  const [reproductionSandboxConfigured, setReproductionSandboxConfigured] = useState(false);
  const [selectedReproductionId, setSelectedReproductionId] = useState<string | null>(null);
  const isIssues = kind === 'issues';

  const load = useCallback(async (keepSelection = true) => {
    if (!data?.project) return;
    setError('');
    try {
      const value = await api<{ items: GitItem[] }>(`/api/workbench/items?kind=${kind}&page=${page}`);
      setItems(value.items);
      if (!keepSelection || (selectedNumber && !value.items.some(item => item.number === selectedNumber))) setSelectedNumber(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取 GitHub 数据。'); }
  }, [data?.project?.repoUrl, kind, page, selectedNumber]);

  useEffect(() => { setSelectedNumber(null); setListOpen(true); setItems([]); void load(false); }, [data?.project?.repoUrl, kind, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshReproductions = useCallback(async (number: number) => {
    const value = await api<{ jobs: ReproductionJob[]; workerOnline: boolean; sandboxConfigured: boolean }>(`/api/workbench/reproduction?number=${number}`);
    setReproductions(value.jobs);
    setSelectedReproductionId(current => value.jobs.some(job => job.id === current) ? current : value.jobs[0]?.id || null);
    setReproductionWorkerOnline(value.workerOnline);
    setReproductionSandboxConfigured(value.sandboxConfigured);
  }, []);

  useEffect(() => {
    const active = reproductions.some(job => ['queued', 'running'].includes(job.status));
    if (!isIssues || !selectedNumber || !active) return;
    const timer = window.setInterval(() => { void refreshReproductions(selectedNumber).catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [isIssues, selectedNumber, reproductions, refreshReproductions]);

  const selected = items.find(item => item.number === selectedNumber) || null;
  const relatedItems = useMemo(() => {
    if (!selected || !isIssues) return [];
    const terms = new Set(`${selected.title} ${selected.body}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 4));
    return items.filter(item => item.number !== selected.number).map(item => {
      const itemTerms = `${item.title} ${item.body}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 4);
      const overlap = itemTerms.filter(term => terms.has(term)).length;
      const categoryBoost = selected.triage?.category && item.triage?.category === selected.triage.category ? 2 : 0;
      return { item, score: overlap + categoryBoost };
    }).filter(entry => entry.score > 1).sort((a, b) => b.score - a.score).slice(0, 3).map(entry => entry.item);
  }, [items, isIssues, selected]);
  const visible = useMemo(() => items.filter(item => {
    const q = query.trim().toLowerCase();
    const haystack = `${item.number} ${item.title} ${item.body} ${item.author} ${item.labels.join(' ')}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!isIssues || categoryFilter === 'all' || categoryFor(item) === categoryFilter) && (!isIssues || status === 'all' || triageStatus(item.triage) === status);
  }), [items, query, categoryFilter, status, isIssues]);
  const stats = useMemo(() => {
    const analyzed = items.filter(item => item.triage).length;
    const needsInfo = items.filter(item => item.triage?.needsMoreInfo || item.triage?.workflowStatus === 'needs-info').length;
    const high = items.filter(item => item.triage?.priority === 'high').length;
    const categories = (Object.keys(CATEGORY_META) as IssueCategory[]).map(value => ({ value, count: items.filter(item => item.triage?.category === value).length }));
    return { analyzed, needsInfo, high, categories, untriaged: items.length - analyzed };
  }, [items]);

  async function open(item: GitItem) {
    setSelectedNumber(item.number);
    if (isIssues) setListOpen(false);
    if (isIssues) { setReproductions([]); setSelectedReproductionId(null); void refreshReproductions(item.number).catch(() => setReproductionWorkerOnline(false)); }
    setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ item: GitItem }>(`/api/workbench/items?kind=${kind}&number=${item.number}`); setItems(current => current.map(row => row.number === item.number ? result.item : row)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取 Issue 详情。'); }
    finally { setBusy(false); }
  }
  async function analyze(force = false) {
    if (!selected || !isIssues) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ triage: IssueTriage }>('/api/workbench/triage', { action: 'analyze', number: selected.number, force }); setItems(current => current.map(item => item.number === selected.number ? { ...item, triage: result.triage } : item)); setNotice('分诊建议和中文翻译已更新。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Issue 分析未完成。'); }
    finally { setBusy(false); }
  }
  async function batchAnalyze() {
    if (!isIssues) return;
    const numbers = items.filter(item => !item.triage).slice(0, 12).map(item => item.number);
    if (!numbers.length) { setNotice('当前页的 Issue 都已经有分诊结果。'); return; }
    setBusy(true); setError(''); setNotice('正在按当前页顺序建立分诊建议…');
    try { const result = await api<{ triages: IssueTriage[]; errors: { number: number; message: string }[] }>('/api/workbench/triage', { action: 'batch', numbers }); const byNumber = new Map(result.triages.map(triage => [triage.number, triage])); setItems(current => current.map(item => ({ ...item, triage: byNumber.get(item.number) || item.triage }))); setNotice(result.errors.length ? `完成 ${result.triages.length} 条，${result.errors.length} 条失败。` : `已完成 ${result.triages.length} 条 Issue 分诊。`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '批量分诊未完成。'); }
    finally { setBusy(false); }
  }
  async function updateStatus(nextStatus: IssueWorkflowStatus) {
    if (!selected || !selected.triage) return;
    setBusy(true); setError('');
    try { const result = await api<{ triage: IssueTriage }>('/api/workbench/triage', { action: 'status', number: selected.number, status: nextStatus }); setItems(current => current.map(item => item.number === selected.number ? { ...item, triage: result.triage } : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '处理状态更新失败。'); }
    finally { setBusy(false); }
  }
  async function reviewTriage(change: { category: IssueCategory; priority: IssuePriority; status: IssueWorkflowStatus; note?: string }) {
    if (!selected || !selected.triage) return;
    setBusy(true); setError('');
    try { const result = await api<{ triage: IssueTriage }>('/api/workbench/triage', { action: 'review', number: selected.number, ...change }); setItems(current => current.map(item => item.number === selected.number ? { ...item, triage: result.triage } : item)); setNotice('已保存维护者最终判断。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '维护者判断保存失败。'); }
    finally { setBusy(false); }
  }

  async function reproductionAction(action: 'plan' | 'confirm' | 'cancel' | 'refresh', jobId?: string) {
    if (!selected || !isIssues) return;
    if (action === 'refresh') { try { await refreshReproductions(selected.number); } catch (cause) { setError(cause instanceof Error ? cause.message : '状态刷新失败。'); } return; }
    setBusy(true); setError('');
    try {
      if (action === 'plan') {
        const result = await api<{ job: ReproductionJob }>('/api/workbench/reproduction', { action: 'plan', number: selected.number });
        setReproductions(current => [result.job, ...current.filter(job => job.id !== result.job.id)]);
        setSelectedReproductionId(result.job.id);
        setNotice('复现方案已生成，请审阅机器判据、步骤和风险后确认。');
      } else {
        const job = reproductions.find(item => item.id === jobId) || reproductions.find(item => item.id === selectedReproductionId);
        if (!job) return;
        if (action === 'confirm') {
          const result = await api<{ job: ReproductionJob; workerOnline: boolean }>('/api/workbench/reproduction', { action: 'confirm', id: job.id, confirmed: true });
          setReproductions(current => current.map(item => item.id === result.job.id ? result.job : item));
          setSelectedReproductionId(result.job.id);
          setReproductionWorkerOnline(result.workerOnline);
          setNotice(result.workerOnline ? '复现任务已进入隔离执行队列。' : '任务已排队，但隔离执行器当前离线。');
        } else {
          const result = await api<{ job: ReproductionJob }>('/api/workbench/reproduction', { action: 'cancel', id: job.id });
          setReproductions(current => current.map(item => item.id === result.job.id ? result.job : item));
          setNotice('复现任务已取消。');
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '复现操作失败。'); } finally { setBusy(false); }
  }

  async function updateGitHubIssue(change: { state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] }) {
    if (!selected || !isIssues) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ item: GitItem }>('/api/workbench/items', { number: selected.number, ...change }, 'PATCH'); setItems(current => current.map(item => item.number === selected.number ? { ...item, ...result.item, comments: item.comments, triage: item.triage } : item)); setNotice('GitHub Issue 已更新。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Issue 更新失败。'); }
    finally { setBusy(false); }
  }

  async function generateDraft() {
    if (!selected) return;
    setBusy(true); setError('');
    try { await api('/api/workbench/drafts', { action: 'item', kind: isIssues ? 'issue' : 'review', number: selected.number }); setNotice('回复草稿已保存，可前往规范改进工作台编辑和发布。'); changed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '草稿生成失败。'); }
    finally { setBusy(false); }
  }

  if (!isIssues) return <div className="wb-page"><h1>PR 检查</h1><p>{data?.project?.fullName || '请先在项目概览中连接仓库。'} · GitHub 实时数据</p>{!data?.project && <Link href="/overview">连接项目</Link>}{error && <p className="wb-error" role="alert">{error}</p>}<label>筛选当前页<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或编号" /></label><section className="wb-card">{items.filter(item => `${item.number} ${item.title}`.toLowerCase().includes(query.toLowerCase())).map(item => <button className="wb-row" disabled={busy} key={item.number} onClick={() => void open(item)}>#{item.number} {item.title}<small>{item.author} · {item.labels.join(' / ') || item.state}</small></button>)}{!items.length && <p>当前页没有数据；如未连接，请先选择项目。</p>}</section><div className="wb-actions"><button className="button button-secondary" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页</span><button className="button button-secondary" disabled={!items.length || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div>{selected && <section className="wb-card"><h2>#{selected.number} {selected.title}</h2><a href={selected.url} target="_blank" rel="noopener noreferrer">查看 GitHub 原文</a><pre className="wb-detail">{selected.body || '没有描述'}</pre>{selected.files && selected.files.map(file => <details key={file.path}><summary>{file.path} · +{file.additions} −{file.deletions}</summary><pre className="wb-detail">{file.patch || 'GitHub 未提供文本 Diff'}</pre></details>)}<button className="button button-primary" disabled={busy} onClick={() => void generateDraft()}>{busy ? '正在处理…' : 'AI 分析并生成评论草稿'}</button>{notice && <p role="status">{notice} <Link href="/improvements">审阅草稿</Link></p>}</section>}</div>;

  return <div className="wb-page issue-workbench"><header className="issue-page-heading"><div><span className="issue-page-kicker">MAINTAINER INBOX / ISSUE TRIAGE</span><h1>Issue 分诊</h1><p>先看清问题分布，再进入单条 Issue 做证据核对、翻译和回复。</p></div><div className="issue-heading-actions"><button type="button" className="button button-secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />刷新</button><button type="button" className="button button-primary" onClick={() => void batchAnalyze()} disabled={busy || !items.length}>{busy ? '处理中…' : '批量建立分诊'}</button></div></header>
    {!data?.project && <div className="issue-connect-note"><CircleDot size={17} /><span>请先在项目概览中连接一个 GitHub 仓库。</span><Link href="/overview">连接项目 <ArrowUpRight size={14} /></Link></div>}
    {error && <p className="wb-error issue-alert" role="alert"><AlertCircle size={15} />{error}<button type="button" aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></button></p>}
    {notice && <p className="issue-notice" role="status"><Check size={15} />{notice}</p>}
    <section className="issue-command-strip"><div className="issue-metric-grid"><Metric value={items.length} label="当前页 Issue" detail="开放中的实时数据" /><Metric value={stats.analyzed} label="已完成分诊" detail={stats.untriaged ? `${stats.untriaged} 条等待处理` : '当前页已经覆盖'} tone="blue" /><Metric value={stats.needsInfo} label="需要补充信息" detail="优先准备回复" tone="amber" /><Metric value={stats.high} label="高优先级" detail="建议尽快查看" tone="red" /></div><div className="issue-category-distribution"><div className="issue-distribution-heading"><span>当前页分类分布</span><small>AI 建议 · 人工确认</small></div><div className="issue-distribution-bars">{stats.categories.filter(category => category.count > 0).map(category => <button type="button" key={category.value} className={`issue-distribution-item issue-tone-${CATEGORY_META[category.value].color}`} onClick={() => setCategory(category.value)} aria-pressed={categoryFilter === category.value}><span>{CATEGORY_META[category.value].short}</span><i><b style={{ width: `${items.length ? Math.max(8, category.count / items.length * 100) : 0}%` }} /></i><strong>{category.count}</strong></button>)}{!stats.categories.some(category => category.count > 0) && <span className="issue-distribution-empty">完成分诊后，这里会显示问题类型分布。</span>}</div></div></section>
    <section className="issue-toolbar"><div className="issue-search"><Search size={16} /><input aria-label="搜索 Issue" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文、作者或标签" /></div><div className="issue-filter-group"><label><span>类型</span><select value={categoryFilter} onChange={event => setCategory(event.target.value as CategoryFilter)}><option value="all">全部类型</option>{Object.entries(CATEGORY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span>处理状态</span><select value={status} onChange={event => setStatus(event.target.value as StatusFilter)}><option value="all">全部状态</option><option value="untriaged">尚未分诊</option>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div><span className="issue-result-count">显示 {visible.length} / {items.length}</span></section>
    <div className={`issue-content-grid ${selected && !listOpen ? 'is-focused' : ''}`}><section className="issue-list-panel" aria-label="Issue 列表" aria-hidden={Boolean(selected && !listOpen)} inert={selected && !listOpen ? true : undefined}><div className="issue-list-heading"><div><span className="issue-section-kicker">OPEN ISSUES</span><h2>待处理反馈</h2></div><span>第 {page} 页 · 最多每次处理 12 条</span></div><div className="issue-list">{visible.map(item => <IssueCard key={item.number} item={item} selected={selectedNumber === item.number} onClick={() => void open(item)} />)}{!visible.length && <div className="issue-empty-state"><CircleDot size={27} /><strong>没有符合条件的 Issue</strong><p>尝试清空搜索或切换筛选条件。</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); setStatus('all'); }}>重置筛选</button></div>}</div><div className="issue-pagination"><button type="button" className="button button-secondary" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />上一页</button><span>第 {page} 页</span><button type="button" className="button button-secondary" disabled={!items.length || busy} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={14} /></button></div></section>{selected ? <IssueDetail item={selected} relatedItems={relatedItems} busy={busy} reproductions={reproductions} reproductionSelectedId={selectedReproductionId} reproductionWorkerOnline={reproductionWorkerOnline} reproductionSandboxConfigured={reproductionSandboxConfigured} onReproduction={reproductionAction} onSelectReproduction={setSelectedReproductionId} canWrite={Boolean(data?.github?.canWrite)} onAnalyze={analyze} onDraft={generateDraft} onStatus={updateStatus} onUpdate={updateGitHubIssue} onShowList={() => setListOpen(true)} onOpenRelated={item => void open(item)} onReview={reviewTriage} /> : <section className="issue-detail-panel issue-detail-placeholder"><Sparkles size={27} /><h2>选择一条 Issue 开始分诊</h2><p>列表中的每条反馈都会保留原文；分析后再显示中文对照、分诊依据和下一步建议。</p></section>}</div>
  </div>;
}
