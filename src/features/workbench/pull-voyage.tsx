'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, FileCode2, GitBranch, GitPullRequest, Link2, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes } from './inbox-model';
import { pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import './pull-voyage.css';
import { PullConfluence } from './pull-confluence';

type Props = { items: GitItem[]; busy: boolean; onOpen: (item: GitItem) => void };
type Inspection = { key: string; status: 'loading' | 'ready' | 'error'; item?: GitItem; error?: string; at?: string };
type Snapshot = { item: GitItem; at: string };
function FileConstellation({ item }: { item: GitItem }) {
  const [path, setPath] = useState<string | null>(null);
  const files = useMemo(() => [...(item.files ?? [])].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)), [item.files]);
  const visible = files.slice(0, 20);
  const selected = visible.find(file => file.path === path) ?? visible[0];
  const maximum = Math.max(1, ...visible.flatMap(file => [file.additions, file.deletions]));
  const changes = pullChangeSignal(item);
  return <section className="voyage-files" aria-label={`PR #${item.number} 文件改动谱`}>
    <header><h4><FileCode2 size={16} aria-hidden="true" />文件改动谱</h4><span><b className="is-addition">+{changes.additions}</b><b className="is-deletion">−{changes.deletions}</b></span></header>
    <p>已读取 {changes.count}{changes.total !== undefined ? ` / ${changes.total}` : ''} 个文件，展示改动最多的前 {visible.length} 个。{changes.partial ? '文件清单有截断，增删统计仅涵盖已读取部分。' : '增删行数不表示风险或测试覆盖率。'}</p>
    <div className="voyage-file-spectrum">{visible.map((file, index) => <button key={file.path} type="button" className={selected?.path === file.path ? 'is-selected' : ''} aria-pressed={selected?.path === file.path} aria-label={`${file.path}，新增 ${file.additions} 行，删除 ${file.deletions} 行`} onClick={() => setPath(file.path)}>
      <span className="voyage-file-bars" aria-hidden="true"><i className="is-addition" style={{ height: `${file.additions / maximum * 38}px` }} /><i className="is-deletion" style={{ height: `${file.deletions / maximum * 38}px` }} /><em /></span><span>{index + 1}</span>
    </button>)}</div>
    {selected ? <div className="voyage-file-readout"><code>{selected.path}</code><span><b className="is-addition">+{selected.additions}</b><b className="is-deletion">−{selected.deletions}</b><span>{selected.status}</span></span>
      <details><summary>查看此文件的 Diff 片段</summary><p>{selected.patchTruncated ? 'Patch 有截断或不可用；以下片段不能代表完整文件。' : '最多展示 Patch 前 40 行。'}</p><pre>{selected.patch?.split('\n').slice(0, 40).join('\n') || '没有可显示的文本 Patch，可能是二进制或 GitHub 未返回。'}</pre></details>
    </div> : <p>当前快照没有变更文件。</p>}
    <footer><span><i className="is-addition" />新增行</span><span><i className="is-deletion" />删除行</span><span>所有柱形共用同一比例尺</span></footer>
  </section>;
}

function EvidencePanel({ item, busy, at, onRefresh, onOpen }: { item: GitItem; busy: boolean; at?: string; onRefresh: () => void; onOpen: (item: GitItem) => void }) {
  const checks = pullCheckSignal(item, true);
  return <div className="voyage-evidence">
    <div className="voyage-evidence-top"><span>本次证据读取 {at ? new Date(at).toLocaleTimeString('zh-CN') : ''}</span><button type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" />刷新此条证据</button></div>
    <div className="voyage-evidence-grid"><FileConstellation item={item} /><div className="voyage-verification">
      <section><h4><ShieldCheck size={16} aria-hidden="true" />可见检查<span className={`voyage-badge tone-${checks.tone}`}>{checks.label}</span></h4><p>检查结果仅描述已读取清单，最终可合并状态由 GitHub 决定。</p>
        <div className="voyage-check-list">{item.checks?.map((check, index) => <div key={`${check.name}-${index}`}><span className={`voyage-check-mark ${check.status === 'completed' ? ['success', 'neutral', 'skipped'].includes(check.conclusion ?? '') ? 'is-complete' : check.conclusion ? 'is-failed' : 'is-unknown' : check.status === 'unknown' ? 'is-unknown' : 'is-pending'}`}>{check.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion ?? '') ? <Check size={12} aria-hidden="true" /> : check.status === 'completed' && check.conclusion ? <X size={12} aria-hidden="true" /> : <span aria-hidden="true" />}</span><strong>{check.name}</strong><span>{check.status === 'queued' ? '排队' : check.status === 'in_progress' ? '执行中' : check.status === 'unknown' ? '未知' : check.conclusion === 'success' ? '通过' : check.conclusion === 'neutral' ? '中性' : check.conclusion === 'skipped' ? '跳过' : check.conclusion || '结论未知'}</span></div>)}</div>
        {!item.checks?.length && <p>没有可用的检查条目，不推断检查通过。</p>}
      </section>
      <section className="voyage-requirements"><h4><Link2 size={16} aria-hidden="true" />需求连接</h4>{item.linkedIssues?.length ? item.linkedIssues.map(issue => <div key={issue.number}><b>Issue #{issue.number}</b><span>{issue.title}</span></div>) : <p>当前证据没有已读取的关联 Issue。</p>}<small>关联声明不证明需求已修复。</small></section>
    </div></div>
    {Boolean(item.snapshotWarnings?.length) && <div className="voyage-warnings" role="status">{item.snapshotWarnings?.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    <div className="voyage-evidence-bottom"><span>锁定提交 <code>{item.headSha?.slice(0, 12)}</code><span>进入审查后可阅读原文、核对发现和人工确认。</span></span><button type="button" className="button button-primary" disabled={busy} onClick={() => onOpen(item)}>进入 PR 审查<ArrowUpRight size={14} aria-hidden="true" /></button></div>
  </div>;
}

export function PullVoyage({ items, busy, onOpen }: Props) {
  const [observing, setObserving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const rows = useMemo(() => items.map(original => {
    const key = pullIdentity(original);
    const item = snapshots[key]?.item ?? original;
    return { original, item, key, checks: pullCheckSignal(item, item !== original || item.files !== undefined), changes: pullChangeSignal(item), review: pullReviewSignal(item) };
  }), [items, snapshots]);

  async function inspect(item: GitItem, force = false) {
    const key = pullIdentity(item);
    controller.current?.abort();
    setSelected(key);
    setShowEvidence(true);
    if (!force && snapshots[key]) { setInspection({key,status:'ready',at:snapshots[key].at}); return; }
    const requestController = new AbortController();
    controller.current = requestController;
    setInspection({ key, status: 'loading' });
    try {
      const response = await fetch(`/api/workbench/review?number=${item.number}&context=1`, { signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(60_000)]), cache: 'no-store' });
      const data = await response.json() as { item?: GitItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error?.slice(0, 250) || 'PR 证据读取失败，请重试。');
      const fresh = data.item;
      if (fresh.number !== item.number || fresh.url !== item.url || (item.headSha && fresh.headSha !== item.headSha) || (item.baseSha && fresh.baseSha !== item.baseSha) || fresh.updatedAt !== item.updatedAt) throw new Error('PR 或当前项目已更新，请先刷新上方列表，再读取证据。');
      if (!requestController.signal.aborted) {
        const at = new Date().toISOString();
        setSnapshots(previous => Object.fromEntries([...Object.entries(previous).filter(([cachedKey]) => cachedKey !== key), [key, {item:fresh,at}]].slice(-8)));
        setInspection({ key, status: 'ready', at });
      }
    } catch (error) {
      if (!requestController.signal.aborted) setInspection({ key, status: 'error', error: error instanceof Error && error.name === 'TimeoutError' ? '读取超时，请重试。' : error instanceof Error ? error.message : 'PR 证据读取失败。' });
    }
  }

  const active = rows.find(row => row.key === selected) ?? rows[0];
  function selectNode(item: GitItem) {
    setObserving(true);
    const key = pullIdentity(item);
    if (key === active?.key) return;
    controller.current?.abort();
    setSelected(key);
    setShowEvidence(false);
    setInspection(snapshots[key] ? { key, status: 'ready', at: snapshots[key].at } : null);
  }
  const loading = inspection?.key === active?.key && inspection.status === 'loading';
  return <section className="pull-voyage" aria-label="PR 变更汇流图">
    {active && <>
      <div className={`confluence-layout${observing ? ' has-inspector' : ''}`}>
        <PullConfluence items={rows.map(row => row.item)} selected={pullIdentity(active.item)} busy={busy} onShowInspector={() => setObserving(true)} onSelect={item => { const row = rows.find(candidate => candidate.item.number === item.number); if (row) selectNode(row.original); }} />
        {observing && <aside className="confluence-inspector" aria-label="选中 PR 的观察面板" aria-live="polite">
          <div className="confluence-inspector-top"><b><GitPullRequest size={17} aria-hidden="true" /> #{active.item.number}</b><span>{active.item.isDraft ? '草稿' : 'Open PR'}</span><button type="button" aria-label="关闭 PR 观察面板" onClick={() => { setObserving(false); requestAnimationFrame(() => document.getElementById(`inbox-row-pulls-${active.item.number}`)?.focus({ preventScroll: true })); }}><X size={16} aria-hidden="true" /></button></div>
          <h4>{active.item.title}</h4><p>{active.item.author || '未知作者'} · {inboxDate(active.item.updatedAt)} 更新 · {pullTypes[pullClassification(active.item)]}</p>
          <div className="confluence-inspector-branch"><GitBranch size={14} aria-hidden="true" /><code>{active.item.headRef || '来源分支未知'}</code><ArrowUpRight size={13} aria-hidden="true" /><code>{active.item.baseRef || '目标分支未知'}</code></div>
          <dl className="confluence-signals"><div><dt>当前提交</dt><dd>{active.item.headSha?.slice(0, 7) || '未知'}</dd></div><div><dt>变更规模</dt><dd>{active.changes.read ? `${active.changes.count}${active.changes.partial ? '+ 已读' : ''} 个文件` : active.changes.total !== undefined ? `${active.changes.total} 个文件待核对` : '待读取'}</dd></div><div><dt>CI 检查</dt><dd className={`tone-${active.checks.tone}`}>{active.checks.label}</dd></div><div><dt>审查报告</dt><dd className={`tone-${active.review.tone}`}>{active.review.label}</dd></div></dl>
          <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void inspect(active.original)}>{loading ? <LoaderCircle size={14} aria-hidden="true" /> : <FileCode2 size={14} aria-hidden="true" />}{loading ? '正在读取证据' : '读取文件与检查'}</button>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => onOpen(active.item)}>进入 PR 审查<ArrowUpRight size={14} aria-hidden="true" /></button>
          <small>{snapshots[active.key]?.at ? `证据读取于 ${new Date(snapshots[active.key].at).toLocaleTimeString('zh-CN')}。` : '节点当前依据列表中已有数据。'}读取不调用 AI，进入审查后可核对原文与发现。</small>
        </aside>}
      </div>
      {showEvidence && inspection?.key === active.key && <section className="confluence-evidence" aria-label={`PR #${active.item.number} 代码与检查证据`}><header className="confluence-evidence-heading"><strong>#{active.item.number} 的代码与检查证据</strong><button type="button" onClick={() => { controller.current?.abort(); setShowEvidence(false); }} aria-label="收起选中 PR 的证据"><X size={15} aria-hidden="true" />收起</button></header>
        {loading && <div className="voyage-loading" role="status"><LoaderCircle size={19} aria-hidden="true" /><strong>正在读取当前提交的文件与检查</strong></div>}
        {inspection?.key === active.key && inspection.status === 'error' && <div className="voyage-read-error" role="alert"><p>{inspection.error}</p><button type="button" onClick={() => void inspect(active.original, true)} disabled={busy}><RefreshCw size={14} aria-hidden="true" />重试读取</button></div>}
        {inspection?.key === active.key && inspection.status === 'ready' && snapshots[active.key] && <EvidencePanel item={snapshots[active.key].item} busy={busy} at={snapshots[active.key].at} onRefresh={() => void inspect(active.original, true)} onOpen={onOpen} />}
      </section>}
    </>}
  </section>;
}
