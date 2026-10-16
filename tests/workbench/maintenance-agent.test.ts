import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import { db } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { recentModelFailures } from '../../src/server/models/request-diagnostics';
import { createTask, claimTask, getTask, saveClaim } from '../../src/server/agent/store';
import { executeMaintenance } from '../../src/server/agent/runtime';

const root = mkdtempSync(join(tmpdir(), 'repocare-agent-check-'));
process.env.REPOCARE_DB_PATH = join(root, 'test.sqlite');
after(() => { db().close(); rmSync(root, { recursive: true, force: true }); });

test('maintenance Agent reports output truncation and does not persist private reasoning', async () => {
  const owner = 'agent-check';
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 1024 });
  const task = createTask(owner, { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '准备修复补丁和需求对照' });
  const claim = claimTask('mock-worker'); assert.ok(claim); assert.equal(claim.task.id, task.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.budget.maxTurns = 2; saveClaim(claim);
  const sdk = await import('@mariozechner/pi-ai'), original = sdk.getApiProvider('openai-completions')!;
  const stream = () => {
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'custom', model: 'mock', stopReason: 'length', timestamp: Date.now(),
      content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING_MUST_NOT_PERSIST' }, { type: 'text', text: 'incomplete' }], usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = sdk.createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'length', message }); events.end(message); return events;
  };
  sdk.registerApiProvider({ api: 'openai-completions', stream, streamSimple: stream });
  try {
    await executeMaintenance(claim, new AbortController().signal);
    const saved = getTask(owner, task.id)!; assert.equal(saved.status, 'failed'); assert.match(saved.notice || '', /长度上限/); assert.equal(saved.artifacts.length, 0);
    assert.equal(recentModelFailures(owner)[0].category, 'truncated');
    const row = db().prepare('SELECT internal FROM maintenance_tasks WHERE id=?').get(task.id) as { internal: string };
    assert.ok(!row.internal.includes('PRIVATE_REASONING_MUST_NOT_PERSIST'));
  } finally { sdk.registerApiProvider(original); }
});
