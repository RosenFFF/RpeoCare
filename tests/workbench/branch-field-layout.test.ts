import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RepositoryBranch } from '../../src/contracts/branches';
import { layoutBranchField } from '../../src/features/workbench/branch-field-layout';

const branches = (count: number): RepositoryBranch[] => Array.from({ length: count }, (_, index) => ({ name: index === count - 1 ? 'main' : `feature/long-branch-name-${index}`, protected: index % 5 === 0 }));

function assertReadable(layout: ReturnType<typeof layoutBranchField>, count: number) {
  assert.equal(layout.nodes.length, count);
  for (const node of layout.nodes) {
    assert.ok(node.x >= 18 && node.y >= 18, `${node.branch.name} touches the leading edge`);
    assert.ok(node.x + node.width <= layout.width - 18, `${node.branch.name} exceeds the right edge`);
    assert.ok(node.y + node.height <= layout.height - 18, `${node.branch.name} exceeds the bottom edge`);
    assert.ok(node.width >= 244 && node.height >= 104, 'labels retain readable space');
    if (node.branch.protected) assert.equal(node.height, 124, 'protected labels reserve an extra badge row');
  }
  layout.nodes.forEach((node, index) => {
    for (const other of layout.nodes.slice(index + 1)) {
      assert.ok(node.x + node.width + 18 <= other.x || other.x + other.width + 18 <= node.x || node.y + node.height + 18 <= other.y || other.y + other.height + 18 <= node.y, `${node.branch.name} overlaps ${other.branch.name}`);
    }
  });
}

test('13 desktop branches fit a compact constellation with the default at the top center', () => {
  const source = branches(13);
  for (const width of [1000, 1200, 1600]) {
    const layout = layoutBranchField(source, width, 'main');
    assertReadable(layout, 13);
    const primary = layout.nodes.find(node => node.branch.name === 'main')!;
    assert.equal(primary.x + primary.width / 2, width / 2);
    assert.equal(primary.y, 18);
    assert.ok(layout.height <= (width === 1600 ? 500 : 760));
    assert.ok(new Set(layout.nodes.map(node => node.y)).size > 6, 'desktop positions remain staggered');
    assert.deepEqual(layout, layoutBranchField(source, width, 'main'), 'layout is stable');
  }
  assert.equal(source.at(-1)?.name, 'main', 'default promotion must not mutate source ordering');
});

test('mobile and tablet retain every branch without horizontal overflow or overlapping targets', () => {
  for (const width of [280, 320, 390, 599, 600, 800, 899]) {
    const layout = layoutBranchField(branches(13), width, 'main');
    assert.equal(layout.width, width);
    assertReadable(layout, 13);
    if (width < 600) assert.ok(layout.nodes.every(node => node.x + node.width / 2 === width / 2));
  }
});

test('large directories retain all nodes across independently packed clusters', () => {
  const source = branches(100);
  for (const width of [900, 1000, 1600]) {
    const layout = layoutBranchField(source, width, 'main');
    assertReadable(layout, 100);
    assert.deepEqual(new Set(layout.nodes.map(node => node.branch.name)), new Set(source.map(branch => branch.name)));
  }
});

test('protected long names reserve badge height across staggered tablet rows', () => {
  const source = Array.from({ length: 15 }, (_, index) => ({ name: `release/very-long-protected-branch-name-${index}`, protected: index % 3 !== 0 }));
  for (const width of [390, 600, 800, 899, 1000]) {
    const layout = layoutBranchField(source, width);
    assertReadable(layout, source.length);
    for (const node of layout.nodes) assert.equal(node.height, node.branch.protected ? 124 : 104);
  }
});

test('empty, single and missing-default directories have finite bounds and no fabricated nodes', () => {
  for (const width of [280, 390, 800, 1200]) {
    assertReadable(layoutBranchField([], width, 'main'), 0);
    assertReadable(layoutBranchField(branches(1), width, 'main'), 1);
    assertReadable(layoutBranchField(branches(13), width, 'absent'), 13);
  }
});
