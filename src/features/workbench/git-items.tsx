'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Bot, Check, ChevronLeft, ChevronRight, CircleDot,
  Download, ExternalLink, FlaskConical, Globe2, Languages, List, MessageSquare, Play, RefreshCw, ShieldCheck,
  Sparkles, Square, Tag, UserRound, X,
} from 'lucide-react';
import type {
  Draft, GitComment, GitItem, IssueCategory, IssuePriority, IssueReadinessLevel, IssueTriage, IssueWorkflowStatus, PullRequestReview, ReproductionJob,
} from '@/contracts/workbench';
import { api, changed, useWorkbench } from './client';
import { parseDiff } from '@/shared/lib/pr-diff';
import { ReviewInbox } from './review-inbox';
import './workbench.css';
import './review-inbox.css';
import './issue-detail.css';

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

function dateLabel(value: string) {
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }
  catch { return value; }
}
function commentTranslation(triage: IssueTriage | undefined, comment: GitComment) {
  return triage?.commentsZh.find(item => item.id === comment.id)?.bodyZh || '';
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`issue-badge issue-badge-${tone}`}>{children}</span>;
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
  return <section className="issue-readiness-card" aria-label="处理准备度与下一步">
    <div className="issue-readiness-heading"><h4>处理准备度</h4><ReadinessBadge level={level} /></div>
    <div className="issue-readiness-main"><div className="issue-readiness-score"><strong>{score}</strong><span>/ 100</span><i aria-hidden="true"><b style={{ width: `${score}%` }} /></i></div><p className="issue-readiness-copy">{level === 'ready' ? '信息已基本满足项目级调查或复现准备条件。' : level === 'partial' ? '可以继续人工调查，但建议先补齐关键环境或行为信息。' : '当前更适合先请求补充信息，不建议直接执行复现。'}</p></div>
    <div className="issue-next-actions"><span>建议下一步</span><div>{canReproduce ? <button type="button" className="button button-primary" onClick={onReproduction} disabled={busy}><FlaskConical size={15} />生成复现方案</button> : <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={15} />生成补充信息回复</button>}{canReproduce && <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={15} />生成回复草稿</button>}</div></div>
  </section>;
}

function TriageReview({ triage, busy, onReview }: { triage: IssueTriage; busy: boolean; onReview: (change: { category: IssueCategory; priority: IssuePriority; status: IssueWorkflowStatus; note?: string }) => void }) {
  const [category, setCategory] = useState<IssueCategory>(triage.review?.category || triage.category);
  const [priority, setPriority] = useState<IssuePriority>(triage.review?.priority || triage.priority);
  const [status, setStatus] = useState<IssueWorkflowStatus>(triage.review?.workflowStatus || triage.workflowStatus);
  const [note, setNote] = useState(triage.review?.note || '');
  useEffect(() => { setCategory(triage.review?.category || triage.category); setPriority(triage.review?.priority || triage.priority); setStatus(triage.review?.workflowStatus || triage.workflowStatus); setNote(triage.review?.note || ''); }, [triage.analyzedAt, triage.review?.confirmedAt]);
  const confirmed = Boolean(triage.review?.confirmedAt);
  return <section className="issue-review-card"><div className="issue-review-heading"><div><span className="issue-section-kicker">MAINTAINER REVIEW</span><h4>维护者确认</h4></div><Badge tone={confirmed ? 'green' : 'amber'}>{confirmed ? '已确认' : '待确认'}</Badge></div><p>AI 结果只是建议。确认后会记录维护者最终判断，不覆盖原始 AI 分析。</p><div className="issue-review-fields"><label><span>最终类型</span><select value={category} onChange={event => setCategory(event.target.value as IssueCategory)} disabled={busy}>{Object.entries(CATEGORY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span>最终优先级</span><select value={priority} onChange={event => setPriority(event.target.value as IssuePriority)} disabled={busy}>{Object.entries(PRIORITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span>最终状态</span><select value={status} onChange={event => setStatus(event.target.value as IssueWorkflowStatus)} disabled={busy}>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div><textarea aria-label="维护者判断依据" value={note} onChange={event => setNote(event.target.value)} placeholder="可选：记录人工判断依据" maxLength={1000} disabled={busy} /><button type="button" className="button button-secondary" onClick={() => onReview({ category, priority, status, note })} disabled={busy}>保存维护者判断</button></section>;
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

const REVIEW_SEVERITY: Record<PullRequestReview['findings'][number]['severity'], { label: string; tone: string }> = {
  blocking: { label: '阻塞问题', tone: 'red' },
  warning: { label: '需要关注', tone: 'amber' },
  suggestion: { label: '改进建议', tone: 'blue' },
  info: { label: '信息', tone: 'slate' },
};

function PullRequestReviewPanel({ review, busy, onAnalyze, onFinding }: { review: PullRequestReview | null; busy: boolean; onAnalyze: (force?: boolean) => void; onFinding: (findingId: string, status: 'open' | 'accepted' | 'dismissed') => void }) {
  if (!review) return <section className="pr-review-empty"><ShieldCheck size={24} /><h3>开始 AI 审查</h3><p>系统会固定当前 PR 的 head SHA，结合可见 Diff 和 GitHub Checks 生成带证据的审查发现。不会自动批准、拒绝或合并 PR。</p><button type="button" className="button button-primary" onClick={() => onAnalyze(false)} disabled={busy}>{busy ? '正在审查…' : '开始 AI 审查'}</button></section>;
  const openCount = review.findings.filter(finding => finding.status === 'open').length;
  const blockingCount = review.findings.filter(finding => finding.status === 'open' && finding.severity === 'blocking').length;
  return <section className="pr-review-panel">
    <div className="pr-review-summary"><div><span className="issue-section-kicker">EVIDENCE-FIRST REVIEW</span><h3><ShieldCheck size={17} />AI 审查结果</h3></div><div className="pr-review-summary-badges"><Badge tone={blockingCount ? 'red' : openCount ? 'amber' : 'green'}>{blockingCount ? `${blockingCount} 项阻塞` : openCount ? `${openCount} 项待确认` : '线索已处理，非合并批准'}</Badge><Badge tone="slate">提交 {review.headSha ? review.headSha.slice(0, 12) : '未知'}</Badge></div></div>
    <p className="pr-review-summary-copy">{review.summary}</p>
    <div className="pr-review-scope"><div><span>文件</span><strong>{review.scope.files}</strong></div><div><span>新增</span><strong>+{review.scope.additions}</strong></div><div><span>删除</span><strong>−{review.scope.deletions}</strong></div><div><span>可见检查</span><strong>{review.checksAvailable === false ? '不可用' : review.checks.length}</strong></div><div><span>截断文件</span><strong>{review.scope.truncatedFiles}</strong></div></div>
    <p className="pr-review-muted">本次读取中：测试路径 {review.scope.testFiles?.length ?? 0} 个，文档路径 {review.scope.docsFiles?.length ?? 0} 个。路径存在不代表覆盖充分；未读取区域仍未知。</p><div className="pr-review-checks"><div className="pr-review-subheading"><strong>CI / Checks</strong><span>{review.checks.length ? '分析时的 CI 快照 · 当前状态见上方' : '分析时未读取到结果'}</span></div>{review.checks.length ? review.checks.map(check => <div className="pr-review-check" key={`${check.name}-${check.status}-${check.conclusion}`} ><span className={`pr-review-check-dot is-${check.conclusion === 'success' ? 'success' : ['failure','error','timed_out','cancelled','action_required'].includes(check.conclusion || '') ? 'failure' : 'unknown'}`} /><strong>{check.name}</strong><span>{check.conclusion || check.status}</span></div>) : <p className="pr-review-muted">当前没有可见的 GitHub Checks；不能据此判断测试是否通过。</p>}</div>
    <div className="pr-review-findings"><div className="pr-review-subheading"><strong>结构化发现</strong><span>AI 建议 · 维护者确认</span></div>{review.findings.length ? review.findings.map(finding => { const severity = REVIEW_SEVERITY[finding.severity]; return <article className={`pr-review-finding is-${finding.status}`} key={finding.id}><div className="pr-review-finding-top"><Badge tone={severity.tone}>{severity.label}</Badge><Badge tone="slate">{finding.confidence === 'high' ? '高置信度' : finding.confidence === 'medium' ? '中置信度' : '低置信度'}</Badge>{finding.path && <code>{finding.path}{finding.line ? `:${finding.line}` : ''}</code>}</div><h4>{finding.title}</h4>{!finding.evidenceVerified && <small className="pr-review-muted">无可核实代码证据：仅待核实线索，不能直接确认发布。</small>}<p>{finding.explanation}</p>{finding.evidence && <blockquote>已核对 Diff 原文：{finding.evidence}</blockquote>}{finding.status === 'open' && <div className="pr-review-finding-actions"><button type="button" className="button button-secondary" onClick={() => onFinding(finding.id, 'accepted')} disabled={busy || !finding.evidenceVerified}>确认发现</button><button type="button" className="button button-secondary" onClick={() => onFinding(finding.id, 'dismissed')} disabled={busy}>忽略</button></div>}{finding.status !== 'open' && <div className="pr-review-finding-status">{finding.status === 'accepted' ? '已由维护者确认' : '已由维护者忽略'} <button className="button button-secondary" type="button" disabled={busy} onClick={() => onFinding(finding.id, 'open')}>撤回判断</button></div>}</article>; }) : <p className="pr-review-muted">AI 没有提出需要确认的代码问题，但这不等于测试已通过。</p>}</div>
    {review.limitations.length > 0 && <div className="pr-review-limitations"><strong>审查边界</strong><TextList items={review.limitations} /></div>}
    <div className="pr-review-actions"><button type="button" className="button button-secondary" onClick={() => onAnalyze(true)} disabled={busy}>重新审查当前提交</button><span>提示 {review.promptVersion} · {new Date(review.analyzedAt).toLocaleString('zh-CN')} · 模型 {review.model?.modelId || '旧记录未记录'}。审查不等于测试或合并批准。</span></div>
  </section>;
}

function PullRequestDetail({ item, review, busy, onAnalyze, onFinding, onDraft, onShowList }: { item: GitItem; review: PullRequestReview | null; busy: boolean; onAnalyze: (force?: boolean) => void; onFinding: (findingId: string, status: 'open' | 'accepted' | 'dismissed') => void; onDraft: () => void; onShowList: () => void }) {
  const [history, setHistory] = useState<{ at: string; review: PullRequestReview }[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { setHistory([]); setHistoryError(''); setAcknowledged(false); }, [item.number, item.headSha, review?.id, review?.revision]);
  const files = item.files || [];
  const stale = !!review && (review.headSha !== item.headSha || review.baseSha !== item.baseSha);
  const unresolved = !review || review.findings.some(f => f.status === 'open' || (f.status === 'accepted' && !f.evidenceVerified));
  async function loadHistory() {
    try { const value = await api<{ history: { at: string; review: PullRequestReview }[] }>(`/api/workbench/review?number=${item.number}&history=1`); setHistory(value.history); setHistoryError(''); }
    catch (error) { setHistoryError(error instanceof Error ? error.message : '历史暂不可用'); }
  }
  return <section className="issue-detail-panel" aria-label={`PR #${item.number} 详情`}>
    <header className="issue-detail-header"><div className="issue-detail-title"><div className="issue-detail-eyebrow"><span>PR #{item.number}</span>{item.isDraft && <Badge>Draft PR</Badge>}</div><h2>{item.title}</h2><div className="issue-detail-meta"><span><UserRound size={13} />{item.author || '未知作者'}</span><span>{item.headRef || 'head'} → {item.baseRef || 'base'}</span><code>{item.headSha?.slice(0,12) || '正在读取提交'}</code></div></div><div className="issue-detail-actions"><button type="button" className="button button-secondary" onClick={onShowList}><List size={14} />返回 PR 列表</button><a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer">GitHub</a><button type="button" className="button button-primary" disabled={busy || !acknowledged || unresolved || stale} onClick={onDraft}>生成已筛选审阅草稿</button></div></header>
    <div className="pr-review-context"><div><span>读取范围</span><strong>{files.length} / {item.totalChangedFiles ?? '?'} 个文件 · +{files.reduce((n,f)=>n+f.additions,0)} / −{files.reduce((n,f)=>n+f.deletions,0)}</strong></div><div><span>测试证据</span><strong>{files.some(f=> /test|spec/i.test(f.path)) ? '发现测试路径，不代表覆盖充分' : '读取清单中未发现测试路径'}</strong></div></div>
    {item.filesTruncated && <p className="pr-review-alert">超过文件读取上限，仅展示前 100 项；未读取文件不能判定没有问题。</p>}
    <details className="pr-description"><summary>PR 原文与关联需求</summary><pre>{item.body || '未提供描述'}</pre>{(item.linkedIssues || []).map(issue => <div key={issue.number}><a href={issue.url} target="_blank" rel="noopener noreferrer">关联 Issue #{issue.number} · {issue.title}</a><p>{issue.body}</p></div>)}</details>
    <details className="pr-ci-details" open><summary>当前 GitHub CI 状态（未运行本地测试）</summary>{(item.checks || []).map((check,i) => <div key={i} className="pr-review-check"><span className={`pr-review-check-dot is-${check.conclusion === 'success' ? 'success' : ['failure','error','timed_out','cancelled'].includes(check.conclusion || '') ? 'failure' : 'unknown'}`} /><strong>{check.name}</strong><span>{check.conclusion || check.status}</span></div>)}{!item.checks?.length && <p>暂无可见结果，不代表通过。</p>}{(item.snapshotWarnings || []).map(warning => <p key={warning} className="pr-review-muted">{warning}</p>)}</details>
    {stale && <p role="alert" className="pr-review-alert">PR head/base 已变化，以下是旧提交审查。请重新分析后确认或生成草稿。</p>}
    <PullRequestReviewPanel review={review} busy={busy || stale} onAnalyze={() => onAnalyze(true)} onFinding={onFinding} />
    {stale && <button className="button button-primary pr-stale-refresh" type="button" disabled={busy} onClick={() => onAnalyze(true)}>审查最新提交</button>}
    <div className="pr-draft-ack"><label><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={busy || stale || unresolved} />我已逐项筛选 AI 线索，理解生成草稿不会批准或合并 PR，且未在 RepoCare 执行测试。</label><Link href="/improvements">打开草稿工作台编辑与确认发布</Link></div>
    <details className="pr-diff-details" open><summary>查看原始 Diff <span>{files.length} 个文件</span></summary><div>{files.map(file => <details key={file.path}><summary><code>{file.path}</code><span>+{file.additions} / −{file.deletions}{file.patchTruncated ? ' · patch 不完整' : ''}</span></summary><div className="pr-code-scroll" tabIndex={0} role="region" aria-label={`${file.path} 差异内容`}><pre>{file.patch ? parseDiff(file.patch).map((row,i) => <div key={i} className={`pr-code-row is-${row.kind}`}><span>{row.oldLine || ''}</span><span>{row.newLine || ''}</span><code>{row.text}</code></div>) : 'GitHub 未提供文本 Diff，可能为二进制或大文件。'}</pre></div></details>)}</div></details>
    <details className="pr-history" onToggle={e=>{if(e.currentTarget.open) void loadHistory();}}><summary>审查与人工判断历史</summary>{historyError && <p role="alert">{historyError}</p>}{history.map((entry,i)=><div key={i}><time>{new Date(entry.at).toLocaleString('zh-CN')}</time><code>{entry.review.headSha.slice(0,12)}</code><span>{entry.review.findings.filter(f=>f.status==='accepted').length} 项确认 / {entry.review.findings.filter(f=>f.status==='dismissed').length} 项忽略 · r{entry.review.revision}</span></div>)}{!history.length && !historyError && <p>暂无记录或正在读取。</p>}</details>
  </section>;
}

function IssueDetail({ item, relatedItems, busy, canWrite, reproductions, reproductionSelectedId, reproductionWorkerOnline, reproductionSandboxConfigured, onReproduction, onSelectReproduction, onAnalyze, onDraft, onStatus, onUpdate, onShowList, onOpenRelated, onReview }: { item: GitItem; relatedItems: GitItem[]; busy: boolean; canWrite: boolean; reproductions: ReproductionJob[]; reproductionSelectedId: string | null; reproductionWorkerOnline: boolean; reproductionSandboxConfigured: boolean; onReproduction: (action: 'plan' | 'confirm' | 'cancel' | 'refresh', jobId?: string) => void; onSelectReproduction: (id: string) => void; onAnalyze: (force?: boolean) => void; onDraft: () => void; onStatus: (status: IssueWorkflowStatus) => void; onUpdate: (change: { state?: 'open' | 'closed'; labels?: string[]; assignees?: string[] }) => void; onShowList: () => void; onOpenRelated: (item: GitItem) => void; onReview: (change: { category: IssueCategory; priority: IssuePriority; status: IssueWorkflowStatus; note?: string }) => void }) {

  const triage = item.triage;
  const category = triage?.category ? CATEGORY_META[triage.category] : null;
  const priority = triage?.priority ? PRIORITY_META[triage.priority] : null;
  const confirmedCategory = triage?.review?.category ? CATEGORY_META[triage.review.category] : null;
  const confirmedPriority = triage?.review?.priority ? PRIORITY_META[triage.review.priority] : null;
  const fresh = Boolean(triage && triage.sourceUpdatedAt === item.updatedAt);
  return <section className="issue-detail-panel issue-detail-layout" aria-label={`Issue #${item.number} 详情`}>
    <header className="issue-detail-header">
      <div className="issue-detail-title"><div className="issue-detail-eyebrow"><span>ISSUE #{item.number}</span><span className={`issue-state-dot ${item.state === 'open' ? 'is-open' : ''}`} />{item.state === 'open' ? '开放中' : '已关闭'}</div><h2>{item.title}</h2>{triage?.titleZh && <p className="issue-title-translation"><Languages size={13} />{triage.titleZh}</p>}<div className="issue-detail-meta"><span><UserRound size={13} />{item.author || '未知作者'}</span><span>更新于 {dateLabel(item.updatedAt)}</span>{item.assignees?.length ? <span>指派给 {item.assignees.join(', ')}</span> : <span>尚未指派</span>}{item.milestone && <span>里程碑：{item.milestone}</span>}</div></div>
      <div className="issue-detail-actions"><button type="button" className="button button-secondary issue-show-list" onClick={onShowList} disabled={busy}><List size={14} />返回 Issue 列表</button><a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />GitHub</a>{triage?.category === 'bug' && triage.readinessLevel === 'ready' ? <button type="button" className="button button-secondary" onClick={() => onReproduction('plan')} disabled={busy}><Sparkles size={14} />生成复现方案</button> : triage ? <button type="button" className="button button-secondary" onClick={onDraft} disabled={busy}><MessageSquare size={14} />先补充信息</button> : null}<button type="button" className="button button-primary" onClick={onDraft} disabled={busy}><MessageSquare size={14} />生成回复草稿</button></div>
    </header>
    <div className="issue-detail-statusbar"><div className="issue-status-summary">{category ? <Badge tone={category.color}>AI：{category.label}</Badge> : <Badge>尚未分诊</Badge>}{priority && <Badge tone={priority.color}>AI：{priority.label}</Badge>}{confirmedCategory && <Badge tone={confirmedCategory.color}>最终：{confirmedCategory.label}</Badge>}{confirmedPriority && <Badge tone={confirmedPriority.color}>最终：{confirmedPriority.label}</Badge>}{triage?.needsMoreInfo && <Badge tone="amber">需要补充信息</Badge>}<span className="issue-source-note">{triage ? (fresh ? `AI 分析于 ${dateLabel(triage.analyzedAt)}` : '原文已更新，需要重新分析') : '尚未建立 AI 分诊建议'}</span></div><div className="issue-detail-status-actions">{triage && <label className="issue-status-select"><span>处理状态</span><select value={triage.workflowStatus} onChange={event => onStatus(event.target.value as IssueWorkflowStatus)} disabled={busy}>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>}<button type="button" className="button button-secondary" onClick={() => onAnalyze(Boolean(triage))} disabled={busy}><RefreshCw size={14} />{busy ? '处理中…' : triage ? '重新分析' : '开始 AI 分诊'}</button></div></div>
    {reproductions.length > 0 && <ReproductionPanel jobs={reproductions} selectedId={reproductionSelectedId} workerOnline={reproductionWorkerOnline} sandboxConfigured={reproductionSandboxConfigured} busy={busy} onAction={onReproduction} onSelect={onSelectReproduction} />}
    <section className="issue-triage-card" aria-labelledby={`issue-triage-title-${item.number}`}>
      <div className="issue-triage-heading"><h3 id={`issue-triage-title-${item.number}`}><Bot size={19} />分诊建议</h3><Badge tone="blue">{triage ? 'AI 建议 · 待人工核对' : '尚未分析'}</Badge></div>
      {!triage ? <div className="issue-aside-empty"><p>分析后会提取问题类型、优先级、缺失信息和下一步建议，不会自动回复或执行测试。</p><button type="button" className="button button-primary" onClick={() => onAnalyze(false)} disabled={busy}>分析并翻译</button></div> : <>
        <div className="issue-triage-overview">
          <div className="issue-triage-summary">
            <dl className="issue-triage-grid"><TriageValue label="问题类型"><Badge tone={category?.color}>{category?.label || '其他'}</Badge></TriageValue><TriageValue label="优先级"><Badge tone={priority?.color}>{priority?.label || '待判断'}</Badge></TriageValue><TriageValue label="置信度"><span className="issue-confidence">{triage.confidence === 'high' ? '高' : triage.confidence === 'medium' ? '中' : '低'}</span></TriageValue><TriageValue label="建议动作">{({ 'request-information': '请求补充信息', reply: '直接回复', investigate: '先调查', 'consider-feature': '评估功能', close: '考虑关闭', 'manual-review': '人工判断' } as Record<string, string>)[triage.suggestedAction]}</TriageValue></dl>
            <div className="issue-triage-callout"><ShieldCheck size={17} /><p>{triage.summaryZh}</p></div>
          </div>
          <TriageReadiness triage={triage} busy={busy} onDraft={onDraft} onReproduction={() => onReproduction('plan')} />
        </div>
        <div className="issue-triage-disclosures">
          <details key={`readiness-${item.number}`} className="issue-triage-details"><summary><span>判断依据与阻塞项</span><span className="issue-detail-count">{(triage.rationale?.length || 0) + (triage.readinessBlockers?.length || 0)} 项</span></summary><div className="issue-readiness-columns"><div><h4>判断依据</h4><TextList items={triage.rationale} empty="暂无依据" /></div><div><h4>阻塞项</h4><TextList items={triage.readinessBlockers} empty="没有标记的阻塞项" /></div></div></details>
          <details key={`facts-${item.number}`} className="issue-triage-details"><summary><span>实际 / 预期 / 环境</span><span className="issue-detail-count">原文提取</span></summary><dl className="issue-detail-facts"><TriageValue label="实际行为">{triage.actualBehavior || '未提取'}</TriageValue><TriageValue label="预期行为">{triage.expectedBehavior || '未说明'}</TriageValue><TriageValue label="运行环境">{triage.environment || '未提供'}</TriageValue></dl></details>
          <details key={`information-${item.number}`} className="issue-triage-details"><summary><span>信息完整度与建议标签</span><span className="issue-detail-count">缺失 {triage.missingInformation.length} 项</span></summary><div className="issue-readiness-columns"><div><h4>还缺什么</h4><TextList items={triage.missingInformation} /></div><div><h4>已经提供</h4><TextList items={triage.providedInformation} empty="模型没有识别到明确上下文" /></div></div><h4 className="issue-label-heading">建议标签</h4><div className="issue-label-cloud">{triage.suggestedLabels.length ? triage.suggestedLabels.map(label => <Badge key={label} tone="slate">{label}</Badge>) : <span className="issue-empty-value">暂无建议</span>}</div></details>
        </div>
      </>}
    </section>
    <div className="issue-detail-body"><div className="issue-detail-main"><IssueConversation item={item} triage={triage} /></div></div>
    <div className={`issue-detail-followup ${triage ? 'has-review' : ''}`}>
      {triage && <TriageReview triage={triage} busy={busy} onReview={onReview} />}
      <div className="issue-detail-maintenance"><IssueMaintenance item={item} canWrite={canWrite} busy={busy} onUpdate={onUpdate} /><SimilarIssues items={relatedItems} onOpen={onOpenRelated} /></div>
    </div>
  </section>;
}

export function GitItems({ kind }: { kind: 'issues' | 'pulls' }) {
  const { data, error: workbenchError } = useWorkbench();
  const [items, setItems] = useState<GitItem[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const listLoadVersion = useRef(0);
  const listScroll = useRef(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftLink, setDraftLink] = useState('');
  const [reproductions, setReproductions] = useState<ReproductionJob[]>([]);
  const [reproductionWorkerOnline, setReproductionWorkerOnline] = useState(false);
  const [reproductionSandboxConfigured, setReproductionSandboxConfigured] = useState(false);
  const [selectedReproductionId, setSelectedReproductionId] = useState<string | null>(null);
  const selectionVersion = useRef(0);
  const [pullReview, setPullReview] = useState<PullRequestReview | null>(null);
  const isIssues = kind === 'issues';

  const load = useCallback(async (keepSelection = true) => {
    const version = ++listLoadVersion.current;
    if (!data?.project) { setListLoading(false); return; }
    setError(''); setListLoading(true);
    try {
      const value = await api<{ items: GitItem[] }>(`/api/workbench/items?kind=${kind}&page=${page}`);
      if (version !== listLoadVersion.current) return;
      const sourceNumber = Number(new URL(window.location.href).searchParams.get('number'));
      setItems(current => [...value.items, ...current.filter(item => item.number === sourceNumber && !value.items.some((row: GitItem) => row.number === sourceNumber))]);
      if (!sourceNumber && (!keepSelection || (selectedNumber && !value.items.some(item => item.number === selectedNumber)))) { setSelectedNumber(null); setListOpen(true); }
    } catch (cause) { if (version === listLoadVersion.current) setError(cause instanceof Error ? cause.message : '无法读取 GitHub 数据。'); }
    finally { if (version === listLoadVersion.current) setListLoading(false); }
  }, [data?.project?.repoUrl, kind, page, selectedNumber]);

  useEffect(() => { selectionVersion.current++; setSelectedNumber(null); setPullReview(null); setListOpen(true); setBusy(false); setNotice(''); setDraftLink(''); setReproductions([]); setSelectedReproductionId(null); setItems([]); void load(false); return () => { listLoadVersion.current++; }; }, [data?.project?.repoUrl, kind, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedNumber || listOpen) return;
    const frame = requestAnimationFrame(() => { detailRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [selectedNumber, listOpen]);
  function returnToList() {
    setListOpen(true);
    requestAnimationFrame(() => { window.scrollTo({ top: listScroll.current }); const row = document.getElementById(`inbox-row-${kind}-${selectedNumber}`); (row || document.getElementById('review-title'))?.focus({ preventScroll: true }); });
  }

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

  const deepLinkLoaded = useRef('');
  useEffect(() => {
    const project = data?.project;
    const number = Number(new URL(window.location.href).searchParams.get('number'));
    if (!project || !Number.isSafeInteger(number) || number < 1 || deepLinkLoaded.current === `${project.repoUrl}:${kind}:${number}`) return;
    deepLinkLoaded.current = `${project.repoUrl}:${kind}:${number}`;
    const version = ++selectionVersion.current;
    setBusy(true); setError('');
    void api<{ item: GitItem; review?: PullRequestReview | null }>(isIssues ? `/api/workbench/items?kind=issues&number=${number}` : `/api/workbench/review?number=${number}&context=1`).then(result => {
      if (version !== selectionVersion.current) return;
      setItems(current => [...current.filter(item => item.number !== number), result.item]); setSelectedNumber(number); setListOpen(false); setPullReview(result.review || null);
      if (isIssues) void refreshReproductions(number).catch(() => setReproductionWorkerOnline(false));
    }).catch(cause => { if (version === selectionVersion.current) setError(cause instanceof Error ? cause.message : '来源讨论读取失败。'); })
      .finally(() => { if (version === selectionVersion.current) setBusy(false); });
  }, [data?.project?.repoUrl, kind, isIssues, refreshReproductions]);

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
  async function open(item: GitItem) {
    if (listOpen) listScroll.current = window.scrollY;
    const version = ++selectionVersion.current;
    setSelectedNumber(item.number); setListOpen(false); setBusy(true); setError(''); setNotice(''); setDraftLink(''); setPullReview(null);
    try {
      if (!isIssues) {
        const result = await api<{ item: GitItem; review: PullRequestReview | null }>(`/api/workbench/review?number=${item.number}&context=1`);
        if (version !== selectionVersion.current) return;
        setItems(current=>current.map(row=>row.number===item.number ? result.item : row)); setPullReview(result.review);
      } else {
        setReproductions([]); setSelectedReproductionId(null);
        void refreshReproductions(item.number).catch(()=>setReproductionWorkerOnline(false));
        const result = await api<{item: GitItem}>(`/api/workbench/items?kind=issues&number=${item.number}`);
        if (version !== selectionVersion.current) return;
        setItems(current=>current.map(row=>row.number===item.number ? result.item : row));
      }
    } catch(error) { if (version===selectionVersion.current) setError(error instanceof Error ? error.message : '详情读取失败'); }
    finally { if (version===selectionVersion.current) setBusy(false); }
  }
  async function analyze(force = false) {
    if (!selected || !isIssues) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ triage: IssueTriage }>('/api/workbench/triage', { action: 'analyze', number: selected.number, force }); setItems(current => current.map(item => item.number === selected.number ? { ...item, triage: result.triage } : item)); setNotice('分诊建议和中文翻译已更新。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Issue 分析未完成。'); }
    finally { setBusy(false); }
  }
  async function batchAnalyze(numbers: number[]) {
    if (!isIssues) return;
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

  async function analyzePull(force = false) {
    if (!selected || isIssues) return;
    setBusy(true); setError(''); setNotice('');
    try { const number = selected.number, version = selectionVersion.current; const result = await api<{ review: PullRequestReview }>('/api/workbench/review', { action: 'analyze', number, force }); if (version !== selectionVersion.current) return; const context = await api<{ item: GitItem }>(`/api/workbench/review?number=${number}&context=1`); if (version !== selectionVersion.current) return; setItems(rows=>rows.map(row=>row.number===number ? context.item : row)); setPullReview(result.review); setNotice('PR AI 审查已更新，发现需要维护者逐项确认。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'PR 审查未完成。'); }
    finally { setBusy(false); }
  }
  async function updatePullFinding(findingId: string, status: 'open' | 'accepted' | 'dismissed') {
    if (!selected || isIssues) return;
    const version = selectionVersion.current;
    setBusy(true); setError('');
    try { const result = await api<{ review: PullRequestReview }>('/api/workbench/review', { action: 'finding', number: selected.number, reviewId: pullReview?.id, revision: pullReview?.revision, findingId, status }); if (version !== selectionVersion.current) return; setPullReview(result.review); setNotice(status === 'accepted' ? '已确认审查发现。' : status === 'open' ? '已撤回判断，请重新筛选。' : '已忽略审查发现。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审查发现更新失败。'); }
    finally { setBusy(false); }
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
    try { const result = await api<{ draft: Draft }>('/api/workbench/drafts', { action: 'item', kind: isIssues ? 'issue' : 'review', number: selected.number }); changed(); setDraftLink(`/improvements?draft=${encodeURIComponent(result.draft.id)}`); setNotice('草稿已保存，可打开对应草稿审阅。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '草稿生成失败。'); }
    finally { setBusy(false); }
  }

  const focused = !!selected && !listOpen;
  const title = isIssues ? 'Issue 分诊' : 'PR 审查';
  const combinedError = error || workbenchError;
  return <div className={`wb-page review-page ${isIssues ? `issue-workbench${focused ? '' : ' issue-canvas-page'}` : `pr-workbench${focused ? '' : ' pr-canvas-page'}`}`}>
    <header className="review-page-header"><div className="review-page-title"><span className="review-project-label">{data?.project?.fullName || '开源维护工作台'}<span aria-hidden="true"> / </span>{isIssues ? '分诊工作地图' : '变更汇流图'}</span><h1 id="review-title" tabIndex={-1}>{title}</h1><p>{focused ? isIssues ? '核对原文与分诊依据，再选择下一步维护动作。' : '核对代码证据与检查状态，筛选后生成审阅草稿。' : isIssues ? '按下一步处理动作聚焦问题，查看依据后进入分诊。' : '在一张图中观察所有 PR 的目标分支与证据状态，点击节点进入审查。'}</p></div><button type="button" className="button button-secondary" onClick={() => { if (focused && selected) void open(selected); else void load(); }} disabled={busy || listLoading}><RefreshCw size={14} />{listLoading ? '读取中…' : '刷新'}</button></header>
    {combinedError && <p className="wb-error issue-alert" role="alert"><AlertCircle size={15} />{combinedError}<button type="button" aria-label="关闭错误" onClick={()=>setError('')}><X size={14}/></button></p>}
    {draftLink && <Link className="button button-secondary" href={draftLink}>审阅刚生成的草稿</Link>}{notice && <p className="issue-notice" role="status"><Check size={15}/>{notice}<Link href="/improvements">草稿工作台</Link></p>}
    <div className={`review-workspace ${focused ? 'is-focused' : ''}`}>
      <ReviewInbox key={`${kind}-${data?.project?.repoUrl || 'none'}`} kind={kind} items={items} page={page} connected={!!data?.project} busy={busy} loading={listLoading || (!data && !workbenchError)} hidden={focused} failed={!!combinedError} onOpen={item=>void open(item)} onPage={setPage} onBatch={numbers=>void batchAnalyze(numbers)}/>
      {focused && selected && <div className="review-detail-view" tabIndex={-1} ref={detailRef} aria-label={`${isIssues ? 'Issue' : 'PR'} #${selected.number} 工作区`}>
        <div className="review-back-bar"><button type="button" onClick={returnToList}><ChevronLeft size={15}/>返回{isIssues ? '反馈' : '变更'}收件箱</button><span>#{selected.number} · {busy ? '正在处理…' : '详情工作区'}</span></div>
        {isIssues ? <IssueDetail item={selected} relatedItems={relatedItems} busy={busy} reproductions={reproductions} reproductionSelectedId={selectedReproductionId} reproductionWorkerOnline={reproductionWorkerOnline} reproductionSandboxConfigured={reproductionSandboxConfigured} onReproduction={reproductionAction} onSelectReproduction={setSelectedReproductionId} canWrite={Boolean(data?.github?.canWrite)} onAnalyze={analyze} onDraft={generateDraft} onStatus={updateStatus} onUpdate={updateGitHubIssue} onShowList={returnToList} onOpenRelated={item=>void open(item)} onReview={reviewTriage}/> : <PullRequestDetail item={selected} review={pullReview?.number === selected.number ? pullReview : null} busy={busy} onAnalyze={analyzePull} onFinding={updatePullFinding} onDraft={generateDraft} onShowList={returnToList}/>}
      </div>}
    </div>
  </div>;
}
