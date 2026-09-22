import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import { NextRequest } from 'next/server';
import { db, createRun, updateRun } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { saveSnapshot, getDraft } from '../../src/server/workbench/store';
import { POST as drafts } from '../../src/app/api/workbench/drafts/route';
import { accountSession, saveGithubAccount } from '../../src/server/github/connection';
import type { RepoSnapshot } from '../../src/contracts/audit';

const directory = mkdtempSync(join(tmpdir(), 'repocare-flow-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

test('report draft and explicit publish form a persistent isolated flow', async t => {
  const token = saveGithubAccount('flow-owner', 'flow', 'test-token', true), owner = accountSession(token)!;
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock-secret', keyAction: 'replace', contextWindow: 128000, maxTokens: 4096 });
  const sha = 'a'.repeat(40), repoUrl = 'https://github.com/example/project';
  const snapshot: RepoSnapshot = { repository: { owner: 'example', name: 'project', fullName: 'example/project', url: repoUrl, description: '', branch: 'main', sha, language: null }, files: [], treeTruncated: false, contents: [], warnings: [] };
  const run = createRun(owner, repoUrl);
  updateRun(run.id, state => { state.status = 'completed'; state.repository = snapshot.repository; state.report = { runId: run.id, repository: snapshot.repository, generatedAt: 'now', checks: [{ id: 'contributing', title: '贡献指南', category: '协作', source: 'rule', status: 'needs_attention', summary: '未找到贡献指南', evidence: [] }], warnings: [], agentStatus: 'disabled', scope: 'test' }; });
  saveSnapshot(run.id, snapshot);
  const sdk = await import('@mariozechner/pi-ai'), original = sdk.getApiProvider('openai-completions')!;
  const stream = () => {
    const result: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'custom', model: 'mock', stopReason: 'stop', timestamp: Date.now(), content: [{ type: 'text', text: '# 贡献指南\n请先讨论修改目标。' }], usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = sdk.createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'stop', message: result }); events.end(result); return events;
  };
  sdk.registerApiProvider({ api: 'openai-completions', stream, streamSimple: stream });
  const request = (path: string, body: unknown, cookie = token) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie: `repocare_login=${cookie}` }, body: JSON.stringify(body) });
  try {
    const response = await drafts(request('/api/workbench/drafts', { action: 'file', runId: run.id, checkId: 'contributing' }));
    assert.equal(response.status, 200); const { draft } = await response.json();
    assert.equal(draft.status, 'draft'); assert.equal(draft.path, 'CONTRIBUTING.md');
    assert.deepEqual(draft.source, { type: 'audit-check', runId: run.id, checkId: 'contributing', checkTitle: '贡献指南', evidence: [] });
    assert.equal((await drafts(request('/api/workbench/drafts', { action: 'publish', id: draft.id, revision: 1, confirmed: false }))).status, 400);
    const calls: { url: string; body: any }[] = [];
    t.mock.method(globalThis, 'fetch', async (input: URL | Request | string, init?: RequestInit) => {
      const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null; calls.push({ url, body });
      if (url.endsWith('/repos/example/project')) return Response.json({ permissions: { push: true }, default_branch: 'main' });
      if (url.endsWith('/commits/main')) return Response.json({ sha, commit: { tree: { sha: 'tree' } } });
      if (url.endsWith('/pulls')) return Response.json({ html_url: 'https://github.com/example/project/pull/1' });
      return Response.json({ sha: 'new-sha' });
    });
    const published = await drafts(request('/api/workbench/drafts', { action: 'publish', id: draft.id, revision: 1, confirmed: true }));
    assert.equal(published.status, 200); assert.equal(getDraft(owner, draft.id).status, 'published');
    assert.ok(calls.some(call => call.body?.ref === `refs/heads/repocare/${draft.id}`));
    assert.ok(!calls.some(call => call.body?.ref === 'refs/heads/main'));
    const before = calls.length;
    assert.equal((await drafts(request('/api/workbench/drafts', { action: 'publish', id: draft.id, revision: 1, confirmed: true }))).status, 400);
    assert.equal(calls.length, before);
  } finally { sdk.registerApiProvider(original); }
});
