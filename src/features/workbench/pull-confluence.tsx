'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GitBranch, GitPullRequest, Maximize2, Minimize2 } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { pullClassification, pullTypes } from './inbox-model';
import { pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import './pull-confluence.css';

type Props = { items: GitItem[]; selected: string; busy: boolean; onSelect: (item: GitItem) => void };

export function PullConfluence({ items, selected, busy, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(740);
  const [compact, setCompact] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.floor(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => {
    const columns = width >= 600 ? 3 : width >= 420 ? 2 : 1;
    const step = (width - 150) / columns;
    const pitch = compact ? 132 : 178;
    const branches = new Map<string, GitItem[]>();
    for (const item of items) {
      const base = item.baseRef || '目标分支未知';
      const group = branches.get(base) ?? [];
      group.push(item);
      branches.set(base, group);
    }
    let offset = 20;
    const groups = [...branches].map(([base, pulls]) => {
      const height = Math.ceil(pulls.length / columns) * pitch + 90;
      const hub = { x: width - 62, y: offset + height / 2 };
      const nodes = pulls.map((item, index) => ({ item, key: pullIdentity(item), x: 10 + (index % columns + .5) * step, y: offset + 70 + Math.floor(index / columns) * pitch + (index % columns % 2 ? 48 : 0) }));
      const group = { base, nodes, hub, top: offset, height };
      offset += height + 20;
      return group;
    });
    return { groups, height: Math.max(340, offset), labelWidth: Math.min(174, Math.max(96, step - 20)) };
  }, [items, width, compact]);
  const highlighted = hovered ?? selected;
  return <div className="confluence-map">
    <div className="confluence-toolbar"><span><GitPullRequest size={14} aria-hidden="true" />每个节点是一条 PR，连线通向实际目标分支</span><button type="button" aria-pressed={compact} onClick={() => setCompact(value => !value)}>{compact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}{compact ? '舒展节点' : '紧凑布局'}</button></div>
    <div className="confluence-scroll" ref={host} tabIndex={0} aria-label="PR 汇流画布，可滚动查看全部节点">
      <div className={`confluence-canvas${compact ? ' is-compact' : ''}`} style={{ height: layout.height }}>
        <svg width="100%" height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} aria-hidden="true">
          {layout.groups.map(group => <g key={group.base}>
            <line className="confluence-boundary" x1="15" x2={width - 15} y1={group.top} y2={group.top} />
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
            return <button key={node.key} id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} type="button" disabled={busy} aria-pressed={selected === node.key} aria-label={`选择 PR #${item.number}，${item.title}，${checks.label}，${review.label}`} className={`confluence-node tone-${checks.tone} type-${type}${selected === node.key ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}`} style={{ left: node.x, top: node.y, width: layout.labelWidth, '--node-size': `${size}px` } as CSSProperties} onMouseEnter={() => setHovered(node.key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.key)} onBlur={() => setHovered(null)} onClick={() => onSelect(item)}>
              <span className="confluence-glyph"><GitPullRequest size={16} aria-hidden="true" /><b>#{item.number}</b><i className="confluence-review-dot" title={review.label} data-reviewed={review.tone} /></span>
              <span className="confluence-title">{item.title}</span>
              <span className="confluence-node-meta">{item.isDraft ? '草稿' : pullTypes[type]}<span>{changes.read ? `${changes.count}${changes.partial ? '+' : ''} 文件` : changes.total !== undefined ? `${changes.total} 文件待核对` : '规模未知'}</span></span>
              <span className="confluence-node-state">{checks.label}</span>
            </button>;
          })}
        </div>)}
      </div>
    </div>
    <div className="confluence-map-caption"><span>环形颜色：CI 状态</span><span>节点大小：已知文件数，未知使用固定大小</span><span>小圆点：灰色未审查 / 青色已有报告 / 黄色已过期</span><span>方形节点：草稿 PR</span><span>连线表示目标分支关系，不表示已合并</span></div>
  </div>;
}
