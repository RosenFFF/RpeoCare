'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { GitBranch, GitPullRequest, Maximize2, Minimize2, Minus, Plus, Scan, PanelRightOpen } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { pullClassification, pullTypes } from './inbox-model';
import { pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import './pull-confluence.css';
import { usePrCanvas } from './use-pr-canvas';

type Props = { items: GitItem[]; selected: string; busy: boolean; onSelect: (item: GitItem) => void; onShowInspector: () => void };

export function PullConfluence({ items, selected, busy, onSelect, onShowInspector }: Props) {
  const [compact, setCompact] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => {
    const pitch = compact ? 132 : 158;
    const branches = new Map<string, GitItem[]>();
    for (const item of items) {
      const base = item.baseRef || '目标分支未知';
      const group = branches.get(base) ?? [];
      group.push(item);
      branches.set(base, group);
    }
    const maximum = Math.max(1, ...[...branches.values()].map(group => group.length));
    const columns = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(maximum * 2.4))));
    const groupWidth = columns * 190 + 150;
    const groupHeight = Math.ceil(maximum / columns) * pitch + 110;
    const across = Math.ceil(Math.sqrt(branches.size));
    const groups = [...branches].map(([base, pulls], groupIndex) => {
      const left = groupIndex % across * groupWidth;
      const top = Math.floor(groupIndex / across) * groupHeight;
      const hub = { x: left + groupWidth - 65, y: top + groupHeight / 2 };
      const nodes = pulls.map((item, index) => ({ item, key: pullIdentity(item), x: left + 90 + index % columns * 190, y: top + 68 + Math.floor(index / columns) * pitch + (index % columns % 2 ? 42 : 0) }));
      return { base, nodes, hub, left, top, height: groupHeight };
    });
    return { groups, width: groupWidth * Math.max(1, across), height: Math.max(340, groupHeight * Math.ceil(branches.size / Math.max(1, across))), labelWidth: 166 };
  }, [items, compact]);
  const signature = JSON.stringify([compact, items.map(item => [item.number, item.baseRef])]);
  const canvas = usePrCanvas({ width: layout.width, height: layout.height }, signature);
  const highlighted = hovered ?? selected;
  return <div className="confluence-map">
    <div className="confluence-toolbar"><div className="confluence-counts"><strong><GitPullRequest size={14} aria-hidden="true" />{items.length} 条 PR</strong><span>{layout.groups.length} 个目标分支</span></div><div className="confluence-camera-controls" role="group" aria-label="画布操作">
      <button type="button" aria-pressed={compact} aria-label={compact ? '舒展节点' : '紧凑布局'} title="调整节点间距" onClick={() => setCompact(value => !value)}>{compact ? <Maximize2 size={14} aria-hidden="true" /> : <Minimize2 size={14} aria-hidden="true" />}<span>{compact ? '舒展' : '紧凑'}</span></button>
      <button type="button" aria-label="缩小画布" title="缩小（−）" onClick={() => canvas.zoom(1 / 1.2)}><Minus size={15} aria-hidden="true" /></button><output aria-label="当前缩放比例">{Math.round(canvas.camera.scale * 100)}%</output><button type="button" aria-label="放大画布" title="放大（+）" onClick={() => canvas.zoom(1.2)}><Plus size={15} aria-hidden="true" /></button>
      <button type="button" onClick={canvas.fit} aria-label="适应全部" title="适应全部（0）"><Scan size={15} aria-hidden="true" /><span>适应全部</span></button><button type="button" aria-label="查看选中 PR" title="查看选中 PR" onClick={onShowInspector}><PanelRightOpen size={15} aria-hidden="true" /></button>
    </div></div>
    <div className={`confluence-viewport${canvas.dragging ? ' is-dragging' : ''}`} ref={canvas.surface} style={{ height: canvas.frame.height, backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`, backgroundSize: `${20 * canvas.camera.scale}px ${20 * canvas.camera.scale}px` }} data-scale={canvas.camera.scale} data-pan-x={canvas.camera.x} data-pan-y={canvas.camera.y} tabIndex={0} role="region" aria-label="PR 汇流画布，滚轮缩放，拖拽平移，按 0 适应全部" onPointerDown={canvas.pointerDown} onPointerMove={canvas.pointerMove} onPointerUp={canvas.pointerEnd} onPointerCancel={canvas.pointerEnd} onLostPointerCapture={canvas.pointerEnd} onKeyDown={canvas.keyDown} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) canvas.fit(); }}>
      <div className={`confluence-canvas${compact ? ' is-compact' : ''}`} style={{ width: layout.width, height: layout.height, transform: `translate(${canvas.camera.x}px, ${canvas.camera.y}px) scale(${canvas.camera.scale})` }}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          {layout.groups.map(group => <g key={group.base}>
            <line className="confluence-boundary" x1={group.left + 15} x2={group.hub.x + 50} y1={group.top} y2={group.top} />
            <path className="confluence-trunk" d={`M${group.hub.x} ${group.top + 35} V${group.top + group.height - 25}`} />
            {group.nodes.map(node => {
              const checks = pullCheckSignal(node.item, node.item.files !== undefined);
              const active = highlighted === node.key;
              const start = node.x + 29;
              return <g key={node.key} className={`confluence-edge tone-${checks.tone}${active ? ' is-active' : ''}`}>
                <path d={`M${start} ${node.y} C${start + 58} ${node.y} ${group.hub.x - 92} ${group.hub.y} ${group.hub.x} ${group.hub.y}`} />
                <circle cx={group.hub.x} cy={node.y} r="2" />
              </g>;
            })}
          </g>)}
        </svg>
        {layout.groups.map(group => <div key={group.base}>
          <div className="confluence-target" style={{ left: group.hub.x, top: group.hub.y }}><GitBranch size={18} aria-hidden="true" /><strong title={group.base}>{group.base}</strong><span>{group.nodes.length} 条指向此分支</span></div>
          {group.nodes.map(node => {
            const item = node.item;
            const checks = pullCheckSignal(item, item.files !== undefined);
            const changes = pullChangeSignal(item);
            const review = pullReviewSignal(item);
            const type = pullClassification(item);
            const size = changes.read || changes.total !== undefined ? Math.min(68, 48 + Math.log2(1 + (changes.total ?? changes.count)) * 4) : 48;
            return <button key={node.key} id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} type="button" disabled={busy} aria-pressed={selected === node.key} aria-label={`选择 PR #${item.number}，${item.title}，${checks.label}，${review.label}`} className={`confluence-node tone-${checks.tone} type-${type}${selected === node.key ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}`} style={{ left: node.x, top: node.y, width: layout.labelWidth, '--node-size': `${size}px` } as CSSProperties} onMouseEnter={() => setHovered(node.key)} onMouseLeave={() => setHovered(null)} onFocus={() => { setHovered(node.key); canvas.reveal(node); }} onBlur={() => setHovered(null)} onClick={() => onSelect(item)}>
              <span className="confluence-glyph"><GitPullRequest size={16} aria-hidden="true" /><b>#{item.number}</b><i className="confluence-review-dot" title={review.label} data-reviewed={review.tone} /></span>
              <span className="confluence-title">{item.title}</span>
              <span className="confluence-node-meta">{item.isDraft ? '草稿' : pullTypes[type]}<span>{changes.read ? `${changes.count}${changes.partial ? '+' : ''} 文件` : changes.total !== undefined ? `${changes.total} 文件待核对` : '规模未知'}</span></span>
              <span className="confluence-node-state">{checks.label}</span>
            </button>;
          })}
        </div>)}
      </div>
    </div>
    <footer className="confluence-map-caption"><span>滚轮缩放 · 拖动平移 · 双击空白适应全部</span><details><summary>图例与快捷键</summary><div><p>绿色环：可见检查完成；黄色环：检查进行中；红色环：有失败；虚线灰环：未知。</p><p>节点大小表示已知文件数，未知使用固定大小。小圆点：灰色未审查、青色已有报告、黄色已过期；方形节点为草稿。</p><p>连线仅表示目标分支关系，不表示已合并。放大后可读节点标题，点击查看完整信息。</p><p>键盘：+ / − 缩放，0 / Home 适应全部；画布聚焦时方向键平移。也可使用上方按钮。</p></div></details></footer>
  </div>;
}
