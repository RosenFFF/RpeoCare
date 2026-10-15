import type { RepositoryBranch } from '@/contracts/branches';

export type BranchFieldNode = { branch: RepositoryBranch; x: number; y: number; width: number; height: number };

// Pack bounded groups independently so large directories do not need an O(n²)
// force simulation. Golden-angle candidates avoid rows; rectangle exclusion
// reserves the entire label and action area, not just the icon.
export function layoutBranchField(branches: RepositoryBranch[], availableWidth: number, defaultBranch?: string) {
  const width = Math.max(branches.length > 1 ? 800 : 380, availableWidth);
  const nodes: BranchFieldNode[] = [];
  let offset = 28;
  const gap = 30;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let base = 0; base < branches.length; base += 16) {
    const batch = branches.slice(base, base + 16);
    const placed: BranchFieldNode[] = [];
    batch.forEach((branch, index) => {
      const primary = branch.name === defaultBranch;
      const nodeWidth = primary ? 306 : 270;
      const nodeHeight = primary ? 176 : 146;
      let x = (width - nodeWidth) / 2;
      let y = -nodeHeight / 2;
      let found = index === 0;
      // Only 16 rectangles are compared per candidate. The final fallback has
      // unbounded vertical room and guarantees placement even on narrow screens.
      for (let attempt = 0; !found && attempt < 2200; attempt++) {
        const angle = (attempt + index * 13 + base) * golden;
        const radius = 138 + Math.sqrt(attempt) * 25;
        x = width / 2 + Math.cos(angle) * radius - nodeWidth / 2;
        y = Math.sin(angle) * radius * .7 - nodeHeight / 2;
        if (x < 28 || x + nodeWidth > width - 28) continue;
        found = placed.every(other => x + nodeWidth + gap <= other.x || x >= other.x + other.width + gap || y + nodeHeight + gap <= other.y || y >= other.y + other.height + gap);
      }
      if (!found) {
        x = (width - nodeWidth) / 2;
        y = Math.max(...placed.map(other => other.y + other.height)) + gap;
      }
      placed.push({ branch, x, y, width: nodeWidth, height: nodeHeight });
    });
    const minimum = Math.min(...placed.map(node => node.y));
    const maximum = Math.max(...placed.map(node => node.y + node.height));
    placed.forEach(node => nodes.push({ ...node, y: node.y - minimum + offset }));
    offset += maximum - minimum + 74;
  }
  return { width, height: Math.max(branches.length > 1 ? 400 : 230, offset - 20), nodes };
}
