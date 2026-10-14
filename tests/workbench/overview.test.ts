import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { createRun, db, updateRun } from '../../src/server/audit/store';
import { saveProject } from '../../src/server/workbench/store';
import { getOverview } from '../../src/server/workbench/overview';
import { GET as entry } from '../../src/app/workspace/route';
import type { AuditReport } from '../../src/contracts/audit';

const directory = mkdtempSync(join(tmpdir(), 'repocare-overview-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const repoUrl = 'https://github.com/example/project';
function complete(id: string) {
  updateRun(id, run => {
    run.status = 'completed';
    run.report = { runId: id, repository: { owner: 'example', name: 'project', fullName: 'example/project', url: repoUrl, branch: run.branch || 'main', sha: 'a'.repeat(40), description: '', language: null }, generatedAt: new Date().toISOString(), checks: [], warnings: [], agentStatus: 'disabled', scope: 'rules' } satisfies AuditReport;
  });
}
test('empty overview and first entry contain no demo project', () => {
  assert.equal(getOverview().report, null);
  assert.equal(getOverview('new-owner').project, null);
  assert.equal(new URL(entry(new NextRequest('http://localhost/workspace')).headers.get('location')!).pathname, '/audit');
});
test('successful report survives over 20 newer failures and is scoped to owner, repository and branch', () => {
  const owner = 'overview-owner';
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const first = createRun(owner, repoUrl); complete(first.id);
  for (let index = 0; index < 21; index++) {
    const failed = createRun(owner, repoUrl); updateRun(failed.id, run => { run.status = 'failed'; run.error = 'network'; });
  }
  assert.equal(getOverview(owner).report?.runId, first.id);
  assert.equal(getOverview(owner).latestRun?.status, 'failed');
  saveProject('other-owner', { repoUrl, fullName: 'example/project' });
  assert.equal(getOverview('other-owner').report, null);
  saveProject(owner, { repoUrl, fullName: 'example/project', branch: 'release' });
  assert.equal(getOverview(owner).report, null);
  saveProject(owner, { repoUrl: 'https://github.com/example/other', fullName: 'example/other' });
  assert.equal(getOverview(owner).report, null);
});
test('newer successful task wins even if an older task completes later; active and failed retries preserve it', () => {
  const owner = 'e977842e-b837-4ee5-801c-91eb1d1c65c2';
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const old = createRun(owner, repoUrl), newer = createRun(owner, repoUrl);
  complete(newer.id); complete(old.id);
  assert.equal(getOverview(owner).report?.runId, newer.id);
  const retry = createRun(owner, repoUrl);
  assert.equal(getOverview(owner).latestRun?.id, retry.id);
  assert.equal(getOverview(owner).report?.runId, newer.id);
  const response = entry(new NextRequest('http://localhost/workspace', { headers: { cookie: `repocare_audit_session=${owner}` } }));
  assert.equal(new URL(response.headers.get('location')!).pathname, '/overview');
  updateRun(retry.id, run => { run.status = 'cancelled'; });
  assert.equal(getOverview(owner).report?.runId, newer.id);
});
test('first active task resumes from entry until a report exists', () => {
  const owner = 'c477842e-b837-4ee5-801c-91eb1d1c65c2';
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const run = createRun(owner, repoUrl);
  const response = entry(new NextRequest('http://localhost/workspace', { headers: { cookie: `repocare_audit_session=${owner}` } }));
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.pathname, '/audit'); assert.equal(url.searchParams.get('run'), run.id);
  assert.equal(getOverview(owner).report, null);
});
test('entry preserves browser host even when Next normalizes the request URL', () => {
  const response = entry(new NextRequest('http://localhost:3000/workspace', { headers: { host: '127.0.0.1:3000' } }));
  assert.equal(new URL(response.headers.get('location')!).host, '127.0.0.1:3000');
});

test('overview history contains twelve real successful snapshots scoped to the selected owner, repository and branch', () => {
  const owner = 'history-owner';
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const ids: string[] = [];
  for (let index = 0; index < 14; index++) {
    const run = createRun(owner, repoUrl); complete(run.id); ids.push(run.id);
    updateRun(run.id, value => {
      value.report!.checks = [
        { id: 'readme', title: 'README', category: '文档', status: 'pass', summary: '', evidence: [], source: 'rule' },
        { id: 'license', title: 'LICENSE', category: '文档', status: 'needs_attention', summary: '', evidence: [], source: 'rule' },
        { id: 'tests', title: 'Tests', category: '工程', status: 'unknown', summary: '', evidence: [], source: 'rule' },
      ];
    });
  }
  const failed = createRun(owner, repoUrl); updateRun(failed.id, run => { run.status = 'failed'; });
  const otherBranch = createRun(owner, repoUrl, undefined, undefined, 'release'); complete(otherBranch.id);
  const otherRepository = createRun(owner, 'https://github.com/example/other'); complete(otherRepository.id);
  const otherOwner = createRun('history-other-owner', repoUrl); complete(otherOwner.id);
  const before = db().prepare('SELECT state FROM audit_runs ORDER BY rowid').all();
  const overview = getOverview(owner);
  assert.deepEqual(overview.history.map(point => point.runId), ids.slice(-12));
  assert.equal(overview.history.at(-1)?.runId, overview.report?.runId);
  assert.ok(overview.history.every(point => point.pass === 1 && point.needs_attention === 1 && point.unknown === 1 && point.total === 3));
  assert.ok(overview.history.every(point => point.agentStatus === 'disabled' && point.checkSet.includes('tests')));
  assert.deepEqual(db().prepare('SELECT state FROM audit_runs ORDER BY rowid').all(), before);
  assert.deepEqual(getOverview('unknown-owner').history, []);
});

test('history preserves zero check counts and records differing check scope without inventing a score', () => {
  const owner = 'history-scope-owner';
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const first = createRun(owner, repoUrl); complete(first.id);
  const second = createRun(owner, repoUrl); complete(second.id);
  updateRun(second.id, value => {
    value.report!.agentStatus = 'completed';
    value.report!.checks = [{ id: 'content', title: 'Content', category: '文档', status: 'unknown', summary: '', evidence: [], source: 'agent' }];
  });
  const history = getOverview(owner).history;
  assert.equal(history[0].total, 0);
  assert.equal(history[0].pass, 0);
  assert.equal(history[1].unknown, 1);
  assert.notEqual(history[0].checkSet, history[1].checkSet);
  assert.notEqual(history[0].agentStatus, history[1].agentStatus);
  assert.equal('score' in history[1], false);
});
