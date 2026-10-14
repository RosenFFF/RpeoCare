'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowUpRight, Check, ChevronDown, Code2, FileCode2, GitBranch, GitPullRequest, Link2, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes } from './inbox-model';
import { commitTexture, pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import './pull-voyage.css';

type Props = { items: GitItem[]; busy: boolean; onOpen: (item: GitItem) => void };
type Inspection = { key: string; status: 'loading' | 'ready' | 'error'; item?: GitItem; error?: string; at?: string };
type Snapshot = { item: GitItem; at: string };
const curves = ['M112.5 66 C187.5 66 210 22 262.5 22 S300 66 337.5 66', 'M337.5 66 C412.5 66 435 110 487.5 110 S525 66 562.5 66', 'M562.5 66 C637.5 66 660 22 712.5 22 S750 66 787.5 66'];

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
  const [expanded, setExpanded] = useState<string | null>(null);
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
    if (!force && expanded === key) { controller.current?.abort(); setExpanded(null); return; }
    controller.current?.abort();
    setExpanded(key);
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

  return <section className="pull-voyage" aria-label="PR 变更航道">
    <header className="voyage-heading"><div><h3><GitBranch size={21} aria-hidden="true" />变更航道</h3><p>沿一条变更，看清提交、代码、检查与审查之间的证据。</p></div><div className="voyage-summary"><span><b>{rows.length}</b>开放变更</span><span><b>{rows.filter(row => row.changes.read).length}</b>已读代码</span><span><b>{rows.filter(row => row.checks.tone === 'failed').length}</b>检查未通过</span><span><b>{rows.filter(row => row.review.tone === 'reviewed').length}</b>已有审查</span></div></header>
    <div className="voyage-reading-key"><span><i className="tone-read" />有已读证据</span><span><i className="tone-pending" />检查进行中</span><span><i className="tone-failed" />存在失败检查</span><span><i className="tone-unknown" />待读取或未知</span><small>列表依据已有证据；展开核对当前快照，不调用 AI。</small></div>
    <div className="voyage-routes">{rows.map(({ original, item, key, checks, changes, review }) => {
      const texture = commitTexture(item.headSha);
      const isExpanded = expanded === key;
      const loading = inspection?.key === key && inspection.status === 'loading';
      const fileLabel = changes.read ? `${changes.count}${changes.partial ? '+' : ''} 个已读文件` : item.totalChangedFiles !== undefined ? `${item.totalChangedFiles} 个文件待读取` : '变更待读取';
      const nodes = [
        { title: '提交', value: item.headSha?.slice(0, 7) || '提交未知', tone: item.headSha ? 'read' : 'unknown' },
        { title: '代码', value: fileLabel, tone: changes.read ? 'read' : 'unknown' },
        { title: '检查', value: checks.label, tone: checks.tone === 'passed' ? 'read' : checks.tone },
        { title: '审查', value: review.label, tone: review.tone === 'reviewed' ? 'read' : review.tone === 'stale' ? 'stale' : 'unknown' },
      ];
      return <article key={key} className={`voyage-route${isExpanded ? ' is-expanded' : ''}${item.isDraft ? ' is-draft' : ''}`} aria-labelledby={`voyage-title-${item.number}`}>
        <header className="voyage-route-heading"><div className="voyage-pr-id"><GitPullRequest size={17} aria-hidden="true" /><b>#{item.number}</b><span>{item.isDraft ? '草稿' : 'Open'}</span></div><div className="voyage-route-title"><h4 id={`voyage-title-${item.number}`}>{item.title}</h4><p>{item.author || '未知作者'}<span>{pullTypes[pullClassification(item)]}</span><span>{inboxDate(item.updatedAt)} 更新</span>{snapshots[key]?.at && <span>证据 {new Date(snapshots[key].at).toLocaleTimeString('zh-CN')} 读取</span>}</p></div><button id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} type="button" disabled={busy} className="voyage-open" onClick={() => onOpen(item)} aria-label={`审查 PR #${item.number}，${item.title}`}>审查<ArrowUpRight size={15} aria-hidden="true" /></button></header>
        <div className="voyage-branch"><span><GitBranch size={13} aria-hidden="true" /><code>{item.headRef || 'head'}</code><ArrowUpRight size={12} aria-hidden="true" /><code>{item.baseRef || 'base'}</code></span><span className="voyage-texture" title={`提交纹理来自 SHA：${item.headSha || '未知'}；不表示风险。`}><span>提交指纹</span><span aria-hidden="true">{texture.map((nibble, index) => <i key={index} style={{ height: `${5 + nibble * .7}px`, opacity: .3 + nibble / 22 }} />)}</span><code>{item.headSha?.slice(0, 7) || '未知'}</code></span></div>
        <button type="button" className="voyage-track" disabled={busy} aria-expanded={isExpanded} aria-controls={`voyage-evidence-${item.number}`} aria-label={`${isExpanded ? '收起' : '展开'} PR #${item.number} 的变更轨迹，${checks.label}，${review.label}`} onClick={() => void inspect(original)}>
          <svg viewBox="0 0 900 132" preserveAspectRatio="none" aria-hidden="true"><g className="voyage-guide">{curves.map((curve, index) => <path key={index} d={curve} />)}</g><g className="voyage-waterway">{curves.map((curve, index) => <path key={index} d={curve} className={index === 1 && checks.tone === 'pending' ? 'is-travelling' : index === 1 && checks.tone === 'failed' ? 'is-stopped' : nodes[index].tone === 'read' && nodes[index + 1].tone === 'read' ? 'is-read' : ''} />)}</g>{nodes.map((node, index) => <g className={`voyage-waypoint tone-${node.tone}`} key={node.title}><circle cx={112.5 + index * 225} cy="66" r="12" /><circle cx={112.5 + index * 225} cy="66" r="4" /></g>)}</svg>
          <span className="voyage-stations">{nodes.map(node => <span key={node.title} className={`tone-${node.tone}`}><b>{node.title}</b><strong>{node.value}</strong></span>)}</span>
          <span className="voyage-expand-label">{loading ? <LoaderCircle size={13} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}{loading ? '正在读取证据' : isExpanded ? '收起轨迹' : '展开轨迹'}</span>
        </button>
        {isExpanded && <div id={`voyage-evidence-${item.number}`} className="voyage-expanded-content">
          {loading && <div className="voyage-loading" role="status"><LoaderCircle size={19} aria-hidden="true" /><strong>正在读取当前提交的文件与检查</strong><span>按需读取这一条 PR 的证据。</span></div>}
          {inspection?.key === key && inspection.status === 'error' && <div className="voyage-read-error" role="alert"><p>{inspection.error}</p><button type="button" onClick={() => void inspect(original, true)} disabled={busy}><RefreshCw size={14} aria-hidden="true" />重试读取</button></div>}
          {inspection?.key === key && inspection.status === 'ready' && snapshots[key] && <EvidencePanel item={snapshots[key].item} busy={busy} at={snapshots[key].at} onRefresh={() => void inspect(original, true)} onOpen={onOpen} />}
        </div>}
      </article>;
    })}</div>
    <footer className="voyage-legend"><Code2 size={14} aria-hidden="true" /><span>提交纹理来自 SHA；节点显示证据状态。</span><ArrowDownUp size={14} aria-hidden="true" /><span>文件改动谱仅统计已读取增删行。</span><span>轨迹不表示自动处理进度或 GitHub 可合并状态。</span></footer>
  </section>;
}
