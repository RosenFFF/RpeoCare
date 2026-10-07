import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { db, listRuns, createRun, updateRun } from '../../src/server/audit/store';
import { accountSession, saveGithubAccount } from '../../src/server/github/connection';
import { githubApi } from '../../src/server/github/api';
import { listRepositories, repositoryQuery } from '../../src/server/github/repositories';
import { GET as repositories } from '../../src/app/api/workbench/repositories/route';
import { POST as connect } from '../../src/app/api/workbench/route';
import { GET as entry } from '../../src/app/workspace/route';
import { getProject, listDrafts, usage } from '../../src/server/workbench/store';

const directory = mkdtempSync(join(tmpdir(), 'repocare-repositories-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const cookie = saveGithubAccount('repo-picker', 'maintainer', 'test-repository-token', false);
const owner = accountSession(cookie)!;
const headers = { cookie: `repocare_login=${cookie}`, host: '127.0.0.1:3000' };
const row = { id: 42, full_name: 'maintainer/project', description: 'A project', private: false, fork: false, archived: false, owner: { login: 'maintainer' }, permissions: { admin: true, pull: true } };

test('repository listing requires a real GitHub login, not an anonymous owner cookie', async t => {
  let called = false;
  t.mock.method(globalThis, 'fetch', async () => { called = true; return Response.json([]); });
  for (const cookie of ['', `repocare_audit_session=${owner}`, 'repocare_login=invalid']) {
    assert.equal((await repositories(new NextRequest('http://localhost/api/workbench/repositories', { headers: { cookie } }))).status, 401);
  }
  assert.equal(called, false);
});
test('repository query bounds pages and rejects unknown parameters before calling GitHub', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json([]); });
  for (const query of ['page=0', 'page=-1', 'page=1001', 'page=1.5', 'affiliation=admin', 'per_page=999', 'url=https://evil.test']) {
    assert.equal((await repositories(new NextRequest(`http://localhost/api/workbench/repositories?${query}`, { headers }))).status, 400);
  }
  assert.equal(calls, 0);
});
test('read-only OAuth lists bounded public repositories with safe DTO and Link pagination', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com'); assert.equal(url.pathname, '/user/repos');
    assert.equal(url.searchParams.get('per_page'), '30'); assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('affiliation'), 'owner');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-repository-token');
    assert.equal(init?.method, 'GET');
    return Response.json([{ ...row, html_url: 'https://evil.test', secret: 'do-not-return', description: 'x'.repeat(900) }], { headers: { link: '<https://api.github.com/user/repos?page=3>; rel="next"' } });
  });
  const response = await repositories(new NextRequest('http://localhost/api/workbench/repositories?page=2', { headers }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json();
  assert.equal(value.hasMore, true); assert.equal(value.page, 2); assert.equal(value.privateAccessAuthorized, false);
  assert.equal(value.repositories[0].permission, 'admin'); assert.equal(value.repositories[0].owned, true);
  assert.equal(value.repositories[0].url, 'https://github.com/maintainer/project'); assert.equal(value.repositories[0].description.length, 500);
  assert.ok(!JSON.stringify(value).includes('do-not-return')); assert.ok(!JSON.stringify(value).includes('test-repository-token')); assert.equal(calls, 1);
});
test('collaborator/organization scope exposes private/fork/archive and unknown permissions honestly', async t => {
  const privateOwner = accountSession(saveGithubAccount('private-picker', 'member', 'test-private-token', true))!;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.equal(new URL(String(input)).searchParams.get('affiliation'), 'owner,collaborator,organization_member');
    return Response.json([{ ...row, full_name: 'org/project', owner: { login: 'org' }, private: true, fork: true, archived: true, permissions: undefined }]);
  });
  const result = await listRepositories(privateOwner, repositoryQuery.parse({ affiliation: 'all' }));
  assert.equal(result.hasMore, false); assert.equal(result.privateAccessAuthorized, true);
  assert.deepEqual(result.repositories[0], { id: 42, fullName: 'org/project', url: 'https://github.com/org/project', description: 'A project', private: true, fork: true, archived: true, owned: false, permission: 'unknown' });
});
test('upstream failures, malformed data, and oversize pages do not leak response contents', async t => {
  for (const response of [new Response('secret-upstream-body', { status: 403 }), Response.json({ message: 'secret-upstream-body' }), Response.json(Array.from({ length: 31 }, () => row)), Response.json([{ ...row, full_name: '../evil' }])]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    const result = await repositories(new NextRequest('http://localhost/api/workbench/repositories', { headers }));
    assert.equal(result.status, 502); assert.ok(!(await result.text()).includes('secret-upstream-body'));
  }
  await assert.rejects(githubApi(owner, '/user/repos/../tokens'), /路径不受支持/);
});
test('first GitHub login goes to chooser; selecting validates metadata and creates no audit, drafts, or model usage', async t => {
  const target = new URL(entry(new NextRequest('http://localhost:3000/workspace', { headers })).headers.get('location')!);
  assert.equal(target.pathname, '/projects'); assert.equal(target.host, '127.0.0.1:3000');
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url); assert.equal(init?.method || 'GET', 'GET');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-repository-token');
    if (url === 'https://api.github.com/repos/maintainer/project') return Response.json({ private: false, default_branch: 'main' });
    if (url === 'https://api.github.com/repos/maintainer/project/commits?sha=main&per_page=1') return Response.json([{ sha: 'a'.repeat(40) }]);
    throw new Error('Unexpected network request');
  });
  const response = await connect(new NextRequest('http://localhost:3000/api/workbench', { method: 'POST', headers: { ...headers, origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' }, body: JSON.stringify({ repoUrl: 'https://github.com/maintainer/project' }) }));
  assert.equal(response.status, 200); assert.equal(calls.length, 2);
  assert.equal(getProject(owner)?.fullName, row.full_name); assert.equal(listRuns(owner).length, 0); assert.equal(listDrafts(owner).length, 0); assert.equal(usage(owner).calls, 0);
  assert.equal(new URL(entry(new NextRequest('http://localhost:3000/workspace', { headers })).headers.get('location')!).pathname, '/overview');
  assert.equal(accountSession(saveGithubAccount('repo-picker', 'maintainer', 'refreshed-token', false)), owner);
});
test('failed connection preserves the current project and cross-origin selection is refused', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  const request = (origin: string) => new NextRequest('http://localhost:3000/api/workbench', { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json' }, body: JSON.stringify({ repoUrl: 'https://github.com/maintainer/missing' }) });
  assert.equal((await connect(request('http://127.0.0.1:3000'))).status, 400);
  assert.equal((await connect(request('https://evil.test'))).status, 400);
  assert.equal(getProject(owner)?.fullName, row.full_name);
});
test('selected project resumes active run and retains completed report on a later failure', () => {
  const run = createRun(owner, 'https://github.com/maintainer/project');
  let url = new URL(entry(new NextRequest('http://localhost:3000/workspace', { headers })).headers.get('location')!);
  assert.equal(url.pathname, '/audit'); assert.equal(url.searchParams.get('run'), run.id);
  updateRun(run.id, value => { value.status = 'completed'; value.report = { runId: run.id, repository: { owner: 'maintainer', name: 'project', fullName: row.full_name, url: 'https://github.com/maintainer/project', sha: 'a'.repeat(40), branch: 'main', description: '', language: null }, generatedAt: new Date().toISOString(), checks: [], warnings: [], agentStatus: 'disabled', scope: 'rules' }; });
  const failed = createRun(owner, 'https://github.com/maintainer/project'); updateRun(failed.id, value => { value.status = 'failed'; });
  url = new URL(entry(new NextRequest('http://localhost:3000/workspace', { headers })).headers.get('location')!);
  assert.equal(url.pathname, '/overview');
});
