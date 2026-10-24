import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RepositoryBranch } from '../../src/contracts/branches';
import { groupBranches, layoutStarSky, OTHER_GROUP, starLabel } from '../../src/features/workbench/branch-field-layout';

const mixed: RepositoryBranch[] = [
  { name: 'main', protected: true },
  { name: 'release/stable', protected: true }, { name: 'release/1.x', protected: false },
  { name: 'fix/reader', protected: false }, { name: 'fix/maclaurin-series', protected: false },
  { name: 'gh-pages', protected: false }, { name: 'docs/contributing', protected: false },
  { name: 'dependabot/uv/lxml-6.1.0', protected: false }, { name: 'maintenance/typing', protected: false },
];
const many = (count: number): RepositoryBranch[] => Array.from({ length: count }, (_, index) => ({ name: index === count - 1 ? 'main' : `${['feature', 'fix', 'docs', 'dependabot/pip'][index % 4]}/branch-${index}`, protected: index % 9 === 0 }));

test('the default branch is the pole and other branches form prefix constellations', () => {
  const { pole, groups } = groupBranches(mixed, 'main');
  assert.equal(pole?.name, 'main');
  assert.equal(groups[0].key, 'release/', 'groups with protected members lead');
  assert.deepEqual(groups[0].members.map(branch => branch.name), ['release/stable', 'release/1.x'], 'protected members come first');
  const other = groups.find(group => group.key === OTHER_GROUP)!;
  assert.equal(other.title, '其他分支');
  assert.deepEqual(other.members.map(branch => branch.name).sort(), ['dependabot/uv/lxml-6.1.0', 'docs/contributing', 'gh-pages', 'maintenance/typing'].sort(), 'single-member prefixes are gathered');
  assert.equal(groups.at(-1)?.key, OTHER_GROUP, 'the gathered group comes last');
  groups.forEach((group, index) => assert.equal(group.hue, index % 6));
  assert.equal(starLabel('release/stable', 'release/'), 'stable');
  assert.equal(starLabel('gh-pages', OTHER_GROUP), 'gh-pages');
  assert.equal(mixed[0].name, 'main', 'source order is not mutated');
});

function assertSky(sky: ReturnType<typeof layoutStarSky>, count: number, pole: boolean) {
  const stars = sky.constellations.flatMap(group => group.stars);
  assert.equal(stars.length + (sky.pole ? 1 : 0), count, 'every branch is drawn exactly once');
  assert.equal(new Set(stars.map(star => star.branch.name)).size, stars.length);
  for (const star of stars) {
    const reach = Math.hypot((star.x - sky.center.x) / sky.rx, (star.y - sky.center.y) / sky.ry);
    assert.ok(reach <= .98, `${star.branch.name} stays inside the sky`);
    if (pole) assert.ok(reach >= .39, `${star.branch.name} keeps clear of the pole`);
    assert.ok(star.x > 0 && star.x < sky.width && star.y > 0 && star.y < sky.height);
  }
  for (const group of sky.constellations) {
    if (group.stars.length > 1 && group.stars.length <= 40) assert.equal(group.edges.length, group.stars.length - 1, 'lines form a spanning tree');
    assert.ok(group.label.x >= 10 && group.label.x <= sky.width - 10 && group.label.y >= 16 && group.label.y <= sky.height - 10);
  }
}

test('sky layout keeps stars inside the chart, apart from the pole and readable', () => {
  for (const [width, height] of [[900, 340], [1300, 360], [360, 250]]) {
    const { pole, groups } = groupBranches(mixed, 'main');
    const sky = layoutStarSky(groups, pole, width, height);
    assertSky(sky, mixed.length, true);
    assert.deepEqual(sky, layoutStarSky(groups, pole, width, height), 'layout is deterministic');
    const stars = sky.constellations.flatMap(group => group.stars);
    stars.forEach((star, index) => stars.slice(index + 1).forEach(other => assert.ok(Math.hypot(star.x - other.x, star.y - other.y) >= 9, `${star.branch.name} crowds ${other.branch.name}`)));
  }
});

test('large directories keep every node and finite bounds', () => {
  for (const count of [100, 600]) {
    const { pole, groups } = groupBranches(many(count), 'main');
    assertSky(layoutStarSky(groups, pole, 1100, 360), count, true);
  }
});

test('empty, single and missing-default directories fabricate nothing', () => {
  for (const width of [260, 900]) {
    const empty = groupBranches([], 'main');
    assertSky(layoutStarSky(empty.groups, empty.pole, width, 260), 0, false);
    const single = groupBranches([{ name: 'main', protected: false }], 'main');
    assertSky(layoutStarSky(single.groups, single.pole, width, 260), 1, true);
    const absent = groupBranches(mixed, 'absent');
    assert.equal(absent.pole, undefined);
    assertSky(layoutStarSky(absent.groups, absent.pole, width, 260), mixed.length, false);
  }
});
