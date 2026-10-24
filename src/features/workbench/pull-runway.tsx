'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, Clock3, FileText, GitPullRequest, PackageOpen, Plus } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { pullClassification } from './inbox-model';
import { pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import { idleLabel, layoutRunway, STALE_DAYS, type RunwayStage } from './pull-runway-model';
import './pull-runway.css';

export const typeIcons = { feature: Plus, fix: Bug, docs: FileText, dependency: PackageOpen, other: GitPullRequest };
const LABEL_COLUMN = 132;
const ROW = 66;
const ROW_LIMIT = 6;
const COMPACT_LIMIT = 8;

type Props = { items: GitItem[]; selected: string; busy: boolean; onSelect: (item: GitItem) => void };

export function PullRunway({ items, selected, busy, onSelect }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [focusStage, setFocusStage] = useState<RunwayStage | null>(null);
  const [expanded, setExpanded] = useState<RunwayStage[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []);

  const compact = width > 0 && width < 680;
  const track = Math.max(240, (width || 1000) - LABEL_COLUMN - 20);
  const columns = Math.max(1, Math.floor((track + 8) / (184 + 8)));
  const cardWidth = Math.min(280, Math.floor((track + 8) / columns) - 8);
  const layout = useMemo(() => layoutRunway(items, track, cardWidth, now), [items, track, cardWidth, now]);
  const counts = layout.lanes.map(lane => lane.cards.length);
  const total = items.length || 1;

  function card(entry: (typeof layout.lanes)[number]['cards'][number]) {
    const { item } = entry;
    const type = pullClassification(item), Icon = typeIcons[type];
    const checks = pullCheckSignal(item, item.files !== undefined), review = pullReviewSignal(item);
    const isSelected = selected === pullIdentity(item);
    return <button type="button" key={item.number} id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} disabled={busy} aria-pressed={isSelected}
      aria-label={`选择 PR #${item.number}，${item.title}，${idleLabel(entry.days)}，${checks.label}，${review.label}`} title={`#${item.number} ${item.title}\n${item.author || '未知作者'} · ${idleLabel(entry.days)}`}
      className={`runway-card type-${type} tone-${checks.tone}${isSelected ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}`}
      style={compact ? undefined : { left: entry.x, top: entry.row * ROW + 8, width: cardWidth }} onClick={() => onSelect(item)}>
      <span className="runway-card-top">
        <i className="runway-ci" aria-hidden="true" title={checks.label} />
        <Icon size={13} aria-hidden="true" className="runway-type-icon" />
        <b>#{item.number}</b>
        {item.isDraft && <em>草稿</em>}
        {item.reviewSnapshot && <span className={`runway-review tone-${review.tone}`}>{review.label}</span>}
      </span>
      <strong className="runway-card-title">{item.title}</strong>
      {compact && <small className="runway-card-age">{item.author || '未知作者'} · {idleLabel(entry.days)}</small>}
    </button>;
  }

  return <div className={`runway${compact ? ' is-compact' : ''}`} data-focus={focusStage ?? undefined}>
    <div className="runway-summary">
      <div className="runway-funnel" role="group" aria-label="按审查阶段突出显示">
        {layout.lanes.map((lane, index) => <button type="button" key={lane.stage} className={`runway-funnel-step stage-${lane.stage}`} aria-pressed={focusStage === lane.stage} title={lane.hint}
          onClick={() => setFocusStage(value => value === lane.stage ? null : lane.stage)}>
          <b>{counts[index]}</b><span>{lane.label}</span><i className="runway-share" style={{ width: `${Math.round(counts[index] / total * 100)}%` }} aria-hidden="true" />
        </button>)}
      </div>
      {layout.stale > 0 && <p className="runway-alert"><Clock3 size={14} aria-hidden="true" /><b>{layout.stale}</b> 个 PR 已超过 {STALE_DAYS} 天未更新</p>}
    </div>

    <div className="runway-board" ref={board} role="region" aria-label="PR 审查航道：按审查阶段分道，横向位置表示多久没有更新">
      {!compact && <div className="runway-axis" aria-hidden="true" style={{ paddingLeft: LABEL_COLUMN }}>
        <div className="runway-axis-track" style={{ width: layout.width }}>
          {layout.ticks.filter(tick => tick.days !== STALE_DAYS || layout.staleX === null).map(tick => <span key={tick.days} style={{ left: tick.left }}>{tick.label}</span>)}
          {layout.staleX !== null && <span className="runway-axis-stale" style={{ left: layout.staleX }}>超过 2 周</span>}
        </div>
      </div>}
      {layout.lanes.map(lane => {
        const open = expanded.includes(lane.stage);
        const shown = open ? lane.cards : compact ? [...lane.cards].sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity)).slice(0, COMPACT_LIMIT) : lane.cards.filter(entry => entry.row < ROW_LIMIT);
        const hidden = lane.cards.length - shown.length;
        const rows = open ? lane.rows : Math.min(lane.rows, ROW_LIMIT);
        return <section key={lane.stage} className={`runway-lane stage-${lane.stage}${focusStage && focusStage !== lane.stage ? ' is-dim' : ''}${lane.cards.length ? '' : ' is-empty'}`} aria-label={`${lane.label}，${lane.cards.length} 个 PR`}>
        <header className="runway-lane-head" style={compact ? undefined : { width: LABEL_COLUMN }} title={lane.hint}><i aria-hidden="true" /><span>{lane.label}</span><b>{lane.cards.length}</b><small>{lane.hint}</small>
          {(hidden > 0 || open) && <button type="button" className="runway-lane-more" aria-expanded={open} onClick={() => setExpanded(value => open ? value.filter(stage => stage !== lane.stage) : [...value, lane.stage])}>{open ? '收起' : `展开其余 ${hidden} 个`}</button>}</header>
        <div className="runway-track" style={compact ? undefined : { width: layout.width, height: Math.max(1, rows) * ROW + 10 }}>
          {!compact && <>
            {layout.staleX !== null && <div className="runway-stale-zone" style={{ left: layout.staleX }} aria-hidden="true" />}
            {layout.ticks.map(tick => <i key={tick.days} className="runway-grid" style={{ left: tick.left }} aria-hidden="true" />)}
          </>}
          {shown.map(card)}
          {!lane.cards.length && <span className="runway-empty">当前页没有处于此阶段的 PR</span>}
        </div>
      </section>;
      })}
    </div>
    <footer className="runway-legend" aria-hidden="true">
      <span><i className="legend-ci tone-passed" />检查通过</span><span><i className="legend-ci tone-failed" />未通过</span><span><i className="legend-ci tone-pending" />进行中</span><span><i className="legend-ci tone-unknown" />待读取 / 未知</span>
      <span className="legend-draft">草稿 = 虚线边框</span><span>左侧色条 = 变更类型（来自标题与标签）</span>
    </footer>
  </div>;
}
