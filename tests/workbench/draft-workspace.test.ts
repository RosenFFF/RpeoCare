import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { db, createRun, updateRun } from '../../src/server/audit/store';
import { createDraft, getDraft, saveProject, updateDraft, updateDraftBatch, draftVersions, listDrafts, previousDraft, saveSnapshot } from '../../src/server/workbench/store';
import { accountSession, saveGithubAccount } from '../../src/server/github/connection';
import { GET, POST } from '../../src/app/api/workbench/drafts/route';
import { draftDiff } from '../../src/shared/lib/draft-diff';
import { inspectDraft } from '../../src/shared/lib/draft-quality';
import { qualityContext } from '../../src/server/workbench/draft-quality';
import { checkPublication } from '../../src/server/workbench/draft-publication';
import { fileDraft } from '../../src/server/workbench/drafts';
import { queryDrafts } from '../../src/server/workbench/draft-list';
import type { Draft } from '../../src/contracts/workbench';

const directory = mkdtempSync(join(tmpdir(), 'repocare-draft-upgrade-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const repoUrl = 'https://github.com/example/project', sha = 'a'.repeat(40);
const cookie = saveGithubAccount('draft-upgrade', 'example', 'fake-draft-token', true), owner = accountSession(cookie)!;
saveProject(owner, { repoUrl, fullName: 'example/project' });
const input = (path = 'README.md'): Omit<Draft, 'id' | 'revision' | 'status' | 'createdAt'> => ({ kind: 'file', repoUrl, path, branch: 'main', baseSha: sha, title: `docs: improve ${path}`, before: '# Hello\n', content: '# Hello\n\nNew content.\n' });
const request = (body: unknown) => new NextRequest('http://localhost/api/workbench/drafts', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie: `repocare_login=${cookie}` }, body: JSON.stringify(body) });

test('draft search and grouping happen before pagination and preserve account, repo and branch boundaries', () => {
  const scope = 'draft-search-owner';
  const first = createDraft(scope, { ...input(), title: '中文针点 100% literal' });
  for (let i = 0; i < 105; i++) createDraft(scope, { ...input(`docs/${i}.md`), title: `document ${i}` });
  createDraft('other', { ...input(), title: first.title });
  createDraft(scope, { ...input(), repoUrl: repoUrl + '-other', title: first.title });
  const options = { offset: 0, category: 'all', status: 'active', query: '', grouped: true };
  const match = queryDrafts(scope, repoUrl, { ...options, query: '中文针点 100%' });
  assert.deepEqual(match.drafts.map(row => row.id), [first.id]); assert.equal(match.total, 1); assert.equal(match.projectTotal, 106);
  const latest = createDraft(scope, input());
  const dev = createDraft(scope, { ...input(), branch: 'dev' });
  const grouped = queryDrafts(scope, repoUrl, { ...options, query: 'README.md' });
  assert.equal(grouped.total, 2); assert.equal(grouped.siblingCounts[latest.id], 2); assert.ok(grouped.drafts.some(row => row.id === dev.id));
  assert.equal(queryDrafts(scope, repoUrl, { ...options, query: 'README.md', grouped: false }).total, 3);
  const page = queryDrafts(scope, repoUrl, options); assert.equal(page.drafts.length, 100); assert.equal(page.hasNext, true);
  const last = queryDrafts(scope, repoUrl, { ...options, offset: 10000 }); assert.equal(last.offset, 100); assert.equal(last.hasNext, false);
});

test('uncertain filter includes expired publication leases; archived records use their own filter', async () => {
  const scope = 'draft-filter-owner';
  const pending = createDraft(scope, input()); updateDraft(scope, pending.id, 1, { status: 'publishing' });
  const archived = createDraft(scope, { ...input('CONTRIBUTING.md'), archived: true });
  const options = { offset: 0, category: 'file', status: 'uncertain', query: '', grouped: false };
  const found = queryDrafts(scope, repoUrl, options);
  assert.equal(found.total, 1); assert.equal(found.drafts[0].status, 'uncertain');
  assert.equal(queryDrafts(scope, repoUrl, { ...options, status: 'archived' }).drafts[0].id, archived.id);
  assert.equal(queryDrafts(scope, repoUrl, { ...options, status: 'active' }).total, 1);
  const invalid = await GET(new NextRequest('http://localhost/api/workbench/drafts?category=invalid', { headers: { cookie: `repocare_login=${cookie}` } }));
  assert.equal(invalid.status, 400);
});

test('true diff counts equal-length replacements and preserves line numbers/CRLF', () => {
  const diff = draftDiff('hello\r\nnpm install\r\n', 'hello\nnpm ci\n');
  assert.equal(diff.additions, 1); assert.equal(diff.deletions, 1);
  assert.deepEqual(diff.rows.map(row => [row.type, row.oldLine, row.newLine]), [['same',1,1],['remove',2,null],['add',null,2]]);
  assert.equal(draftDiff('', 'new').additions, 1); assert.equal(draftDiff('same', 'same').additions, 0);
});
test('quality checks distinguish static evidence, unknown context and never execute commands', () => {
  const result = inspectDraft('# New\n[Tutorial](docs/missing.md)\n[External](https://example.org)\nTODO\nnpm run invented\n', '# Original\nCopyright', 'README.md', { paths: ['README.md'], pathsComplete: true, scripts: ['test'], scriptsKnown: true });
  for (const code of ['relative-link','external-link','placeholder','command','removed-heading','license','execution']) assert.ok(result.some(item => item.code === code), code);
  assert.ok(!result.some(item => item.level === 'blocker'));
  const unknown = inspectDraft('[Relative](guide.md)\nnpm run test', '', 'README.md');
  assert.ok(unknown.filter(item => ['relative-link','command'].includes(item.code)).every(item => item.level === 'info'));
  const safe = inspectDraft('[Guide](../guide.md)', '', 'docs/readme.md', { paths: ['guide.md'], pathsComplete: true, scripts: [], scriptsKnown: true });
  assert.ok(!safe.some(item => item.code === 'relative-link'));
});
test('quality blocks empty, oversize, dangerous schemes and credential patterns without exposing secrets', () => {
  assert.ok(inspectDraft('', '', undefined).some(item => item.level === 'blocker'));
  assert.ok(inspectDraft('x'.repeat(30001), '', undefined).some(item => item.code === 'size'));
  const content = '[bad](javascript:alert)\n' + 'ghp_' + 'x'.repeat(25);
  const result = inspectDraft(content, '', undefined);
  assert.ok(result.some(item => item.code === 'secret')); assert.ok(result.some(item => item.code === 'unsafe-link'));
  assert.ok(!JSON.stringify(result).includes('x'.repeat(25)));
});
test('edits retain history and atomic batch revision failures roll back all drafts', () => {
  const one = createDraft(owner, input()), two = createDraft(owner, input('CONTRIBUTING.md'));
  const edit = updateDraft(owner, one.id, 1, { content: '# Edited' });
  assert.equal(draftVersions(owner, one.id)[1].content, one.content);
  assert.throws(() => updateDraftBatch(owner, [{ id: one.id, revision: edit.revision, change: { status: 'publishing' } }, { id: two.id, revision: 9, change: { status: 'publishing' } }]), /已变化/);
  assert.equal(getDraft(owner, one.id).status, 'draft'); assert.equal(getDraft(owner, one.id).revision, 2);
  assert.throws(() => draftVersions('other-owner', one.id), /不属于/);
  assert.equal(previousDraft(owner, repoUrl, 'file', 'README.md', undefined, 'main')?.id, one.id);
});
test('project filtering happens before pagination; archived drafts remain recoverable', async () => {
  const retained = createDraft(owner, input());
  for (let index=0; index<101; index++) createDraft(owner, { ...input(), repoUrl: 'https://github.com/other/project' });
  assert.ok(listDrafts(owner, repoUrl).some(draft => draft.id === retained.id));
  const archived = await POST(request({ action: 'archive', id: retained.id, revision: 1, archived: true }));
  assert.equal(archived.status, 200); assert.equal(getDraft(owner, retained.id).archived, true);
  const restored = await POST(request({ action: 'archive', id: retained.id, revision: 2, archived: false }));
  assert.equal(restored.status, 200);
  const foreign = createDraft('other-owner', input());
  const get = await GET(new NextRequest(`http://localhost/api/workbench/drafts?id=${foreign.id}`, { headers: { cookie: `repocare_login=${cookie}` } }));
  assert.equal(get.status, 400);
});
test('restore copies historical content into a new revision without mutating history', async () => {
  const draft = createDraft(owner, input()); updateDraft(owner, draft.id, 1, { content: '# Changed' });
  const result = await POST(request({ action: 'restore', id: draft.id, revision: 2, version: 1 }));
  assert.equal(result.status, 200); assert.equal(getDraft(owner, draft.id).revision, 3); assert.equal(getDraft(owner, draft.id).content, draft.content);
  assert.equal(draftVersions(owner, draft.id)[1].content, '# Changed');
});
test('multi-file publication uses one tree, one branch, one Draft PR with atomic saved results', async t => {
  const one = createDraft(owner, input()), two = createDraft(owner, input('CONTRIBUTING.md'));
  const writes: { url: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const value = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body) writes.push({ url: value, body });
    if (value.endsWith('/repos/example/project')) return Response.json({ permissions: { push: true }, default_branch: 'main' });
    if (value.endsWith('/commits/main')) return Response.json({ sha, commit: { tree: { sha: 'tree-sha' } } });
    if (value.endsWith('/pulls')) return Response.json({ html_url: repoUrl + '/pull/99' });
    return Response.json({ sha: 'generated-sha' });
  });
  const body = { action: 'publish-batch', drafts: [{ id: one.id, revision: 1 }, { id: two.id, revision: 1 }], confirmed: true };
  const result = await POST(request(body)); assert.equal(result.status, 200);
  assert.equal(writes.filter(row => row.url.endsWith('/git/trees')).length, 1);
  assert.equal(writes.find(row => row.url.endsWith('/git/trees'))?.body.tree.length, 2);
  assert.equal(writes.filter(row => row.url.endsWith('/pulls')).length, 1);
  assert.equal(writes.find(row => row.url.endsWith('/pulls'))?.body.draft, true);
  assert.ok(!writes.some(row => row.body.ref === 'refs/heads/main'));
  assert.equal(getDraft(owner, one.id).publishedUrl, getDraft(owner, two.id).publishedUrl);
  assert.equal((await POST(request(body))).status, 400);
});
test('mixed baselines, paths, stale revisions and quality blockers are refused before writes', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected network'); });
  const one = createDraft(owner, input()), mixed = createDraft(owner, { ...input('CONTRIBUTING.md'), baseSha: 'b'.repeat(40) }), duplicate = createDraft(owner, input());
  for (const two of [mixed, duplicate]) {
    assert.equal((await POST(request({ action: 'publish-batch', drafts: [{ id: one.id, revision: 1 }, { id: two.id, revision: 1 }], confirmed: true }))).status, 400);
    assert.equal(getDraft(owner, one.id).status, 'draft');
  }
  const unsafe = createDraft(owner, { ...input(), content: 'ghp_' + 'x'.repeat(25) });
  assert.equal((await POST(request({ action: 'publish', id: unsafe.id, revision: 1, confirmed: true }))).status, 400);
  assert.equal(calls, 0);
});
test('mid-publication failure marks entire batch uncertain, while stale base restores drafts', async t => {
  const run = async (stale: boolean) => {
    const one = createDraft(owner, input()), two = createDraft(owner, input('CONTRIBUTING.md'));
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith('/repos/example/project')) return Response.json({ permissions: { push: true }, default_branch: 'main' });
      if (value.endsWith('/commits/main')) return Response.json({ sha: stale ? 'b'.repeat(40) : sha, commit: { tree: { sha: 'tree' } } });
      throw new Error('Simulated network failure after remote writes may have happened');
    });
    assert.equal((await POST(request({ action: 'publish-batch', drafts: [{ id: one.id, revision: 1 }, { id: two.id, revision: 1 }], confirmed: true }))).status, 400);
    assert.equal(getDraft(owner, one.id).status, stale ? 'draft' : 'uncertain'); assert.equal(getDraft(owner, two.id).status, stale ? 'draft' : 'uncertain');
  };
  await run(false); await run(true);
});
test('publication status is read-only and merge is not verification until an including report passes', async t => {
  const draft = { ...createDraft(owner, input()), publishedUrl: repoUrl + '/pull/99' };
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => { assert.equal(init?.method, 'GET'); return Response.json({ state: 'closed', merged: true, merge_commit_sha: 'b'.repeat(40), head: { ref: `repocare/${draft.id}`, repo: { html_url: repoUrl } } }); });
  const result = await checkPublication(owner, draft);
  assert.equal(result.state, 'merged'); assert.equal(result.verification, 'not-verified');
});
test('quality context requires owned matching snapshot and generation rejects other branches before model calls', async () => {
  const run = createRun(owner, repoUrl, undefined, undefined, 'feature');
  const repository = { owner: 'example', name: 'project', fullName: 'example/project', url: repoUrl, branch: 'feature', sha, description: '', language: null };
  updateRun(run.id, state => { state.status = 'completed'; state.repository = repository; state.report = { runId: run.id, repository, generatedAt: 'now', checks: [{ id: 'readme', title: 'README', category: '文档', source: 'rule', status: 'needs_attention', summary: 'missing', evidence: [] }], warnings: [], agentStatus: 'disabled', scope: 'rules' }; });
  saveSnapshot(run.id, { repository, files: [{ path: 'README.md', sha }, { path: 'package.json', sha }], treeTruncated: false, warnings: [], contents: [{ path: 'package.json', content: '{"scripts":{"test":"node test.js"}}', truncated: false }] });
  const draft = { ...createDraft(owner, input()), runId: run.id };
  assert.equal(qualityContext('other-owner', draft), undefined); assert.equal(qualityContext(owner, draft)?.scriptsKnown, true);
  await assert.rejects(fileDraft(owner, run.id, 'readme'), /原文件未完整读取|当前项目/);
});
test('merged publication only becomes verified with descendant report and matching passing check', async t => {
  const mergeSha = 'b'.repeat(40), afterSha = 'c'.repeat(40);
  const run = createRun(owner, repoUrl);
  const repository = { owner: 'example', name: 'project', fullName: 'example/project', url: repoUrl, branch: 'main', sha: afterSha, description: '', language: null };
  updateRun(run.id, value => { value.status = 'completed'; value.repository = repository; value.report = { runId: run.id, repository, generatedAt: 'now', checks: [{ id: 'readme', title: 'README', category: '文档', source: 'rule', status: 'pass', summary: 'present', evidence: [] }], warnings: [], agentStatus: 'disabled', scope: 'rules' }; });
  const draft = { ...createDraft(owner, input()), publishedUrl: repoUrl + '/pull/100', source: { type: 'audit-check' as const, runId: run.id, checkId: 'readme', checkTitle: 'README', evidence: [] } };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET'); calls.push(String(url));
    if (String(url).includes('/compare/')) return Response.json({ status: 'ahead' });
    return Response.json({ state: 'closed', merged: true, merge_commit_sha: mergeSha, head: { ref: `repocare/${draft.id}`, repo: { html_url: repoUrl } } });
  });
  const checked = await checkPublication(owner, draft);
  assert.equal(checked.verification, 'passed'); assert.equal(checked.verificationRunId, run.id); assert.equal(calls.length, 2);
});
test('unknown publication recovery discovers only matching branch and never marks uncertain content published', async t => {
  const draft = createDraft(owner, input()); updateDraft(owner, draft.id, 1, { status: 'uncertain', publication: { branch: `repocare/${draft.id}` } });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET');
    if (String(url).includes('?state=all')) return Response.json([{ number: 110, head: { ref: `repocare/${draft.id}`, repo: { html_url: repoUrl } } }]);
    return Response.json({ state: 'open', merged: false, head: { ref: `repocare/${draft.id}`, repo: { html_url: repoUrl } } });
  });
  const result = await POST(request({ action: 'check-publication', id: draft.id, revision: 2 }));
  assert.equal(result.status, 200); assert.equal(getDraft(owner, draft.id).status, 'uncertain'); assert.equal(getDraft(owner, draft.id).publication?.url, repoUrl + '/pull/110');
});
test('draft listing uses current branch successful report beyond latest run pagination', async () => {
  const reportRun = createRun(owner, repoUrl);
  const repository = { owner: 'example', name: 'project', fullName: 'example/project', url: repoUrl, branch: 'main', sha, description: '', language: null };
  updateRun(reportRun.id, value => { value.status = 'completed'; value.repository = repository; value.report = { runId: reportRun.id, repository, generatedAt: 'now', checks: [], warnings: [], agentStatus: 'disabled', scope: 'rules' }; });
  for (let index=0; index<21; index++) { const failed=createRun(owner, repoUrl); updateRun(failed.id,value=>{value.status='failed';}); }
  const response = await GET(new NextRequest('http://localhost/api/workbench/drafts', { headers: { cookie: `repocare_login=${cookie}` } }));
  assert.equal((await response.json()).report.runId, reportRun.id);
  const feature = createRun(owner, repoUrl, undefined, undefined, 'feature');
  updateRun(feature.id, value => { value.status='completed'; value.report={ runId:feature.id, repository:{...repository,branch:'feature'}, generatedAt:'now', checks:[],warnings:[],agentStatus:'disabled',scope:'rules' }; });
  const again=await GET(new NextRequest('http://localhost/api/workbench/drafts', { headers: { cookie: `repocare_login=${cookie}` } }));
  assert.equal((await again.json()).report.runId, reportRun.id);
});
test('comment status checks read the actual comment and refuse changed or unknown content', async t => {
  const draft = { ...createDraft(owner, { ...input(), kind: 'issue', number: 42, path: undefined }), publishedUrl: repoUrl + '/issues/42#issuecomment-123' };
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => { assert.equal(String(url), 'https://api.github.com/repos/example/project/issues/comments/123'); assert.equal(init?.method, 'GET'); return Response.json({ html_url: draft.publishedUrl, body: draft.content }); });
  assert.equal((await checkPublication(owner, draft)).state, 'comment');
  await assert.rejects(checkPublication(owner, { ...draft, publishedUrl: undefined }), /无法自动确认/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ html_url: draft.publishedUrl, body: 'changed content' }));
  await assert.rejects(checkPublication(owner, draft), /已变化/);
});
