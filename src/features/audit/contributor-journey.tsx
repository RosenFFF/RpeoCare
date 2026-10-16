'use client';
import { executionFailureLabels } from '@/shared/lib/maintenance-verification';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, Clock3, Download, FileCode2, GitBranch, LoaderCircle, LockKeyhole, Play, RefreshCw, Route, ShieldCheck, TerminalSquare, XCircle } from 'lucide-react';
import type { AuditReport } from '@/contracts/audit';
import type { ContributorJourneySource, ReproductionArtifact, ReproductionJob, ReproductionStatus } from '@/contracts/workbench';
import { changed } from '@/features/workbench/client';
import './contributor-journey.css';

interface JourneyResponse {
  job: ReproductionJob | null;
  workerOnline: boolean;
  sandboxConfigured: boolean;
  dependencyNetworkAllowed: boolean;
}

const activeStatuses: ReproductionStatus[] = ['queued', 'running'];
const terminalStatuses: ReproductionStatus[] = ['reproduced', 'not-reproduced', 'blocked', 'unsafe', 'failed', 'cancelled'];
const statusCopy: Record<ReproductionStatus, { label: string; tone: string; title: string }> = {
  draft: { label: '准备中', tone: 'neutral', title: '正在准备验证计划' },
  'awaiting-confirmation': { label: '待确认', tone: 'review', title: '演练计划等待维护者确认' },
  queued: { label: '排队中', tone: 'active', title: '演练已进入隔离执行队列' },
  running: { label: '执行中', tone: 'active', title: '正在模拟新贡献者完成项目验证' },
  reproduced: { label: '已走通', tone: 'success', title: '贡献路径已经完整走通' },
  'not-reproduced': { label: '有阻塞', tone: 'warning', title: '贡献路径存在需要维护的阻塞' },
  blocked: { label: '环境阻塞', tone: 'warning', title: 'Runner 环境暂时无法完成验证' },
  unsafe: { label: '计划已阻止', tone: 'danger', title: '计划未通过安全校验' },
  failed: { label: '执行失败', tone: 'danger', title: '隔离验证未能完成' },
  cancelled: { label: '已取消', tone: 'neutral', title: '本次演练已由维护者取消' },
};
const artifactLabels: Record<string, string> = { stdout: '标准输出', stderr: '错误输出', 'test-result': '执行结果', result: '结果快照', plan: '演练计划', 'source-log': '源码准备记录', console: '控制台', network: '网络记录' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `请求失败（${response.status}）`);
  return body as T;
}

function sourceUrl(report: AuditReport, source: ContributorJourneySource) {
  const suffix = source.line ? `#L${source.line}` : '';
  return `${report.repository.url}/blob/${report.repository.sha}/${source.path.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}

function stageState(job: ReproductionJob | null, stage: 'plan' | 'run' | 'evidence') {
  if (!job) return 'pending';
  if (stage === 'plan') return 'done';
  if (stage === 'run') return activeStatuses.includes(job.status) ? 'active' : terminalStatuses.includes(job.status) ? 'done' : 'pending';
  return terminalStatuses.includes(job.status) ? 'done' : 'pending';
}

function StageIcon({ state }: { state: string }) {
  if (state === 'done') return <Check size={14} />;
  if (state === 'active') return <LoaderCircle size={14} className="aw-spin" />;
  return <Circle size={11} />;
}

function artifactHref(job: ReproductionJob, artifact: ReproductionArtifact) {
  return `/api/workbench/reproduction/artifacts/${encodeURIComponent(artifact.id)}?job=${encodeURIComponent(job.id)}`;
}

export function ContributorJourney({ report, onNotify }: { report: AuditReport; onNotify: (message: string) => void }) {
  const [state, setState] = useState<JourneyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const endpoint = `/api/audit/runs/${encodeURIComponent(report.runId)}/journey`;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setState(await request<JourneyResponse>(endpoint)); setError(''); }
    catch (cause) { if (!quiet) setError(cause instanceof Error ? cause.message : '无法读取贡献路径。'); }
    finally { if (!quiet) setLoading(false); }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!state?.job || !activeStatuses.includes(state.job.status)) return;
    const timer = window.setInterval(() => void load(true), 1600);
    return () => window.clearInterval(timer);
  }, [state?.job?.id, state?.job?.status, load]);

  async function action(input: Record<string, unknown>, message: string) {
    if (submitting) return;
    setSubmitting(true); setError('');
    try {
      const next = await request<JourneyResponse>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      setState(next); setConfirmed(false); changed(); onNotify(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，请重试。'); }
    finally { setSubmitting(false); }
  }

  const job = state?.job || null;
  const sources = job?.journey?.sources || [];
  const needsNetwork = job?.plan.setup.some(step => /^(?:npm\s+(?:ci|install)|python3?\s+-m\s+pip\s+install)/i.test(step.command || '')) || false;
  const canConfirm = Boolean(confirmed && state?.sandboxConfigured && (!needsNetwork || state?.dependencyNetworkAllowed));
  const status = job ? statusCopy[job.status] : null;
  const stepResults = useMemo(() => new Map([...(job?.dependencySteps || []), ...(job?.verificationSteps || [])].filter(item => item.command).map(item => [item.command!, item])), [job?.dependencySteps,job?.verificationSteps]);

  if (loading) return <div className="cj-loading" role="status"><LoaderCircle size={18} className="aw-spin" />正在恢复贡献路径…</div>;

  return <section className="cj-shell" aria-labelledby="cj-title">
    <header className="cj-header">
      <div><span className="cj-eyebrow"><Route size={14} />贡献路径验证</span><h1 id="cj-title">验证新贡献者能否真正走通项目</h1><p>RepoCare 从固定提交中读取项目说明，生成可审阅计划，并在隔离环境中验证安装、测试与代码检查。</p></div>
      <div className="cj-revision"><GitBranch size={13} /><span>{report.repository.branch}</span><code>{report.repository.sha.slice(0, 7)}</code></div>
    </header>

    <ol className="cj-stages" aria-label="贡献路径验证阶段">
      {[['plan', '01', '计划审阅', '确认文档与清单中的命令'], ['run', '02', '隔离演练', '在受限 Runner 中执行'], ['evidence', '03', '证据与修复', '定位阻塞并进入草稿交付']].map(([id, number, title, description]) => {
        const value = stageState(job, id as 'plan' | 'run' | 'evidence');
        return <li key={id} className={`cj-stage cj-stage-${value}`}><span className="cj-stage-number">{value === 'pending' ? number : <StageIcon state={value} />}</span><div><strong>{title}</strong><p>{description}</p></div></li>;
      })}
    </ol>

    {!job ? <div className="cj-intro">
      <div className="cj-intro-main"><span className="cj-intro-icon"><Route size={28} strokeWidth={1.5} /></span><p className="cj-kicker">EXECUTABLE CONTRIBUTION PATH</p><h2>从“文档存在”走到“文档可执行”</h2><p>系统会优先读取 README、CONTRIBUTING 与项目脚本，形成一条最小贡献路径。计划不会直接运行；你可以先核对每条命令及来源。</p><button className="button button-primary" type="button" disabled={submitting} onClick={() => void action({ action: 'plan' }, '贡献路径计划已生成，请先核对命令。')}>{submitting ? <LoaderCircle size={15} className="aw-spin" /> : <Play size={15} />}生成演练计划</button></div>
      <aside className="cj-intro-aside"><span>验证范围</span><ul><li><TerminalSquare size={16} /><div><strong>真实命令</strong><p>从文档与项目清单提取安装、测试和检查步骤。</p></div></li><li><LockKeyhole size={16} /><div><strong>人工确认</strong><p>确认后才进入 Docker Runner，Web 进程不执行仓库代码。</p></div></li><li><ShieldCheck size={16} /><div><strong>固定证据</strong><p>结果绑定提交版本，日志与制品记录完整性哈希。</p></div></li></ul></aside>
    </div> : <>
      <div className={`cj-status cj-tone-${status?.tone}`}><span className="cj-status-icon">{job.status === 'running' || job.status === 'queued' ? <LoaderCircle size={19} className="aw-spin" /> : job.status === 'reproduced' ? <CheckCircle2 size={19} /> : ['not-reproduced', 'blocked'].includes(job.status) ? <AlertTriangle size={19} /> : ['failed', 'unsafe'].includes(job.status) ? <XCircle size={19} /> : <Clock3 size={19} />}</span><div><span>{status?.label}</span><h2>{status?.title}</h2><p>{job.progress || job.plan.summary}</p></div>{(job.status === 'awaiting-confirmation' || terminalStatuses.includes(job.status)) && <button className="button button-secondary" type="button" disabled={submitting} onClick={() => void action({ action: 'plan', force: true }, '已根据同一固定快照重新生成计划。')}><RefreshCw size={14} />重新生成</button>}</div>

      <div className="cj-grid">
        <main className="cj-plan">
          <div className="cj-section-heading"><div><span>PLAN REVIEW</span><h2>维护者确认的演练步骤</h2></div><small>{sources.length} 个步骤</small></div>
          <div className="cj-step-list">{sources.map((source, index) => {
            const result = stepResults.get(source.command);
            const position = index + 1;
            const isCurrent = activeStatuses.includes(job.status) && job.currentStep === position;
            const completed = Boolean(result && result.ok && (result.code === undefined || result.code === 0));
            const failed = Boolean(result && (!result.ok || (result.code !== undefined && result.code !== 0)));
            return <article className={`cj-step ${isCurrent ? 'cj-step-current' : ''} ${failed ? 'cj-step-failed' : completed ? 'cj-step-complete' : ''}`} key={`${source.phase}-${source.command}`}><span className="cj-step-marker">{isCurrent ? <LoaderCircle size={14} className="aw-spin" /> : failed ? <XCircle size={14} /> : completed ? <Check size={14} /> : String(position).padStart(2, '0')}</span><div className="cj-step-body"><div><span className={`cj-phase cj-phase-${source.phase}`}>{source.phase === 'setup' ? '准备' : '验证'}</span><strong>{source.label}</strong>{result?.code !== undefined && <span className={`cj-exit ${result.code === 0 ? 'is-ok' : 'is-failed'}`}>exit {result.code}</span>}</div><code>{source.command}</code><a href={sourceUrl(report, source)} target="_blank" rel="noopener noreferrer"><FileCode2 size={12} />{source.path}{source.line ? `:${source.line}` : ''}<span>{source.origin === 'documentation' ? '文档原文' : '项目清单'}</span></a></div></article>;
          })}</div>
          {job.plan.missingInformation.length > 0 && <div className="cj-note"><AlertTriangle size={15} /><div><strong>计划仍有未知信息</strong>{job.plan.missingInformation.map(item => <p key={item}>{item}</p>)}</div></div>}
        </main>

        <aside className="cj-control">
          <section><span className="cj-control-label">RUN CONTEXT</span><h3>本次执行边界</h3><dl><dt>仓库</dt><dd>{report.repository.fullName}</dd><dt>提交</dt><dd><code>{report.repository.sha.slice(0, 12)}</code></dd><dt>环境</dt><dd>{job.plan.environment.language || '自动识别'}</dd><dt>执行</dt><dd>{job.totalAttempts || 1} 次独立演练</dd></dl></section>
          <section className="cj-safety"><ShieldCheck size={18} /><div><strong>受限执行</strong><p>只读根文件系统、无额外 capabilities、资源限制；验证阶段关闭网络。</p></div></section>
          {!state?.sandboxConfigured && <p className="cj-blocker"><AlertTriangle size={14} />隔离 Runner 尚未启用，当前可以审阅计划，暂不能执行。</p>}
          {needsNetwork && !state?.dependencyNetworkAllowed && <p className="cj-blocker"><AlertTriangle size={14} />计划需要准备依赖。维护者确认来源后，需启用受限依赖网络。</p>}
          {job.status === 'awaiting-confirmation' && <div className="cj-confirm"><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span><strong>我已核对上述命令和来源</strong><small>确认后任务进入独立 Runner；不会在 Web 服务进程中执行。</small></span></label><button className="button button-primary" type="button" disabled={!canConfirm || submitting} onClick={() => void action({ action: 'confirm', id: job.id, confirmed: true }, '贡献路径已进入隔离执行队列。')}>{submitting ? <LoaderCircle size={15} className="aw-spin" /> : <Play size={15} />}确认并开始演练</button></div>}
          {activeStatuses.includes(job.status) && <div className="cj-live" role="status"><span><LoaderCircle size={15} className="aw-spin" />执行服务{state?.workerOnline ? '在线' : '正在等待'}</span><strong>{job.currentStepLabel || '正在准备固定提交'}</strong><div><span style={{ width: `${Math.min(100, Math.max(6, ((job.currentStep || 0) / Math.max(1, job.totalSteps || sources.length)) * 100))}%` }} /></div><small>{job.currentStep || 0} / {job.totalSteps || sources.length} 步</small>{job.status === 'queued' && <button type="button" disabled={submitting} onClick={() => void action({ action: 'cancel', id: job.id }, '贡献路径演练已取消。')}>取消排队</button>}</div>}
        </aside>
      </div>

      {terminalStatuses.includes(job.status) && <section className="cj-evidence">
        <div className="cj-section-heading"><div><span>EVIDENCE & DELIVERY</span><h2>{job.status === 'reproduced' ? '贡献路径证据已经保存' : '根据阻塞证据继续维护文档'}</h2></div><small>{job.artifacts.length} 份证据</small></div>
        {job.failureKind&&<p className="cj-blocker">{executionFailureLabels[job.failureKind]}：本次结果不代表项目存在已确认的代码缺陷。</p>}
        <div className="cj-outcome"><div><strong>{job.status === 'reproduced' ? '100%' : `${Math.round(((job.verificationSteps || []).filter(item => item.phase === 'verify' && item.ok && item.code === 0).length / Math.max(1, sources.filter(item => item.phase === 'verify').length)) * 100)}%`}</strong><span>验证步骤通过率</span></div><p>{job.status === 'reproduced' ? '当前固定提交下，维护者确认的最小贡献路径已经完整通过。' : job.error || '至少一个安装、测试或代码检查步骤没有完成。请核对退出码和执行证据，再更新项目文档。'}</p><Link className="button button-primary" href={`/improvements?generate=${encodeURIComponent(report.runId)}`}>进入草稿与交付<ArrowRight size={15} /></Link></div>
        {job.attemptHistory.length > 0 && <div className="cj-attempts">{job.attemptHistory.map(attempt => <div key={attempt.index}><span>演练 {String(attempt.index).padStart(2, '0')}</span><strong>{attempt.result === 'reproduced' ? '完整通过' : attempt.result === 'not-reproduced' ? '存在阻塞' : '执行失败'}</strong><small>{(attempt.durationMs / 1000).toFixed(1)} 秒</small></div>)}</div>}
        {job.artifacts.length > 0 && <div className="cj-artifacts">{job.artifacts.map(artifact => <a key={artifact.id} href={artifactHref(job, artifact)}><Download size={13} /><span>{artifactLabels[artifact.kind] || artifact.kind}<small>{Math.max(1, Math.round(artifact.size / 1024))} KB · SHA-256 已校验</small></span></a>)}</div>}
      </section>}
    </>}
    {error && <p className="cj-error" role="alert">{error}</p>}
  </section>;
}
