import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitItem, IssueTriage } from '../../src/contracts/workbench';
import { ATTENTION_SPLIT, layoutIssueMatrix, matrixMissing, matrixQuadrant } from '../../src/features/workbench/issue-matrix-model';
import { issueAttention, issueCategorySignal, type IssueVisualSignal } from '../../src/features/workbench/issue-visual-signals';

const now = Date.parse('2026-10-24T12:00:00Z');
const triage = (patch: Partial<IssueTriage>): IssueTriage => ({ repoUrl: 'r', number: 1, sourceUpdatedAt: '2026-10-20T00:00:00Z', category: 'bug', priority: 'high', confidence: 'medium', needsMoreInfo: false, language: 'English', titleZh: '', summaryZh: '', providedInformation: [], missingInformation: [], suggestedLabels: [], suggestedAction: 'reply', workflowStatus: 'ready-to-reply', commentsZh: [], analyzedAt: '2026-10-20T00:00:00Z', ...patch } as IssueTriage);
const issue = (number: number, patch: Partial<GitItem> = {}): GitItem => ({ number, title: `Issue ${number}`, body: '', url: `https://github.com/o/r/issues/${number}`, state: 'open', author: 'a', updatedAt: '2026-10-20T00:00:00Z', labels: [], commentCount: 2, ...patch });
const signalsFor = (items: GitItem[]) => new Map<string, IssueVisualSignal>(items.map(item => [item.url, { classification: issueCategorySignal(item), attention: issueAttention(item, 'maintenance', now) }]));

test('the information axis only comes from saved triage', () => {
  assert.equal(matrixMissing(issue(1)), null, 'untriaged issues have no position');
  assert.equal(matrixMissing(issue(2, { triage: triage({ missingInformation: ['日志', '版本'] }) })), 2);
  assert.equal(matrixMissing(issue(3, { triage: triage({ needsMoreInfo: true }) })), 1, 'needsMoreInfo without a list still counts as missing');
  assert.equal(matrixMissing(issue(4, { triage: triage({}) })), 0);
});

test('quadrants combine the attention split with the information gap', () => {
  assert.equal(matrixQuadrant(ATTENTION_SPLIT, 0), 'act');
  assert.equal(matrixQuadrant(ATTENTION_SPLIT, 2), 'clarify');
  assert.equal(matrixQuadrant(ATTENTION_SPLIT - 1, 0), 'schedule');
  assert.equal(matrixQuadrant(ATTENTION_SPLIT - 1, 1), 'watch');
});

test('triaged issues are placed inside their quadrant; untriaged ones wait in the tray', () => {
  const items = [
    issue(10, { triage: triage({ priority: 'high' }), commentCount: 30 }),
    issue(11, { triage: triage({ priority: 'high', missingInformation: ['日志'] }) }),
    issue(12, { triage: triage({ priority: 'low' }) }),
    issue(13, { triage: triage({ priority: 'low', missingInformation: ['a', 'b', 'c', 'd', 'e'] }) }),
    issue(14), issue(15, { commentCount: 40 }),
    ...Array.from({ length: 12 }, (_, index) => issue(20 + index, { triage: triage({ priority: index % 2 ? 'high' : 'low' }) })),
  ];
  const signals = signalsFor(items);
  const layout = layoutIssueMatrix(items, signals, 800, 420);
  assert.equal(layout.points.length + layout.tray.length, items.length, 'every issue appears once');
  assert.deepEqual(layout.tray.map(entry => entry.item.number).sort(), [14, 15]);
  assert.ok(layout.tray[0].attention >= layout.tray[1].attention, 'tray is sorted by known attention');
  for (const point of layout.points) {
    const right = point.x >= layout.splitX, upper = point.y < layout.middle;
    assert.equal(right, point.attention >= ATTENTION_SPLIT, `#${point.item.number} stays on its attention side`);
    assert.equal(upper, point.missing === 0, `#${point.item.number} stays in its information half`);
    assert.ok(point.x - point.r >= layout.pad.left - 1 && point.x + point.r <= layout.pad.left + layout.plotWidth + 1);
    assert.ok(point.y - point.r >= layout.pad.top - 1 && point.y + point.r <= layout.pad.top + layout.plotHeight + 1);
  }
  const big = layout.points.find(point => point.item.number === 10)!, small = layout.points.find(point => point.item.number === 12)!;
  assert.ok(big.r > small.r, 'bubble size follows discussion volume');
  assert.equal(layout.counts.act + layout.counts.clarify + layout.counts.schedule + layout.counts.watch, layout.points.length);
  assert.deepEqual(layout, layoutIssueMatrix(items, signals, 800, 420), 'layout is deterministic');
});

test('an empty page yields an empty matrix and tray', () => {
  const layout = layoutIssueMatrix([], new Map(), 600, 360);
  assert.equal(layout.points.length, 0);
  assert.equal(layout.tray.length, 0);
});
