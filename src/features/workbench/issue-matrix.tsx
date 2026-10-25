'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { issueClassification, issuePriorities } from './inbox-model';
import { issueDiscussion } from './issue-map-model';
import { attentionProfiles, visualCategoryNames, type IssueMapSignals } from './issue-visual-signals';
import { ATTENTION_SPLIT, layoutIssueMatrix, matrixQuadrantOrder, matrixQuadrants, type MatrixQuadrant } from './issue-matrix-model';
import './issue-matrix.css';

type Props = { items: GitItem[]; busy: boolean; selected: string | null; onSelect: (item: GitItem) => void; signals: IssueMapSignals };

export function IssueMatrix({ items, busy, selected, onSelect, signals }: Props) {
  const plot = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<MatrixQuadrant | null>(null);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth) setSize({ width: element.clientWidth, height: Math.max(340, Math.min(560, Math.round(element.clientWidth * .52))) }); };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => layoutIssueMatrix(items, signals.byUrl, size.width || 760, size.height || 400), [items, signals.byUrl, size]);
  const preview = layout.points.find(point => point.item.url === hovered) ?? layout.points.find(point => point.item.url === selected);
  const quadrantBox = (key: MatrixQuadrant) => {
    const right = key === 'act' || key === 'clarify', top = key === 'act' || key === 'schedule';
    return { left: right ? layout.splitX : layout.pad.left, top: top ? layout.pad.top : layout.middle, width: right ? layout.pad.left + layout.plotWidth - layout.splitX : layout.splitX - layout.pad.left, height: layout.plotHeight / 2 };
  };

  return <div className={`issue-matrix${layout.tray.length ? '' : ' has-no-tray'}`} data-focus={focus ?? undefined}>
    <div className="issue-matrix-summary">
      <div className="issue-matrix-summary-steps" role="group" aria-label="按象限突出显示">{matrixQuadrantOrder.map(key => <button key={key} type="button" className={`quadrant-${key}`} aria-pressed={focus === key} title={matrixQuadrants[key].hint} onClick={() => setFocus(value => value === key ? null : key)}>
        <b>{layout.counts[key]}</b><span>{matrixQuadrants[key].label}</span>
      </button>)}</div>
      <span className="issue-matrix-tray-count"><Inbox size={14} aria-hidden="true" /><b>{layout.tray.length}</b> 条未分诊</span>
    </div>

    <div className="issue-matrix-body">
      {layout.tray.length > 0 && <aside className="issue-matrix-tray" aria-label={`未分诊托盘，${layout.tray.length} 条`}>
        <header><Inbox size={15} aria-hidden="true" /><strong>未分诊</strong><b>{layout.tray.length}</b></header>
        <p>还没有分诊结果，信息完整度未知，暂不放入矩阵。用工具栏的「分诊」批量分析后会自动落位。</p>
        <div className="issue-matrix-tray-list">{layout.tray.map(({ item, attention }) => {
          const category = signals.byUrl.get(item.url)?.classification.category ?? 'unknown';
          return <button key={item.number} type="button" id={`inbox-row-issues-${item.number}`} data-item-number={item.number} className={`category-${category}${selected === item.url ? ' is-selected' : ''}`} disabled={busy} aria-pressed={selected === item.url}
            aria-label={`查看 Issue #${item.number}，${item.title}，未分诊，已知关注分 ${attention}`} onClick={() => onSelect(item)}>
            <i aria-hidden="true" /><b>#{item.number}</b><span title={item.title}>{item.title || '无标题'}</span><em title="已知关注分">{attention}</em>
          </button>;
        })}</div>
      </aside>}

      <div className="issue-matrix-plot" ref={plot} style={{ height: layout.height }} role="region" aria-label={`Issue 关注矩阵：横向为已知关注分（${attentionProfiles[signals.profile].label}），纵向为信息完整度`}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">
          {matrixQuadrantOrder.map(key => { const box = quadrantBox(key); return <rect key={key} className={`issue-matrix-zone quadrant-${key}${focus && focus !== key ? ' is-dim' : ''}`} x={box.left} y={box.top} width={box.width} height={box.height} rx={10} />; })}
          <line className="issue-matrix-split" x1={layout.splitX} x2={layout.splitX} y1={layout.pad.top} y2={layout.pad.top + layout.plotHeight} />
          <line className="issue-matrix-split" x1={layout.pad.left} x2={layout.pad.left + layout.plotWidth} y1={layout.middle} y2={layout.middle} />
          {[0, 20, 40, 60, 80, 100].map(value => { const x = layout.pad.left + value / 100 * layout.plotWidth; return <text key={value} className="issue-matrix-tick" x={x} y={layout.height - 12} textAnchor={value === 0 ? 'start' : value === 100 ? 'end' : 'middle'}>{value}</text>; })}
          <text className="issue-matrix-axis" x={layout.pad.left + layout.plotWidth} y={layout.height - 26} textAnchor="end">关注分（已知）→</text>
          <text className="issue-matrix-axis" x={16} y={layout.pad.top + 8} transform={`rotate(-90 16 ${layout.pad.top + 8})`} textAnchor="end">信息完整</text>
          <text className="issue-matrix-axis" x={16} y={layout.pad.top + layout.plotHeight} transform={`rotate(-90 16 ${layout.pad.top + layout.plotHeight})`} textAnchor="start">缺信息</text>
          {matrixQuadrantOrder.map(key => { const box = quadrantBox(key); const right = key === 'act' || key === 'clarify'; return <text key={key} className={`issue-matrix-zone-label quadrant-${key}`} x={right ? box.left + box.width - 12 : box.left + 12} y={box.top + 20} textAnchor={right ? 'end' : 'start'}>{matrixQuadrants[key].label}<tspan dx="6">{layout.counts[key]}</tspan></text>; })}
          <text className="issue-matrix-split-label" x={layout.splitX + 4} y={layout.pad.top - 8}>关注分 {ATTENTION_SPLIT}</text>
        </svg>
        {layout.points.map(point => {
          const { item } = point;
          const signal = signals.byUrl.get(item.url);
          const category = signal?.classification.category ?? 'unknown';
          const fields = issueClassification(item);
          const isSelected = selected === item.url;
          return <button key={item.number} type="button" id={`inbox-row-issues-${item.number}`} data-item-number={item.number} disabled={busy} aria-pressed={isSelected}
            className={`issue-bubble category-${category} quadrant-${point.quadrant}${signal?.classification.provisional ? ' is-provisional' : ''}${point.stale ? ' is-stale' : ''}${isSelected ? ' is-selected' : ''}${focus && focus !== point.quadrant ? ' is-dim' : ''}`}
            style={{ left: point.x, top: point.y, width: point.r * 2, height: point.r * 2 }}
            aria-label={`查看 Issue #${item.number}，${item.title}，${matrixQuadrants[point.quadrant].label}，已知关注分 ${point.attention}，${point.missing ? `缺 ${point.missing} 项信息` : '信息完整'}，${issuePriorities[fields.priority]}，${visualCategoryNames[category]}${point.stale ? '，原文已更新' : ''}`}
            onPointerEnter={() => setHovered(item.url)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(item.url)} onBlur={() => setHovered(null)} onClick={() => onSelect(item)}>
            {point.label !== 'hidden' && <span className={`issue-bubble-label is-${point.label}`}>#{item.number}</span>}
          </button>;
        })}
        {!layout.points.length && <p className="issue-matrix-empty">{layout.tray.length ? '当前页还没有已分诊的 Issue。分诊后，它们会按关注分和信息完整度落到矩阵中。' : '当前没有可展示的问题，请调整筛选或刷新。'}</p>}
        {preview && <div className="issue-matrix-readout" aria-hidden="true">
          <b>#{preview.item.number} · {matrixQuadrants[preview.quadrant].label}</b>
          <strong>{preview.item.title || '无标题'}</strong>
          <span>关注分 {preview.attention} · {preview.missing ? `缺 ${preview.missing} 项信息` : '信息完整'} · {issuePriorities[issueClassification(preview.item).priority]} · {issueDiscussion(preview.item) ?? '未知'} 条评论{preview.stale ? ' · 原文已更新' : ''}</span>
        </div>}
      </div>
    </div>
    <footer className="issue-matrix-legend" aria-hidden="true">
      <span><i className="legend-bubble" />颜色 = 类别</span><span><i className="legend-bubble is-big" />大小 = 讨论量</span><span><i className="legend-bubble is-provisional" />虚线 = 类别仍待确认</span><span><i className="legend-bubble is-stale" />空心 = 原文在分诊后更新</span><span>关注分是查看顺序的辅助，不代表严重程度</span>
    </footer>
  </div>;
}
