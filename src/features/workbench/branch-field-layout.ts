import type { RepositoryBranch } from '@/contracts/branches';

export const STAR_PALETTE_SIZE = 6;
export const OTHER_GROUP = '*';

export type BranchGroup = { key: string; title: string; hue: number; members: RepositoryBranch[] };
export type SkyStar = { branch: RepositoryBranch; x: number; y: number; r: number; group: string; hue: number };
export type SkyConstellation = {
  key: string; title: string; hue: number; stars: SkyStar[];
  /** Constellation lines: a minimum spanning tree, so lines never loop back across the group. */
  edges: [number, number, number, number][]; label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
};
export type DustStar = { x: number; y: number; r: number; o: number; twinkle: boolean };
export type StarSky = {
  width: number; height: number; center: { x: number; y: number };
  rx: number; ry: number; pole?: { branch: RepositoryBranch; x: number; y: number };
  constellations: SkyConstellation[]; dust: DustStar[];
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function branchGroupKey(name: string) {
  const slash = name.indexOf('/');
  return slash > 0 ? name.slice(0, slash + 1) : '';
}

export function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

/** Label shown inside a constellation: the shared prefix is already in the title. */
export function starLabel(name: string, group: string) {
  return group && group !== OTHER_GROUP && name.startsWith(group) ? name.slice(group.length) : name;
}

/**
 * The default branch becomes the pole star; every other branch joins a
 * constellation named after its first path segment (release/, fix/ …).
 * Single-member prefixes are gathered into one "其他分支" constellation.
 */
export function groupBranches(branches: RepositoryBranch[], defaultBranch?: string) {
  const pole = branches.find(branch => branch.name === defaultBranch);
  const buckets = new Map<string, RepositoryBranch[]>();
  for (const branch of branches) {
    if (branch === pole) continue;
    const key = branchGroupKey(branch.name);
    buckets.set(key, [...(buckets.get(key) ?? []), branch]);
  }
  const loose = [...buckets.entries()].filter(([, members]) => members.length === 1);
  if (loose.length > 1) {
    loose.forEach(([key]) => buckets.delete(key));
    buckets.set(OTHER_GROUP, loose.flatMap(([, members]) => members));
  }
  const groups: BranchGroup[] = [...buckets.entries()].map(([key, members]) => ({
    key,
    title: key === OTHER_GROUP ? '其他分支' : key || '顶层分支',
    hue: 0,
    members: [...members].sort((a, b) => Number(b.protected) - Number(a.protected) || collator.compare(a.name, b.name)),
  })).sort((a, b) => Number(a.key === OTHER_GROUP) - Number(b.key === OTHER_GROUP)
    || Number(b.members.some(branch => branch.protected)) - Number(a.members.some(branch => branch.protected))
    || b.members.length - a.members.length || Number(a.key === '') - Number(b.key === '') || collator.compare(a.key, b.key));
  groups.forEach((group, index) => { group.hue = index % STAR_PALETTE_SIZE; });
  return { pole, groups };
}

/**
 * Deterministic sky chart: each constellation owns an angular sector around the
 * pole, sized by member count. Positions only encode that naming group.
 */
export function layoutStarSky(groups: BranchGroup[], pole: RepositoryBranch | undefined, availableWidth: number, availableHeight: number): StarSky {
  const width = Math.max(260, Math.floor(Number.isFinite(availableWidth) ? availableWidth : 900));
  const height = Math.max(200, Math.floor(Number.isFinite(availableHeight) ? availableHeight : 300));
  const center = { x: width / 2, y: height / 2 };
  const rx = width / 2 - 34;
  const ry = height / 2 - 26;
  const total = groups.reduce((sum, group) => sum + group.members.length, 0);
  const inner = pole ? .4 : .12;
  const weights = groups.map(group => 1 + Math.sqrt(group.members.length));
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
  const gap = groups.length > 1 ? Math.min(.22, Math.PI * .5 / groups.length) : 0;
  const span = Math.PI * 2 - gap * groups.length;
  const radius = total > 160 ? 1.5 : total > 60 ? 1.9 : 2.3;

  let angle = -Math.PI / 2 - (groups.length > 1 ? span * weights[0] / weightSum / 2 : Math.PI / 2);
  const stars: SkyStar[] = [];
  const sectors = groups.map((group, index) => {
    const a0 = angle, a1 = angle + span * weights[index] / weightSum;
    angle = a1 + gap;
    const count = group.members.length;
    group.members.forEach((branch, member) => {
      const seed = hash(branch.name);
      const t = (member + .5) / count;
      const theta = a0 + (a1 - a0) * (.1 + .8 * t) + ((seed % 1000) / 1000 - .5) * (a1 - a0) * .5 / Math.max(1, count);
      const fraction = inner + (1 - inner - .04) * (((seed >>> 10) % 1000) / 1000 * .55 + ((member * .618) % 1) * .45);
      stars.push({ branch, group: group.key, hue: group.hue, r: branch.protected ? radius + 1.1 : radius, x: center.x + Math.cos(theta) * fraction * rx, y: center.y + Math.sin(theta) * fraction * ry });
    });
    return { group, mid: (a0 + a1) / 2 };
  });

  // Light relaxation keeps neighbouring stars clickable; skipped for huge skies.
  if (stars.length <= 400) {
    const minimum = 15;
    for (let round = 0; round < 24; round++) {
      for (let i = 0; i < stars.length; i++) for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i], b = stars[j];
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || .01;
        if (distance >= minimum) continue;
        const push = (minimum - distance) / 2, ux = dx / distance, uy = dy / distance;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
      for (const star of stars) {
        const nx = (star.x - center.x) / rx, ny = (star.y - center.y) / ry, reach = Math.hypot(nx, ny) || .01;
        const clamped = Math.min(.97, Math.max(inner, reach));
        star.x = center.x + nx / reach * clamped * rx; star.y = center.y + ny / reach * clamped * ry;
      }
    }
  }
  stars.forEach(star => { star.x = Math.round(star.x * 10) / 10; star.y = Math.round(star.y * 10) / 10; });

  const constellations = sectors.map(({ group, mid }) => {
    const members = stars.filter(star => star.group === group.key);
    const edges: [number, number, number, number][] = [];
    if (members.length > 1 && members.length <= 40) {
      const joined = new Set([0]);
      while (joined.size < members.length) {
        let best: [number, number, number] = [-1, -1, Infinity];
        for (const from of joined) members.forEach((star, to) => {
          if (joined.has(to)) return;
          const distance = Math.hypot(star.x - members[from].x, star.y - members[from].y);
          if (distance < best[2]) best = [from, to, distance];
        });
        joined.add(best[1]);
        edges.push([members[best[0]].x, members[best[0]].y, members[best[1]].x, members[best[1]].y]);
      }
    }
    const outer = members.reduce((best, star) => Math.hypot((star.x - center.x) / rx, (star.y - center.y) / ry) > Math.hypot((best.x - center.x) / rx, (best.y - center.y) / ry) ? star : best, members[0]);
    const dx = Math.cos(mid), dy = Math.sin(mid);
    const reach = outer ? Math.max(.62, Math.min(.93, Math.hypot((outer.x - center.x) / rx, (outer.y - center.y) / ry) + .1)) : .9;
    const anchor: 'start' | 'middle' | 'end' = dx > .35 ? 'start' : dx < -.35 ? 'end' : 'middle';
    const textWidth = (group.title.length + 3) * 7.2;
    const minimumX = anchor === 'end' ? textWidth + 10 : anchor === 'middle' ? textWidth / 2 + 10 : 10;
    const maximumX = anchor === 'start' ? width - textWidth - 10 : anchor === 'middle' ? width - textWidth / 2 - 10 : width - 10;
    const label = {
      x: Math.round(Math.min(maximumX, Math.max(minimumX, center.x + dx * reach * rx))),
      y: Math.round(Math.min(height - 10, Math.max(16, center.y + dy * reach * ry + (dy > .35 ? 12 : dy < -.35 ? -6 : 4)))),
      anchor,
    };
    return { key: group.key, title: group.title, hue: group.hue, stars: members, edges, label };
  });

  let seed = hash(`${width}:${height}:${total}`) || 1;
  const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
  const dust = Array.from({ length: Math.min(220, Math.floor(width * height / 2600)) }, () => {
    const roll = random();
    return { x: Math.round(random() * width), y: Math.round(random() * height), r: roll > .95 ? 1.3 : roll > .7 ? .9 : .55, o: .18 + random() * .5, twinkle: roll > .86 };
  });

  return { width, height, center, rx, ry, pole: pole ? { branch: pole, x: center.x, y: center.y } : undefined, constellations, dust };
}
