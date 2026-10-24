import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitItem, PullReviewSnapshot } from '../../src/contracts/workbench';
import { idleDays, idleLabel, idleScale, layoutRunway, runwayStage } from '../../src/features/workbench/pull-runway-model';

const now = Date.parse('2026-10-24T12:00:00Z');
const day = 86_400_000;
const snapshot = (patch: Partial<PullReviewSnapshot>): PullReviewSnapshot => ({ state: 'current', findingCount: 0, openFindingCount: 0, acceptedFindingCount: 0, analyzedAt: '2026-10-20T00:00:00Z', ...patch });
const pull = (number: number, ageDays: number, reviewSnapshot?: PullReviewSnapshot): GitItem => ({ number, title: `PR ${number}`, body: '', url: `https://github.com/o/r/pull/${number}`, state: 'open', author: 'a', labels: [], updatedAt: new Date(now - ageDays * day).toISOString(), reviewSnapshot });

test('stages come only from saved review snapshots', () => {
  assert.equal(runwayStage(pull(1, 0)), 'unreviewed');
  assert.equal(runwayStage(pull(2, 0, snapshot({ coverageStatus: 'partial', completedBlocks: 1, totalBlocks: 3 }))), 'reviewing');
  assert.equal(runwayStage(pull(3, 0, snapshot({ coverageStatus: 'queued' }))), 'reviewing');
  assert.equal(runwayStage(pull(4, 0, snapshot({ openFindingCount: 2, findingCount: 2 }))), 'findings');
  assert.equal(runwayStage(pull(5, 0, snapshot({ state: 'stale', openFindingCount: 2 }))), 'stale', 'stale wins over open findings');
  assert.equal(runwayStage(pull(6, 0, snapshot({ coverageStatus: 'completed', acceptedFindingCount: 1 }))), 'reviewed');
});

test('idle time is measured honestly and unknown dates stay unknown', () => {
  assert.equal(Math.round(idleDays(pull(1, 3), now)!), 3);
  assert.equal(idleDays({ ...pull(1, 0), updatedAt: 'not a date' }, now), null);
  assert.equal(idleLabel(null), '更新时间未知');
  assert.equal(idleLabel(0.2), '今天更新');
  assert.equal(idleLabel(5.6), '5 天未更新');
  assert.equal(idleLabel(70), '2 个月未更新');
  const scale = idleScale(10);
  assert.equal(scale.span, 11, 'axis fits the oldest PR with a little headroom');
  assert.equal(idleScale(1).span, 7, 'axis covers at least a week');
  assert.equal(idleScale(2000).span, 365, 'axis is capped at a year');
  assert.equal(scale.at(0), 0); assert.equal(scale.at(11), 1); assert.ok(scale.at(1) < scale.at(3) && scale.at(3) < scale.at(7));
  assert.ok(scale.at(1) > .25, 'recent days get visible room');
});

test('tickets are binned into idle-time columns and stacked without overlap', () => {
  const items = [pull(10, 0), pull(11, 0.1), pull(12, 0.2), pull(13, 20), pull(14, 2, snapshot({ openFindingCount: 1 })), pull(15, 40)];
  const layout = layoutRunway(items, 1000, 200, now);
  assert.equal(layout.columns, 4);
  assert.equal(layout.width, 4 * 208 - 8);
  assert.deepEqual(layout.lanes.map(lane => lane.stage), ['unreviewed', 'reviewing', 'findings', 'stale', 'reviewed']);
  assert.equal(layout.lanes.flatMap(lane => lane.cards).length, items.length, 'every PR is placed exactly once');
  const waiting = layout.lanes[0];
  assert.equal(waiting.rows, 3, 'three same-day tickets stack in one column');
  for (const lane of layout.lanes) for (const a of lane.cards) {
    assert.equal(a.x, a.column * 208);
    assert.ok(a.x + 200 <= layout.width, 'tickets stay inside the track');
    for (const b of lane.cards) if (a !== b) assert.ok(a.column !== b.column || a.row !== b.row, `#${a.item.number} overlaps #${b.item.number}`);
  }
  const column = (number: number) => waiting.cards.find(card => card.item.number === number)!.column;
  assert.ok(column(15) >= column(13) && column(13) > column(10), 'older PRs never sit further left');
  assert.equal(waiting.cards.find(card => card.item.number === 10)!.row, 0, 'the most recent PR leads its column');
  assert.equal(layout.stale, 2, 'PRs idle for two weeks or more are counted');
  assert.ok(layout.staleX !== null && layout.staleX > 0);
  assert.equal(layoutRunway([pull(1, 1)], 1000, 200, now).staleX, null, 'no two-week zone when the axis is shorter');
  const again = layoutRunway(items, 1000, 200, now);
  assert.deepEqual([layout.lanes, layout.ticks, layout.staleX], [again.lanes, again.ticks, again.staleX], 'layout is deterministic');
});

test('empty pages produce empty lanes without fabricated tickets', () => {
  const layout = layoutRunway([], 600, 180, now);
  assert.ok(layout.lanes.every(lane => lane.cards.length === 0 && lane.rows === 0));
  assert.equal(layout.stale, 0);
});
