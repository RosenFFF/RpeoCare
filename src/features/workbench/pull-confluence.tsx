'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CheckCircle2, CircleHelp, CircleX, FileText, GitBranch, GitPullRequest, LoaderCircle, PackageOpen, PanelRightOpen, Plus, Scan, ShieldCheck, Workflow } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes, type PullType } from './inbox-model';
import { pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import { pullMapLayout } from './pull-map-model';
import './pull-confluence.css';

type Props = { items: GitItem[]; selected: string; busy: boolean; baseBranch?: string; onSelect: (item: GitItem) => void; onShowInspector: () => void };
const typeIcons = { feature: Plus, fix: Bug, docs: FileText, dependency: PackageOpen, other: GitPullRequest };

export function PullConfluence({ items, selected, busy, onSelect, onShowInspector }: Props) {
  const [allEdges, setAllEdges] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<PullType | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 1200, height: 440 });
  const layout = useMemo(() => pullMapLayout(items, frame.width), [items, frame.width]);
  const signature = JSON.stringify(items.map(item => [item.number, item.baseRef]));
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () => {
      if (!element.getClientRects().length || !element.clientWidth) return;
      const next = { width: element.clientWidth, height: Math.max(240, Math.min(960, window.innerHeight - element.getBoundingClientRect().top - 76)) };
      setFrame(current => current.width === next.width && current.height === next.height ? current : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(element);
    const page = element.closest('.review-page'); if (page) observer.observe(page);
    window.addEventListener('resize', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { surface.current?.scrollTo({ left: 0, top: 0 }); setHovered(null); }, [signature]);
  const preview = items.find(item => pullIdentity(item) === hovered);
  const highlighted = items.some(item => pullIdentity(item) === hovered) ? hovered : selected;
  const focusedType = items.some(item => pullClassification(item) === highlightType) ? highlightType : null;
  const typeCounts = Object.keys(pullTypes).map(type => ({ type: type as PullType, count: items.filter(item => pullClassification(item) === type).length })).filter(group => group.count);
  function revealNode(node: HTMLButtonElement) {
    const element = surface.current; if (!element) return;
    const rect = element.getBoundingClientRect(), bounds = node.getBoundingClientRect();
    element.scrollBy({
      left: bounds.left < rect.left + 16 ? bounds.left - rect.left - 16 : bounds.right > rect.left + element.clientWidth - 16 ? bounds.right - rect.left - element.clientWidth + 16 : 0,
      top: bounds.top < rect.top + 16 ? bounds.top - rect.top - 16 : bounds.bottom > rect.top + element.clientHeight - 16 ? bounds.bottom - rect.top - element.clientHeight + 16 : 0,
    });
  }
  function locate(number: number) {
    const node = document.getElementById(`inbox-row-pulls-${number}`) as HTMLButtonElement | null;
    if (!node) return;
    revealNode(node); node.focus({ preventScroll: true });
  }
  return <div className={`confluence-map is-spacious-map${allEdges ? ' has-all-edges' : ''}`}>
    <div className="confluence-toolbar"><nav className="confluence-type-nav" aria-label="按变更类别突出显示连线">{typeCounts.map(({type,count}) => { const Icon = typeIcons[type]; return <button type="button" className={`type-${type}`} key={type} aria-pressed={focusedType === type} title="分类来自标题和标签，点击突出显示同类 PR" onClick={() => setHighlightType(current => current === type ? null : type)}><Icon size={14}/><span>{pullTypes[type]}</span><b>{count}</b></button>; })}</nav><div className="confluence-camera-controls" role="group" aria-label="PR 画布操作">
      <button type="button" title="回到总览起点" onClick={() => surface.current?.scrollTo({ left: 0, top: 0 })}><Scan size={15}/><span>总览</span></button>
      <button type="button" aria-label={allEdges ? '只显示聚焦连线' : '显示全部连线'} title={allEdges ? '只显示聚焦连线' : '显示全部连线'} aria-pressed={allEdges} onClick={() => setAllEdges(value => !value)}><Workflow size={15}/></button><button type="button" aria-label="查看选中 PR" title="查看选中 PR" onClick={onShowInspector}><PanelRightOpen size={16}/></button>
    </div></div>
    <div className="confluence-scroll-shell"><div className="confluence-viewport" ref={surface} style={{ maxHeight: frame.height }} tabIndex={0} role="region" aria-label="PR 总览，可通过滚轮、滚动条或方向键浏览，Tab 选择 PR">
      <div className="confluence-canvas is-summary-view" style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">{layout.groups.map(group => <g key={group.base}>
          <path className="confluence-trunk" d={`M${group.hub.x} ${group.top + 30} V${group.top + group.height - 30}`}/>
          {group.nodes.map(node => { const type = pullClassification(node.item), checks = pullCheckSignal(node.item, node.item.files !== undefined); const active = highlighted === pullIdentity(node.item) || focusedType === type;
            return <g className={`confluence-edge type-${type} tone-${checks.tone}${active ? ' is-active' : ''}${focusedType && focusedType !== type ? ' is-muted' : ''}`} key={node.item.number}><path d={`M${node.x + 43} ${node.y} C${node.x + 86} ${node.y} ${node.x + 92} ${node.channelY} ${node.x + 124} ${node.channelY} H${group.hub.x - 84} C${group.hub.x - 42} ${node.channelY} ${group.hub.x - 42} ${node.portY} ${group.hub.x} ${node.portY}`}/><circle cx={group.hub.x} cy={node.portY} r="3"/></g>;
          })}
        </g>)}</svg>
        {layout.groups.map(group => <section key={group.base} aria-label={`计划合入 ${group.base} 的 PR`}>
          <div className="confluence-target" style={{ left: group.hub.x, top: group.hub.y }}><span className="confluence-target-glyph"><GitBranch size={31}/></span><strong title={group.base}>{group.base}</strong><span>合入目标分支</span><div><b>{group.nodes.length}<small>当前页 PR</small></b><b>{group.nodes.filter(node => node.item.isDraft).length}<small>草稿</small></b></div></div>
          {group.nodes.map(node => {
            const item = node.item, type = pullClassification(item), Icon = typeIcons[type], checks = pullCheckSignal(item, item.files !== undefined), review = pullReviewSignal(item);
            const CheckIcon = checks.tone === 'passed' ? CheckCircle2 : checks.tone === 'failed' ? CircleX : checks.tone === 'pending' ? LoaderCircle : CircleHelp;
            return <button type="button" id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} key={item.number} disabled={busy} aria-pressed={selected === pullIdentity(item)} aria-label={`选择 PR #${item.number}，${item.title}，${checks.label}，${review.label}`} className={`confluence-node type-${type} tone-${checks.tone}${selected === pullIdentity(item) ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}${focusedType === type ? ' is-highlighted' : ''}`} style={{ left: node.x, top: node.y, width: layout.nodeWidth }} onMouseEnter={() => setHovered(pullIdentity(item))} onMouseLeave={() => setHovered(null)} onFocus={event => { revealNode(event.currentTarget); setHovered(pullIdentity(item)); }} onBlur={() => setHovered(null)} onClick={() => onSelect(item)}>
              <span className="confluence-glyph"><Icon size={24}/><b>#{item.number}</b>{item.isDraft && <em>草稿</em>}</span>
              <strong className="confluence-title" title={item.title}>{item.title}</strong>
              <span className="confluence-node-state"><span className={`tone-${checks.tone}`} title={checks.label}><CheckIcon size={13}/>{checks.label}</span><span className={`confluence-review-tag tone-${review.tone}`} title={review.label}><ShieldCheck size={12}/>{review.tone === 'unread' ? '待审查' : review.tone === 'stale' ? '需重审' : review.open ? `${review.open} 条待确认` : '已有报告'}</span></span>
            </button>;
          })}
        </section>)}
      </div>
    </div>{preview && <div className="confluence-hover-readout" aria-hidden="true"><b>#{preview.number} · {preview.isDraft ? '草稿' : pullTypes[pullClassification(preview)]}</b><strong>{preview.title}</strong><span>{pullCheckSignal(preview, preview.files !== undefined).label} · {pullReviewSignal(preview).label}</span><small>{preview.author || '未知作者'} · {inboxDate(preview.updatedAt)} · 点击查看完整信息</small></div>}</div>
    <footer className="confluence-map-caption"><span>总览 · 滚动浏览 · 点击查看完整信息</span><details className="confluence-locator"><summary>定位 PR（{items.length}）</summary><div>{items.map(item => <button type="button" key={item.number} onClick={() => locate(item.number)}>#{item.number}</button>)}</div></details><details><summary>图例与操作</summary><div><p>色标与图标表示标题 / 标签中的变更类型线索。外环：绿为可见检查完成、红为失败、黄为进行中、灰色虚线为未知。</p><p>默认展示当前页全部 PR 的摘要，标题、编号与状态使用固定字号。内容超出时通过滚动条、滚轮或方向键浏览，悬停查看摘要，点击查看完整信息。</p><p>默认仅显示聚焦 PR 或类别的连线，可主动打开全部连线。连线指向真实目标分支，不代表已经合并；未知检查与规模继续保持未知。</p></div></details></footer>
  </div>;
}
