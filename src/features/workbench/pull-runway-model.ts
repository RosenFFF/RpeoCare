import type { GitItem } from '@/contracts/workbench';

/** Review stages come only from saved review snapshots; nothing is inferred from titles or age. */
export type RunwayStage = 'unreviewed' | 'reviewing' | 'findings' | 'stale' | 'reviewed';
export const runwayStages: { id: RunwayStage; label: string; hint: string }[] = [
  { id: 'unreviewed', label: '待审查', hint: '还没有 AI 审查记录，可先读取文件与检查' },
  { id: 'reviewing', label: '审查进行中', hint: '分块审查排队、执行中或只完成了一部分' },
  { id: 'findings', label: '待确认发现', hint: 'AI 发现等待维护者逐条确认' },
  { id: 'stale', label: '需重新审查', hint: '上次审查后 PR 有新提交或基线变化' },
  { id: 'reviewed', label: '审查完成', hint: '已有审查报告，没有待确认的发现' },
];

export function runwayStage(item: GitItem): RunwayStage {
  const snapshot = item.reviewSnapshot;
  if (!snapshot) return 'unreviewed';
  if (snapshot.state === 'stale' || snapshot.coverageStatus === 'stale') return 'stale';
  if (snapshot.coverageStatus && ['queued', 'running', 'partial', 'cancelled'].includes(snapshot.coverageStatus)) return 'reviewing';
  if (snapshot.openFindingCount > 0) return 'findings';
  return 'reviewed';
}

const day = 86_400_000;
export const STALE_DAYS = 14;

/** Days since the PR was last updated; unknown dates return null instead of a guess. */
export function idleDays(item: GitItem, now: number) {
  const time = Date.parse(item.updatedAt);
  return Number.isFinite(time) ? Math.max(0, (now - time) / day) : null;
}

export function idleLabel(days: number | null) {
  if (days === null) return '更新时间未知';
  if (days < 1) return '今天更新';
  if (days < 30) return `${Math.floor(days)} 天未更新`;
  if (days < 365) return `${Math.floor(days / 30)} 个月未更新`;
  return '超过一年未更新';
}

const candidateTicks = [{ days: 0, label: '今天' }, { days: 1, label: '1 天' }, { days: 3, label: '3 天' }, { days: 7, label: '1 周' }, { days: 14, label: '2 周' }, { days: 30, label: '1 个月' }, { days: 90, label: '3 个月' }, { days: 180, label: '半年' }, { days: 365, label: '1 年' }];

/** A log-like idle-time axis fitted to the page: recent changes get room, long tails stay on screen. */
export function idleScale(maximumDays: number) {
  const span = Math.max(7, Math.min(365, Math.ceil(maximumDays * 1.1)));
  const at = (days: number) => Math.min(1, Math.log1p(Math.max(0, days)) / Math.log1p(span));
  return { span, at, ticks: candidateTicks.filter(tick => tick.days <= span).map(tick => ({ ...tick, x: at(tick.days) })) };
}

export type RunwayCard = { item: GitItem; stage: RunwayStage; days: number | null; x: number; column: number; row: number };
export type RunwayLane = { stage: RunwayStage; label: string; hint: string; rows: number; cards: RunwayCard[] };

/**
 * Bins PR tickets into equal idle-time columns and stacks them inside each
 * stage lane, so every column height reads as "how many PRs went quiet in this window".
 */
export function layoutRunway(items: GitItem[], trackWidth: number, cardWidth: number, now: number) {
  const gap = 8;
  const columns = Math.max(1, Math.floor((Math.max(cardWidth, trackWidth) + gap) / (cardWidth + gap)));
  const pitch = cardWidth + gap;
  const width = columns * pitch - gap;
  const known = items.map(item => idleDays(item, now)).filter((value): value is number => value !== null);
  const scale = idleScale(Math.max(0, ...known));
  const columnOf = (days: number | null) => days === null ? columns - 1 : Math.min(columns - 1, Math.floor(scale.at(days) * columns));
  const lanes: RunwayLane[] = runwayStages.map(stage => {
    const heights = Array.from({ length: columns }, () => 0);
    const cards = items.filter(item => runwayStage(item) === stage.id)
      .map(item => { const days = idleDays(item, now); return { item, days, column: columnOf(days) }; })
      .sort((a, b) => a.column - b.column || (a.days ?? Infinity) - (b.days ?? Infinity) || a.item.number - b.item.number)
      .map(entry => ({ ...entry, stage: stage.id, x: entry.column * pitch, row: heights[entry.column]++ }));
    return { stage: stage.id, label: stage.label, hint: stage.hint, rows: Math.max(0, ...heights), cards };
  });
  const position = (days: number) => Math.round(scale.at(days) * columns * pitch);
  return {
    lanes, scale, width, columns, position,
    ticks: scale.ticks.map(tick => ({ ...tick, left: position(tick.days) })).filter(tick => tick.left <= width - 24 || tick.days === 0),
    stale: items.filter(item => (idleDays(item, now) ?? 0) >= STALE_DAYS).length,
    staleX: scale.span >= STALE_DAYS ? position(STALE_DAYS) : null,
  };
}
