import type { GitItem } from '@/contracts/workbench';

/** Preserve the confluence relationship; spacing reserves the full text footprint. */
export function pullMapLayout(items: GitItem[], compact = false, overview = false) {
  const nodeWidth = overview ? 222 : compact ? 224 : 256;
  const nodeHeight = overview ? 154 : compact ? 236 : 252;
  const columnPitch = overview ? 250 : compact ? 268 : 300;
  const rowPitch = overview ? 190 : compact ? 270 : 294;
  const byBase = new Map<string, GitItem[]>();
  for (const item of items) {
    const base = item.baseRef || '目标分支未知';
    const group = byBase.get(base) || [];
    group.push(item); byBase.set(base, group);
  }
  let top = 0;
  const groups = [...byBase].map(([base, pulls]) => {
    const columns = pulls.length <= 6 ? Math.min(3, pulls.length) : Math.min(overview ? 6 : 4, Math.ceil(Math.sqrt(pulls.length * (overview ? 1.9 : 1.4))));
    const height = Math.max(370, Math.ceil(pulls.length / columns) * rowPitch + 90);
    const width = columns * columnPitch + 210;
    const hub = { x: columns * columnPitch + 100, y: top + Math.min(height / 2, 330) };
    const nodes = pulls.map((item, index) => ({ item, x: 28 + nodeWidth / 2 + index % columns * columnPitch, y: top + 74 + Math.floor(index / columns) * rowPitch + (index % columns % 2 ? 22 : 0), channelY: top + 12 + Math.floor(index / columns) * rowPitch + index % columns * 4, portY: hub.y + (index - (pulls.length - 1) / 2) * Math.min(8, 200 / pulls.length) }));
    const group = { base, nodes, hub, top, width, height }; top += height + 50;
    return group;
  });
  return { groups, width: Math.max(510, ...groups.map(group => group.width)), height: Math.max(370, top - 50), nodeWidth, nodeHeight };
}
