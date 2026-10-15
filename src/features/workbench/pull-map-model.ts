import type { GitItem } from '@/contracts/workbench';
import { pullClassification, type PullType } from './inbox-model';

export const pullLaneOrder: PullType[] = ['feature', 'fix', 'docs', 'dependency', 'other'];
export const pullCardWidth = 268;
export const pullCardHeight = 172;
export const pullCardPitch = 194;
export const pullCardsTop = 192;

/** Category lanes describe navigation hints, never a severity ranking. */
export function pullMapLayout(items: GitItem[], expanded: ReadonlySet<PullType>) {
  const groups = pullLaneOrder.map(type => ({ type, items: items.filter(item => pullClassification(item) === type) })).filter(group => group.items.length);
  const lanes = groups.map((group, index) => {
    const left = 30 + index * 304;
    const shown = expanded.has(group.type) ? group.items : group.items.slice(0, 2);
    return { ...group, left, center: left + pullCardWidth / 2, hidden: group.items.length - shown.length,
      nodes: shown.map((item, row) => ({ item, left, top: pullCardsTop + row * pullCardPitch })),
      moreTop: pullCardsTop + shown.length * pullCardPitch,
    };
  });
  return { lanes, width: Math.max(328, lanes.length * 304 + 24), height: Math.max(430, ...lanes.map(lane => lane.moreTop + (lane.items.length > 2 ? 66 : 18))), visibleCount: lanes.reduce((sum, lane) => sum + lane.nodes.length, 0) };
}
