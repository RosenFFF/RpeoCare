import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireWorker, cancelRun, claimRun, createRun, db, getRun, heartbeat, listRuns, releaseWorker, updateRun, workerOnline } from '../../src/server/audit/store';

const directory = mkdtempSync(join(tmpdir(), 'repocare-store-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

test('tasks are isolated by owner; cancellation is persistent and cannot be claimed', () => {
  const run = createRun('owner-a', 'https://github.com/example/project');
  assert.equal(getRun(run.id, 'owner-b'), undefined);
  assert.equal(listRuns('owner-b').length, 0);
  const cancelled = cancelRun(run.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(cancelled.nodes.every(node => node.status === 'cancelled'));
  assert.ok(cancelled.seq > run.seq);
});

test('worker lease prevents double execution; restart marks interrupted run failed', () => {
  assert.equal(acquireWorker('worker-a'), true);
  assert.equal(acquireWorker('worker-b'), false);
  const run = createRun('owner-b', 'https://github.com/example/project');
  assert.equal(claimRun('worker-b'), undefined);
  assert.equal(claimRun('worker-a')?.id, run.id);
  assert.equal(claimRun('worker-a'), undefined);
  updateRun(run.id, state => { state.nodes[0].status = 'running'; });
  db().prepare("UPDATE audit_worker SET heartbeat = 0 WHERE id = 'audit'").run();
  assert.equal(workerOnline(), false);
  assert.equal(acquireWorker('worker-b'), true);
  assert.equal(heartbeat('worker-a'), false);
  const recovered = getRun(run.id)!;
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.nodes[0].status, 'failed');
  assert.ok(recovered.error?.includes('中断'));
  releaseWorker('worker-b');
});

test('per-owner queue limit rejects an extra job without inserting it', () => {
  createRun('owner-c', 'https://github.com/example/one');
  createRun('owner-c', 'https://github.com/example/two');
  assert.throws(() => createRun('owner-c', 'https://github.com/example/three'), /两个/);
  assert.equal(listRuns('owner-c').length, 2);
});

test('completed state persists and cannot be cancelled retroactively', () => {
  const run = createRun('owner-d', 'https://github.com/example/project');
  updateRun(run.id, state => { state.status = 'completed'; state.error = undefined; });
  assert.equal(getRun(run.id)?.status, 'completed');
  assert.equal(getRun(run.id)?.seq, run.seq + 1);
  assert.equal(cancelRun(run.id).status, 'completed');
});
