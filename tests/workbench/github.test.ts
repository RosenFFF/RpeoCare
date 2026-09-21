import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../../src/server/audit/store';
import { accountSession, saveGithubAccount, withGithubOwner } from '../../src/server/github/connection';
import { publishDraft, repositoryCounts } from '../../src/server/github/api';
import { getRepository } from '../../src/server/audit/github';
import type { Draft } from '../../src/contracts/workbench';

const directory = mkdtempSync(join(tmpdir(), 'repocare-github-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const draft: Draft = { id: 'draft-test', kind: 'file', repoUrl: 'https://github.com/example/project', path: 'README.md', title: 'docs', before: '', content: 'reviewed content', baseSha: 'a'.repeat(40), status: 'draft', revision: 1, createdAt: 'now' };

test('file publishing never updates default branch and refuses stale base', async t => {
  const owner = accountSession(saveGithubAccount('1', 'test', 'fake-token', true))!;
  const calls: { path: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string, init?: RequestInit) => {
    const path = String(input); calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path.endsWith('/repos/example/project')) return Response.json({ permissions: { push: true }, default_branch: 'main' });
    if (path.includes('/commits/main')) return Response.json({ sha: 'b'.repeat(40) });
    throw new Error('No mutation expected');
  });
  await assert.rejects(publishDraft(owner, draft), /已更新/);
  assert.ok(calls.every(call => call.body === null));
});
test('private repositories require user-scoped token; requested branch remains pinned', async t => {
  const owner = accountSession(saveGithubAccount('2', 'private-test', 'private-token', true))!;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string, init?: RequestInit) => {
    calls.push(String(input));
    if (String(input).includes('/commits?')) { assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-token'); return Response.json([{ sha: 'a'.repeat(40) }]); }
    return Response.json({ private: true, default_branch: 'main' });
  });
  await assert.rejects(getRepository(draft.repoUrl, new AbortController().signal), /仅支持公开/);
  const repo = await withGithubOwner(owner, () => getRepository(draft.repoUrl, new AbortController().signal, 'release/test'));
  assert.equal(repo.branch, 'release/test'); assert.ok(calls.some(path => path.includes('release%2Ftest')));
});

test('counts exclude PRs from Issues, handle pagination, and share the PR request', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string) => {
    calls.push(String(input));
    if (String(input).includes('/pulls?')) return Response.json([{}], { headers: { link: '<https://api.github.com/repos/example/project/pulls?state=open&per_page=1&page=42>; rel="last"' } });
    return Response.json({ open_issues_count: 50 });
  });
  const counts = await repositoryCounts('anonymous', draft.repoUrl);
  assert.equal(counts.issues, 8); assert.equal(counts.pulls, 42); assert.equal(calls.length, 2);
});
test('count failures stay unknown while a successful zero remains zero', async t => {
  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string) => String(input).includes('/pulls?') ? Response.json([]) : new Response('', { status: 403 }));
  const counts = await repositoryCounts('anonymous', draft.repoUrl);
  assert.equal(counts.issues, null); assert.equal(counts.pulls, 0); assert.ok(counts.issuesError);
});
test('failed PR count never presents the combined GitHub total as Issue count', async t => {
  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string) => String(input).includes('/pulls?') ? new Response('', { status: 503 }) : Response.json({ open_issues_count: 5 }));
  const counts = await repositoryCounts('anonymous', draft.repoUrl);
  assert.equal(counts.issues, null); assert.equal(counts.pulls, null);
});
