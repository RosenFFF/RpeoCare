import type { GitItem } from '@/contracts/workbench';

/** A single readable overview; overflow is handled by native scrolling. */
export function pullMapLayout(items: GitItem[], availableWidth = 1200) {
  const nodeWidth = 208;
  const nodeHeight = 132;
  const columnPitch = 236;
  const rowPitch = 160;
  const byBase = new Map<string, GitItem[]>();
  for (const item of items) {
    const base = item.baseRef || '目标分支未知';
    const group = byBase.get(base) || [];
    group.push(item); byBase.set(base, group);
  }
  let top = 0;
  const groups = [...byBase].map(([base, pulls]) => {
    const columns = Math.max(1, Math.min(6, pulls.length, Math.floor((Math.max(460, availableWidth) - 210) / columnPitch)));
    const height = Math.max(280, Math.ceil(pulls.length / columns) * rowPitch + 72);
    const width = columns * columnPitch + 210;
    const hub = { x: columns * columnPitch + 100, y: top + Math.min(height / 2, 330) };
    const nodes = pulls.map((item, index) => ({ item, x: 28 + nodeWidth / 2 + index % columns * columnPitch, y: top + 74 + Math.floor(index / columns) * rowPitch + (index % columns % 2 ? 22 : 0), channelY: top + 12 + Math.floor(index / columns) * rowPitch + index % columns * 4, portY: hub.y + (index - (pulls.length - 1) / 2) * Math.min(8, 200 / pulls.length) }));
    const group = { base, nodes, hub, top, width, height }; top += height + 50;
    return group;
  });
  return { groups, width: Math.max(446, ...groups.map(group => group.width)), height: Math.max(280, top - 50), nodeWidth, nodeHeight };
}
