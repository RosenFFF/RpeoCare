'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpRight, CircleDot, Layers, Link2, MessageSquare, Minus, PanelRightOpen, Plus, Scan, X } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, issueCategories, issueClassification, issuePriorities, issueStates } from './inbox-model';
import { usePrCanvas } from './use-pr-canvas';
import './issue-terrain.css';

type Props = { items: GitItem[]; busy: boolean; onOpen: (item: GitItem) => void };
function discussion(item: GitItem) {
  const value = item.commentCount ?? item.comments?.length;
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}
function recentlyUpdated(item: GitItem) {
  const elapsed = Date.now() - Date.parse(item.updatedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 72 * 60 * 60 * 1000;
}

export function IssueTerrain({ items, busy, onOpen }: Props) {
  const [grouping, setGrouping] = useState<'category' | 'status'>('category');
  const [selected, setSelected] = useState<number | null>(null);
  const [observing, setObserving] = useState(false);
  const layout = useMemo(() => {
    const buckets = new Map<string, GitItem[]>();
    for (const item of items) {
      const fields = issueClassification(item);
      const key = grouping === 'category' ? fields.category ?? 'unknown' : fields.status;
      const bucket = buckets.get(key) ?? [];
      bucket.push(item);
      buckets.set(key, bucket);
    }
    const maximum = Math.max(1, ...[...buckets.values()].map(bucket => bucket.length));
    const columns = Math.max(3, Math.min(9, Math.ceil(Math.sqrt(maximum * 2.4))));
    const rows = Math.ceil(maximum / columns);
    const across = Math.max(1, Math.ceil(Math.sqrt(buckets.size)));
    const cellWidth = columns * 190 + 135;
    const cellHeight = rows * 174 + 90;
    const groups = [...buckets].map(([key, members], groupIndex) => {
      const left = groupIndex % across * cellWidth;
      const top = Math.floor(groupIndex / across) * cellHeight;
      const nodes = members.map((item, index) => ({ item, x: left + 110 + index % columns * 190 + (Math.floor(index / columns) % 2 ? 95 : 0), y: top + 120 + Math.floor(index / columns) * 174 }));
      const label = grouping === 'category' ? key === 'unknown' ? '待分类' : issueCategories[key as keyof typeof issueCategories] : issueStates[key as keyof typeof issueStates];
      return { key, label, left, top, width: cellWidth - 20, height: cellHeight - 18, nodes };
    });
    return { groups, width: cellWidth * across, height: Math.max(340, cellHeight * Math.ceil(buckets.size / across)) };
  }, [items, grouping]);
  const signature = JSON.stringify([grouping, layout.groups.map(group => [group.key, group.nodes.map(node => node.item.number)])]);
  const canvas = usePrCanvas({ width: layout.width, height: layout.height }, signature);
  const active = items.find(item => item.number === selected) ?? items[0];
  const fields = active ? issueClassification(active) : null;
  const high = items.filter(item => issueClassification(item).priority === 'high').length;
  return <section className="issue-terrain" aria-label="Issue 问题地形图">
    <div className={`terrain-layout${observing ? ' has-inspector' : ''}`}>
      <div className="terrain-map">
        <header className="terrain-toolbar"><div className="terrain-counts"><strong><Layers size={15} aria-hidden="true" />问题地形</strong><span>{items.length} 条</span>{high > 0 && <span className="terrain-high">{high} 条高优先级</span>}</div><div className="terrain-controls" role="group" aria-label="Issue 画布操作">
          <select aria-label="地形分区方式" value={grouping} onChange={event => setGrouping(event.target.value as typeof grouping)}><option value="category">按问题类型</option><option value="status">按处理状态</option></select>
          <button type="button" aria-label="缩小 Issue 画布" onClick={() => canvas.zoom(1 / 1.2)}><Minus size={15} aria-hidden="true" /></button><output aria-label="Issue 缩放比例">{Math.round(canvas.camera.scale * 100)}%</output><button type="button" aria-label="放大 Issue 画布" onClick={() => canvas.zoom(1.2)}><Plus size={15} aria-hidden="true" /></button><button type="button" aria-label="适应全部 Issue" title="适应全部（0）" onClick={canvas.fit}><Scan size={15} aria-hidden="true" /><span>适应全部</span></button><button type="button" aria-label="查看选中 Issue" onClick={() => setObserving(true)}><PanelRightOpen size={15} aria-hidden="true" /></button>
        </div></header>
        <div className={`terrain-viewport${canvas.dragging ? ' is-dragging' : ''}`} ref={canvas.surface} role="region" aria-label="Issue 地形画布，滚轮缩放，拖拽平移，按 0 适应全部" tabIndex={0} data-scale={canvas.camera.scale} data-pan-x={canvas.camera.x} data-pan-y={canvas.camera.y} style={{ height: canvas.frame.height, backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`, backgroundSize: `${24 * canvas.camera.scale}px ${24 * canvas.camera.scale}px` }} onPointerDown={canvas.pointerDown} onPointerMove={canvas.pointerMove} onPointerUp={canvas.pointerEnd} onPointerCancel={canvas.pointerEnd} onLostPointerCapture={canvas.pointerEnd} onKeyDown={canvas.keyDown} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) canvas.fit(); }}>
          <div className="terrain-world" style={{ width: layout.width, height: layout.height, transform: `translate(${canvas.camera.x}px, ${canvas.camera.y}px) scale(${canvas.camera.scale})` }}>
            <svg width={layout.width} height={layout.height} aria-hidden="true">{layout.groups.map(group => <g key={group.key}><path className="terrain-island" d={`M${group.left + 44} ${group.top + 35} H${group.left + group.width - 55} L${group.left + group.width} ${group.top + 78} V${group.top + group.height - 52} L${group.left + group.width - 55} ${group.top + group.height} H${group.left + 55} L${group.left + 16} ${group.top + group.height - 40} V${group.top + 66} Z`} /><text className="terrain-island-label" x={group.left + 44} y={group.top + 22}>{group.label} · {group.nodes.length}</text></g>)}</svg>
            {layout.groups.flatMap(group => group.nodes.map(node => {
              const item = node.item;
              const state = issueClassification(item);
              const comments = discussion(item);
              const relief = comments === undefined ? 6 : Math.min(52, 6 + Math.log2(1 + comments) * 11);
              const top = `88,${-relief} 170,${24-relief} 170,${74-relief} 88,${98-relief} 6,${74-relief} 6,${24-relief}`;
              return <button key={item.number} id={`inbox-row-issues-${item.number}`} data-item-number={item.number} type="button" disabled={busy} aria-pressed={active?.number === item.number} aria-label={`选择 Issue #${item.number}，${item.title}，${issueStates[state.status]}，${issuePriorities[state.priority]}，${comments === undefined ? '评论未知' : `${comments} 条评论`}${state.stale ? '，原文有更新' : ''}`} className={`terrain-node priority-${state.priority}${active?.number === item.number ? ' is-selected' : ''}${state.stale ? ' is-stale' : ''}`} style={{ left: node.x, top: node.y, '--relief': `${relief}px` } as CSSProperties} onFocus={() => canvas.reveal(node)} onClick={() => { setSelected(item.number); setObserving(true); }}>
                <svg viewBox="0 -36 176 160" width="176" height="160" aria-hidden="true"><polygon className="terrain-ground" points="88,0 170,24 170,74 88,98 6,74 6,24" /><polygon className="terrain-side terrain-side-left" points={`6,${74-relief} 88,${98-relief} 88,98 6,74`} /><polygon className="terrain-side terrain-side-right" points={`88,${98-relief} 170,${74-relief} 170,74 88,98`} /><polygon className="terrain-face" points={top} /><path className="terrain-ridge" d={`M6 ${24-relief} L88 ${-relief} L170 ${24-relief}`} /></svg>
                <span className="terrain-number">#{item.number}{recentlyUpdated(item) && <i title="72 小时内更新" />}</span><strong className="terrain-title">{item.title}</strong><span className="terrain-foot"><span><MessageSquare size={10} aria-hidden="true" />{comments === undefined ? '?' : comments}</span><span>{state.stale ? '原文有更新' : issuePriorities[state.priority]}</span>{Boolean(item.relatedPulls?.length) && <span><Link2 size={10} aria-hidden="true" />{item.relatedPulls?.length}</span>}</span>
              </button>;
            }))}
          </div>
        </div>
        <footer className="terrain-caption"><span>高度看讨论量，颜色看优先级 · 滚轮缩放 / 拖动平移</span><details><summary>图例与操作</summary><div><p>每块六边形是一条 Issue。凸起高度是评论量的对数比例，最高 52px；始终显示准确评论数，? 表示未知。高度不表示紧急程度。</p><p>红色、黄色、青色分别表示已有高、中、低优先级；浅灰色表示待判断。虚线面表示原文更新，绿色点表示 72 小时内更新；链标记表示历史 PR 关联数量。</p><p>分区依据已有分诊字段，不推断语义相似性或问题依赖。未分诊记录均匀铺排在待分类区。</p><p>点击地形查看完整标题，再进入分诊；+ / − 缩放，0 / Home 适应全部，画布聚焦时方向键平移，双击空白恢复全图。</p></div></details></footer>
      </div>
      {observing && active && fields && <aside className="terrain-inspector" aria-label="选中 Issue 的观察面板" aria-live="polite"><header><b><CircleDot size={16} aria-hidden="true" />#{active.number}</b><button type="button" aria-label="关闭 Issue 观察面板" onClick={() => { setObserving(false); requestAnimationFrame(() => document.getElementById(`inbox-row-issues-${active.number}`)?.focus({ preventScroll: true })); }}><X size={16} aria-hidden="true" /></button></header><h3>{active.title}</h3><p>{active.author || '未知作者'} · {inboxDate(active.updatedAt)} 更新</p><dl><div><dt>处理状态</dt><dd>{issueStates[fields.status]}</dd></div><div><dt>优先级</dt><dd className={`priority-${fields.priority}`}>{issuePriorities[fields.priority]}</dd></div><div><dt>问题类型</dt><dd>{fields.category ? issueCategories[fields.category] : '待分类'}</dd></div><div><dt>讨论量</dt><dd>{discussion(active) === undefined ? '未知' : `${discussion(active)} 条评论`}</dd></div><div><dt>分诊依据</dt><dd>{active.triage?.review ? '含维护者确认' : fields.source}</dd></div></dl>{fields.stale && <p className="terrain-stale-notice">原文在分诊后更新，当前地形仍表示已有结果，请进入分诊核对。</p>}{Boolean(active.relatedPulls?.length) && <section className="terrain-related"><h4><Link2 size={14} aria-hidden="true" />历史 PR 证据</h4>{active.relatedPulls?.map(pull => <p key={`${pull.number}-${pull.headSha}`}>PR #{pull.number} · {pull.title}</p>)}<small>历史关联不表示问题已修复。</small></section>}<button type="button" className="button button-primary" disabled={busy} onClick={() => onOpen(active)}>进入 Issue 分诊<ArrowUpRight size={14} aria-hidden="true" /></button></aside>}
    </div>
  </section>;
}
