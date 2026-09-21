import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRun } from '../../src/server/audit/runner';
import { cancelRun, createRun, db, getRun, updateRun } from '../../src/server/audit/store';
import { saveSnapshot } from '../../src/server/workbench/store';

const directory = mkdtempSync(join(tmpdir(), 'repocare-runner-test-'));
const keys = ['REPOCARE_DB_PATH', 'REPOCARE_AI_PROVIDER', 'REPOCARE_AI_MODEL', 'REPOCARE_AI_API_KEY'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const sha = 'a'.repeat(40);
const blobSha = 'b'.repeat(40);

before(() => {
  process.env.REPOCARE_DB_PATH = join(directory, 'audit.sqlite');
  delete process.env.REPOCARE_AI_PROVIDER;
  delete process.env.REPOCARE_AI_MODEL;
  delete process.env.REPOCARE_AI_API_KEY;
});

after(() => {
  db().close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(directory, `audit.sqlite${suffix}`), { force: true });
  rmdirSync(directory);
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

function running(owner: string) {
  const run = createRun(owner, 'https://github.com/example/project');
  updateRun(run.id, state => { state.status = 'running'; });
  return run;
}

function remoteResponse(input: string | URL | Request): Response {
  const url = String(input);
  let value: unknown;
  if (url.endsWith('/repos/example/project')) value = { private: false, default_branch: 'main', language: 'TypeScript' };
  else if (url.includes('/commits?')) value = [{ sha }];
  else if (url.includes('/git/trees/')) value = { truncated: false, tree: [
    { path: 'README.md', mode: '100644', type: 'blob', sha: blobSha, size: 24 },
    { path: 'package.json', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 48 },
  ] };
  else if (url.endsWith(`/git/blobs/${blobSha}`)) value = { encoding: 'base64', content: Buffer.from('# Example\nA demo project.').toString('base64') };
  else if (url.includes('/git/blobs/')) value = { encoding: 'base64', content: Buffer.from('{"scripts":{"test":"node --test"}}').toString('base64') };
  else throw new Error('Unexpected mocked GitHub endpoint');
  return new Response(JSON.stringify(value), { status: 200 });
}

test('real runner persists a completed fixed-commit report without AI configuration', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input));
    return remoteResponse(input);
  });
  const run = running('complete-owner');
  await executeRun(run.id);
  const completed = getRun(run.id)!;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.report?.repository.sha, sha);
  assert.equal(completed.report?.checks.length, 8);
  assert.equal(completed.report?.agentStatus, 'disabled');
  assert.equal(completed.nodes.find(node => node.id === 'agent')?.status, 'skipped');
  assert.ok(completed.nodes.filter(node => node.id !== 'agent').every(node => node.status === 'succeeded'));
  assert.match(completed.report!.scope, /不执行仓库代码/);
  assert.equal(completed.report!.checks.find(check => check.id === 'test-entry')?.status, 'pass');
  assert.ok(calls.some(url => url.includes(`/git/trees/${sha}`)));
  assert.ok(completed.seq > run.seq);
  const persisted = db().prepare('SELECT state FROM audit_runs WHERE id = ?').get(run.id) as { state: string };
  assert.deepEqual(JSON.parse(persisted.state).report, completed.report);
});

test('an inaccessible repository fails without a fabricated report or success nodes', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private response detail should not leak', { status: 404 }));
  const run = running('failed-owner');
  await executeRun(run.id);
  const failed = getRun(run.id)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.report, undefined);
  assert.match(failed.error!, /未找到公开仓库/);
  assert.ok(!failed.error!.includes('private response detail'));
  assert.equal(failed.nodes[0].status, 'failed');
  assert.ok(failed.nodes.slice(1).every(node => node.status === 'skipped'));
});

test('recovery uses persisted snapshot even when GitHub is unavailable', async t => {
  const remote = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Recovery must not refetch the repository'); });
  const run = running('checkpoint-owner');
  saveSnapshot(run.id, {
    repository: { owner: 'example', name: 'project', fullName: 'example/project', url: run.repoUrl, description: '', branch: 'main', sha, language: 'TypeScript' },
    files: [], contents: [], warnings: [], treeTruncated: false,
  });
  await executeRun(run.id);
  assert.equal(getRun(run.id)?.status, 'completed');
  assert.equal(getRun(run.id)?.report?.repository.sha, sha);
  assert.equal(remote.mock.callCount(), 0);
});

test('cancelling while an active content request is pending aborts it and preserves cancellation', async t => {
  const run = running('cancel-pending-owner');
  let requestedAbort = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).includes('/git/blobs/')) return remoteResponse(input);
    cancelRun(run.id);
    return await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { requestedAbort = true; reject(init!.signal!.reason); }, { once: true });
    });
  });
  await executeRun(run.id);
  const cancelled = getRun(run.id)!;
  assert.ok(requestedAbort);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequested, true);
  assert.equal(cancelled.report, undefined);
  assert.equal(cancelled.error, undefined);
  assert.equal(cancelled.nodes.find(node => node.id === 'collect')?.status, 'cancelled');
  assert.ok(cancelled.nodes.slice(2).every(node => node.status === 'cancelled'));
});

test('a content response arriving immediately after cancellation cannot overwrite terminal state', async t => {
  const run = running('cancel-race-owner');
  let requestsAfterCancel = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (getRun(run.id)!.cancelRequested) requestsAfterCancel += 1;
    if (String(input).includes('/git/blobs/')) cancelRun(run.id);
    return remoteResponse(input);
  });
  await executeRun(run.id);
  const cancelled = getRun(run.id)!;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.report, undefined);
  assert.equal(cancelled.nodes.find(node => node.id === 'report')?.status, 'cancelled');
  assert.equal(requestsAfterCancel, 0);
});
