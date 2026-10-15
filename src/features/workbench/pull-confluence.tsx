'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, Bug, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, CircleX, FileText, GitBranch, GitPullRequest, LoaderCircle, Minus, PackageOpen, PanelRightOpen, Plus, Scan, ShieldCheck, UserRound } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes, type PullType } from './inbox-model';
import { pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import { pullCardHeight, pullCardWidth, pullMapLayout } from './pull-map-model';
import { usePrCanvas } from './use-pr-canvas';
import './pull-confluence.css';

type Props = { items: GitItem[]; selected: string; busy: boolean; baseBranch?: string; onSelect: (item: GitItem) => void; onShowInspector: () => void };
const typeIcons = { feature: Plus, fix: Bug, docs: FileText, dependency: PackageOpen, other: GitPullRequest };

function PullChangeTicket({ item, selected, busy, onSelect, onFocus }: { item: GitItem; selected: boolean; busy: boolean; onSelect: () => void; onFocus: () => void }) {
  const type = pullClassification(item), Icon = typeIcons[type];
  const checks = pullCheckSignal(item, item.files !== undefined), review = pullReviewSignal(item), changes = pullChangeSignal(item);
  const sourceRef = item.headRepository ? `${item.headRepository.split('/')[0]}:${item.headRef || '?'}` : item.headRef || '来源分支未知';
  const CheckIcon = checks.tone === 'passed' ? CheckCircle2 : checks.tone === 'failed' ? CircleX : checks.tone === 'pending' ? LoaderCircle : CircleHelp;
  const fileCount = changes.total ?? (changes.read ? changes.count : undefined);
  const segments = fileCount === undefined ? 0 : Math.min(10, Math.ceil(Math.log2(1 + fileCount) * 1.6));
  return <button id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} type="button" disabled={busy} aria-pressed={selected} aria-label={`选择 PR #${item.number}，${item.title}，${pullTypes[type]}线索，${item.isDraft ? '草稿' : '开放'}，${checks.label}，${review.label}`} className={`pr-change-ticket type-${type}${selected ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}`} onFocus={onFocus} onClick={onSelect}>
    <span className="pr-ticket-heading"><span><i><Icon size={14} aria-hidden="true" /></i><b>#{item.number}</b></span><span className="pr-ticket-kind">{pullTypes[type]}</span>{item.isDraft && <em>草稿</em>}</span>
    <strong className="pr-ticket-title" title={item.title}>{item.title}</strong>
    <span className="pr-ticket-origin" title={`来源分支 ${sourceRef}，作者 ${item.author || '未知'}`}><GitBranch size={11} aria-hidden="true" /><code>{sourceRef}</code><UserRound size={11} aria-hidden="true" /><span>{item.author || '作者未知'}</span></span>
    <span className="pr-ticket-status"><span className={`pr-ticket-check tone-${checks.tone}`} title={checks.label}><CheckIcon size={12} aria-hidden="true" />{checks.tone === 'passed' ? '可见检查完成' : checks.label}</span><span className={`pr-ticket-review tone-${review.tone}`} title={review.label}><ShieldCheck size={11} aria-hidden="true" />{review.tone === 'unread' ? '待审查' : review.tone === 'stale' ? '需重审' : review.open ? `${review.open} 条待确认` : '已有报告'}</span></span>
    <span className="pr-ticket-footprint"><span className={`pr-ticket-meter${fileCount === undefined ? ' is-unknown' : ''}`} aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i className={index < segments ? 'is-filled' : ''} key={index} />)}</span><span>{fileCount === undefined ? '规模待读取' : `${fileCount}${changes.partial && changes.total === undefined ? '+' : ''} 个文件`}</span><time dateTime={item.updatedAt}>{inboxDate(item.updatedAt)}</time></span>
  </button>;
}

export function PullConfluence({ items, selected, busy, baseBranch, onSelect, onShowInspector }: Props) {
  const [expanded, setExpanded] = useState<Set<PullType>>(() => new Set());
  const layout = useMemo(() => pullMapLayout(items, expanded), [items, expanded]);
  const signature = JSON.stringify([baseBranch, items.map(item => [item.number, pullClassification(item)]), [...expanded]]);
  const canvas = usePrCanvas({ width: layout.width, height: layout.height }, signature, .72);
  const activeItem = items.find(item => pullIdentity(item) === selected);
  const highlighted = activeItem ? pullClassification(activeItem) : null;
  const allExpanded = layout.lanes.every(lane => lane.items.length <= 2 || expanded.has(lane.type));
  const branch = baseBranch || items[0]?.baseRef || '目标分支未知';
  function toggle(type: PullType) {
    const opening = !expanded.has(type);
    setExpanded(current => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next; });
    if (opening) requestAnimationFrame(() => { const next = layout.lanes.find(lane => lane.type === type)?.items[2]; if (next) document.getElementById(`inbox-row-pulls-${next.number}`)?.focus({ preventScroll: true }); });
  }

  return <div className="confluence-map">
    <div className="confluence-toolbar"><div className="confluence-counts"><strong><GitPullRequest size={14} aria-hidden="true" />{items.length} 条当前页 PR</strong><span>图中 {layout.visibleCount} 条</span></div><div className="confluence-camera-controls" role="group" aria-label="PR 画布操作">
      {layout.lanes.some(lane => lane.items.length > 2) && <button type="button" aria-label={allExpanded ? '折叠为每类两条预览' : '展开当前页全部 PR'} onClick={() => setExpanded(allExpanded ? new Set() : new Set(layout.lanes.map(lane => lane.type)))}>{allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>{allExpanded ? '折叠预览' : '展开当前页'}</span></button>}
      <button type="button" aria-label="缩小画布" onClick={() => canvas.zoom(1 / 1.2)}><Minus size={15} /></button><output aria-label="当前缩放比例">{Math.round(canvas.camera.scale * 100)}%</output><button type="button" aria-label="放大画布" onClick={() => canvas.zoom(1.2)}><Plus size={15} /></button>
      <button type="button" onClick={canvas.readable} aria-label="恢复可阅读比例" title="恢复可阅读比例"><FileText size={14} /><span>阅读比例</span></button><button type="button" onClick={canvas.fit} aria-label="适应全部节点" title="适应图中全部节点（0）"><Scan size={15} /><span>适应全部</span></button><button type="button" aria-label="查看选中 PR" onClick={onShowInspector}><PanelRightOpen size={15} /></button>
    </div></div>
    <nav className="confluence-type-nav" aria-label="变更类别图例，点击定位轨道">{layout.lanes.map(lane => { const Icon = typeIcons[lane.type]; return <button type="button" className={`type-${lane.type}`} key={lane.type} title="分类仅来自标题和标签线索" onClick={() => canvas.reveal({ x: lane.center, y: 278 }, { width: pullCardWidth, height: pullCardHeight })}><Icon size={13} /><span>{pullTypes[lane.type]}</span><b>{lane.items.length}</b></button>; })}<span>标题 / 标签线索</span></nav>
    <div className={`confluence-viewport${canvas.dragging ? ' is-dragging' : ''}`} ref={canvas.surface} style={{ height: canvas.frame.height, backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`, backgroundSize: `${24 * canvas.camera.scale}px ${24 * canvas.camera.scale}px` }} data-scale={canvas.camera.scale} data-pan-x={canvas.camera.x} data-pan-y={canvas.camera.y} tabIndex={0} role="region" aria-label="PR 分支变更画布，滚轮缩放，拖动平移，0 适应全部；类别图例可定位轨道" onPointerDown={canvas.pointerDown} onPointerMove={canvas.pointerMove} onPointerUp={canvas.pointerEnd} onPointerCancel={canvas.pointerEnd} onLostPointerCapture={canvas.pointerEnd} onKeyDown={canvas.keyDown} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) canvas.fit(); }}>
      <div className="confluence-canvas" style={{ width: layout.width, height: layout.height, transform: `translate(${canvas.camera.x}px, ${canvas.camera.y}px) scale(${canvas.camera.scale})` }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <path className="confluence-root-rail" pathLength="1" d={`M164 92 V116 H${layout.lanes.at(-1)?.center || 164}`} />
          {layout.lanes.map(lane => <g key={lane.type} className={`confluence-lane-edge type-${lane.type}${highlighted === lane.type ? ' is-active' : ''}`}><path d={`M${lane.center} 116 V${lane.moreTop - 10}`} /><circle cx={lane.center} cy="116" r="4" />{lane.nodes.map(node => <circle key={node.item.number} cx={lane.center} cy={node.top - 8} r="3" />)}</g>)}
        </svg>
        <div className="confluence-root" style={{ left: 30, top: 22 }}><span><GitBranch size={20} /><strong title={branch}>{branch}</strong></span><small>目标分支 <ArrowDown size={10} /> 计划合入的 PR</small></div>
        {layout.lanes.map(lane => { const Icon = typeIcons[lane.type]; return <section className={`confluence-lane type-${lane.type}`} key={lane.type} aria-label={`${pullTypes[lane.type]}，${lane.items.length} 条`}>
          <div className="confluence-lane-label" style={{ left: lane.left, top: 136, width: pullCardWidth }}><span><Icon size={14} />{pullTypes[lane.type]}</span><b>{lane.items.length}</b></div>
          {lane.nodes.map(node => <div className="confluence-ticket-position" key={node.item.number} style={{ left: node.left, top: node.top, width: pullCardWidth, height: pullCardHeight }}><PullChangeTicket item={node.item} selected={selected === pullIdentity(node.item)} busy={busy} onSelect={() => onSelect(node.item)} onFocus={() => canvas.reveal({ x: lane.center, y: node.top + pullCardHeight / 2 }, { width: pullCardWidth, height: pullCardHeight })} /></div>)}
          {lane.items.length > 2 && <button type="button" className="confluence-lane-more" style={{ left: lane.left, top: lane.moreTop, width: pullCardWidth }} onClick={() => toggle(lane.type)} onFocus={() => canvas.reveal({ x: lane.center, y: lane.moreTop + 18 }, { width: pullCardWidth, height: 36 })}>{lane.hidden ? <><ChevronDown size={14} />再展开 {lane.hidden} 条</> : <><ChevronUp size={14} />收起为两条预览</>}</button>}
        </section>; })}
      </div>
    </div>
    <footer className="confluence-map-caption"><span>{layout.visibleCount < items.length ? '每类先展示两条，可展开更多。' : ''}滚轮缩放 · 拖动平移 · 图例定位</span><details><summary>如何读图</summary><div><p>分支是 PR 的真实合入目标，轨道按变更类型整理，不表示提交历史或已合并关系。</p><p>颜色和图标表示标题 / 标签分类线索；草稿使用虚线边框。CI 与审查状态独立显示，未知保留未知。</p><p>底部刻度表示已知文件数的对数区间（最多 10 格），斜纹表示待读取；不代表风险评分。点击 PR 后可读取文件与检查。</p><p>首次保留可阅读比例。适应全部可以查看全图；+ / − 缩放，0 / Home 适应全部，方向键平移。</p></div></details></footer>
  </div>;
}
