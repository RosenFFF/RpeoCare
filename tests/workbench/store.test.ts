import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, createRun, getRun, updateRun } from '../../src/server/audit/store';
import { createDraft, getDraft, getMessages, saveMessages, saveProject, getProject, updateDraft, withOperation } from '../../src/server/workbench/store';
import { claimTask, pulseWorker } from '../../src/server/audit/queue';
import { accountSession, authDb, saveGithubAccount, githubAccount } from '../../src/server/github/connection';
import { passwordHash, verifyPassword, emailDb, redeem } from '../../src/server/auth/email';
import { hash } from '../../src/server/github/connection';
import { session } from '../../src/server/audit/http';
import { NextRequest } from 'next/server';

const directory = mkdtempSync(join(tmpdir(), 'repocare-workbench-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

test('projects, drafts and conversations isolate owners; edits require exact revisions', () => {
  saveProject('alice', { repoUrl: 'https://github.com/example/project', fullName: 'example/project' });
  assert.equal(getProject('bob'), null);
  const draft = createDraft('alice', { kind: 'file', repoUrl: 'https://github.com/example/project', baseSha: 'a'.repeat(40), path: 'README.md', title: 'docs', before: '', content: 'first' });
  assert.throws(() => getDraft('bob', draft.id));
  const edited = updateDraft('alice', draft.id, 1, { content: 'reviewed' });
  assert.equal(edited.revision, 2); assert.throws(() => updateDraft('alice', draft.id, 1, { content: 'stale' }));
  updateDraft('alice', draft.id, 2, { status: 'published' });
  assert.throws(() => updateDraft('alice', draft.id, 3, { content: 'changed' }));
  saveMessages('alice', 'run', [{ role: 'user', content: 'question', at: 'now' }]);
  assert.equal(getMessages('bob', 'run').length, 0);
});
test('operation lock prevents simultaneous duplicate work and releases after failure', async () => {
  await withOperation('alice', 'chat', async () => { await assert.rejects(withOperation('alice', 'chat', async () => 1), /正在执行/); });
  await assert.rejects(withOperation('alice', 'chat', async () => { throw new Error('failure'); }));
  assert.equal(await withOperation('alice', 'chat', async () => 2), 2);
});
test('worker pool claims each task once and requeues stale execution up to a bound', () => {
  pulseWorker('worker-a'); pulseWorker('worker-b');
  const run = createRun('queue-owner', 'https://github.com/example/project');
  assert.equal(claimTask('worker-a')?.id, run.id);
  assert.equal(claimTask('worker-b'), undefined);
  db().prepare('UPDATE run_leases SET expires=0 WHERE run_id=?').run(run.id);
  assert.equal(claimTask('worker-b')?.id, run.id);
  db().prepare('UPDATE run_leases SET expires=0, attempts=3 WHERE run_id=?').run(run.id);
  assert.equal(claimTask('worker-a'), undefined);
  assert.equal(getRun(run.id)?.status, 'failed');
});
test('GitHub identity persists independently of cookie; token is encrypted and session expires', () => {
  const session = saveGithubAccount('12345', 'example', 'test-github-secret', true);
  const owner = accountSession(session)!;
  assert.ok(owner); assert.equal(githubAccount(owner)?.token, 'test-github-secret');
  const saved = authDb().prepare('SELECT secret FROM github_accounts WHERE owner=?').get(owner) as { secret: string };
  assert.ok(!saved.secret.includes('test-github-secret'));
  authDb().prepare('UPDATE login_sessions SET expires=0').run();
  assert.equal(accountSession(session), undefined);
});

test('anonymous cookie cannot impersonate a known account owner', () => {
  const token = saveGithubAccount('impersonation-test', 'test', 'fake-secret', false);
  const owner = accountSession(token)!;
  const request = new NextRequest('http://localhost/api/workbench', { headers: { cookie: `repocare_audit_session=${owner}` } });
  assert.equal(session(request), undefined);
});
test('password hashing verifies and reset tokens are one-use and revoke sessions', async () => {
  const digest = await passwordHash('long-test-password');
  assert.equal(await verifyPassword('long-test-password', digest), true);
  assert.equal(await verifyPassword('wrong', digest), false);
  const database = emailDb();
  database.prepare('INSERT INTO email_accounts VALUES (?, ?, ?, ?, 1)').run('test@example.com', 'email-owner', 'Test', digest);
  database.prepare('INSERT INTO email_tokens VALUES (?, ?, ?, ?)').run(hash('test-token'), 'test@example.com', 'reset', Date.now() + 10000);
  database.prepare('INSERT INTO login_sessions VALUES (?, ?, ?)').run(hash('old-session'), 'email-owner', Date.now() + 10000);
  await redeem('test-token', 'reset', 'new-test-password');
  await assert.rejects(redeem('test-token', 'reset', 'another-password'));
  assert.equal(database.prepare('SELECT hash FROM login_sessions WHERE owner=?').get('email-owner'), undefined);
});
