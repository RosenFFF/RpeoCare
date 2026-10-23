import type { RepositoryBranch } from '@/contracts/branches';

export type BranchFieldNode = { branch: RepositoryBranch; x: number; y: number; width: number; height: number };

// Reserve the full label/action rectangle. Desktop candidates form a compact
// constellation; narrower viewports use readable rows without horizontal panning.
export function layoutBranchField(branches: RepositoryBranch[], availableWidth: number, defaultBranch?: string) {
  const width = Math.max(280, Number.isFinite(availableWidth) ? availableWidth : 1000);
  const ordered = [...branches].sort((a, b) => Number(b.name === defaultBranch) - Number(a.name === defaultBranch));
  const nodes: BranchFieldNode[] = [];
  const padding = 18;
  const gap = 18;
  let offset = padding;
  const size = (branch: RepositoryBranch) => ({ width: Math.min(branch.name === defaultBranch ? 290 : 254, width - padding * 2), height: branch.name === defaultBranch || branch.protected ? 124 : 104 });

  if (width < 600) {
    for (const branch of ordered) {
      const dimensions = size(branch);
      nodes.push({ branch, x: (width - dimensions.width) / 2, y: offset, ...dimensions });
      offset += dimensions.height + gap;
    }
    return { width, height: Math.max(140, offset - gap + padding), nodes };
  }

  // A radial search cannot efficiently pack two text columns. Keep the default
  // centered above slightly staggered pairs on tablet-sized containers.
  if (width < 900) {
    const primary = ordered[0]?.name === defaultBranch ? ordered[0] : undefined;
    if (primary) {
      const dimensions = size(primary);
      nodes.push({ branch: primary, x: (width - dimensions.width) / 2, y: offset, ...dimensions });
      offset += dimensions.height + gap;
    }
    const rest = primary ? ordered.slice(1) : ordered;
    for (let row = 0; row < rest.length; row += 2) {
      let rowHeight = 0;
      rest.slice(row, row + 2).forEach((branch, column) => {
        const dimensions = size(branch);
        const stagger = column * 10;
        nodes.push({ branch, x: padding + column * (width - padding * 2) / 2 + ((width - padding * 2) / 2 - dimensions.width) / 2, y: offset + stagger, ...dimensions });
        rowHeight = Math.max(rowHeight, stagger + dimensions.height);
      });
      offset += rowHeight + gap;
    }
    return { width, height: Math.max(140, ...nodes.map(node => node.y + node.height + padding)), nodes };
  }

  const golden = Math.PI * (3 - Math.sqrt(5));
  // Bound collision work to 16 nodes per cluster rather than a global force
  // simulation. Choose a low candidate so the default stays near the top.
  for (let base = 0; base < ordered.length; base += 16) {
    const batch = ordered.slice(base, base + 16);
    const placed: BranchFieldNode[] = [];
    batch.forEach((branch, index) => {
      const { width: nodeWidth, height: nodeHeight } = size(branch);
      let x = (width - nodeWidth) / 2;
      let y = 0;
      let best = Infinity;
      for (let attempt = 0; index > 0 && attempt < 1200; attempt++) {
        const angle = (attempt + index * 13 + base) * golden;
        const radius = 70 + Math.sqrt(attempt) * 22;
        const candidateX = Math.round(width / 2 + Math.cos(angle) * radius - nodeWidth / 2);
        const candidateY = Math.round(62 + Math.sin(angle) * radius * .8 - nodeHeight / 2);
        if (candidateX < padding || candidateX + nodeWidth > width - padding || candidateY < 0) continue;
        const score = candidateY + nodeHeight + Math.abs(candidateX + nodeWidth / 2 - width / 2) * .04;
        if (score >= best) continue;
        if (placed.every(other => candidateX + nodeWidth + gap <= other.x || candidateX >= other.x + other.width + gap || candidateY + nodeHeight + gap <= other.y || candidateY >= other.y + other.height + gap)) {
          x = candidateX; y = candidateY; best = score;
        }
      }
      if (index > 0 && best === Infinity) {
        x = (width - nodeWidth) / 2;
        y = Math.max(...placed.map(other => other.y + other.height)) + gap;
      }
      placed.push({ branch, x, y, width: nodeWidth, height: nodeHeight });
    });
    const maximum = Math.max(...placed.map(node => node.y + node.height));
    placed.forEach(node => nodes.push({ ...node, y: node.y + offset }));
    offset += maximum + gap;
  }
  return { width, height: Math.max(140, offset - gap + padding), nodes };
}
