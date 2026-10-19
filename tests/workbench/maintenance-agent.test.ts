import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import { db } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { recentModelFailures } from '../../src/server/models/request-diagnostics';
import { createTask, claimTask, getTask, mutateTask, saveClaim } from '../../src/server/agent/store';
import { executeMaintenance } from '../../src/server/agent/runtime';
import { checkedMaintenanceReport, deliveredDialogueIds } from '../../src/server/agent/report';

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

for (const lateFollowUp of [false, true]) test(`tool pipeline settles without duplicate requests; late follow-up=${lateFollowUp}`, async () => {
  const owner = `agent-tools-check-${lateFollowUp}`;
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 2048 });
  const task = createTask(owner, { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '修复并准备需求对照' });
  const claim = claimTask('tool-worker'); assert.ok(claim); assert.equal(claim.task.id, task.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.sourceUpdatedAt = '2026-10-16T00:00:00Z';
  claim.internal.cache = { visibility: 'public', item: JSON.stringify({ number: 1, body: 'Empty input must return zero.', updatedAt: claim.task.sourceUpdatedAt }),
    tree: JSON.stringify({ tree: [{ path: 'value.py', sha: 'b'.repeat(40), type: 'blob', mode: '100644', size: 40 }], occupied: ['value.py'], truncated: false }),
    [`blob:${'b'.repeat(40)}`]: 'def size(value):\n    return -1\n' }; saveClaim(claim);
  const sdk = await import('@mariozechner/pi-ai'), original = sdk.getApiProvider('openai-completions')!;
  let calls = 0;
  const stream = () => {
    calls++;
    if (calls === 5 && lateFollowUp) mutateTask(owner, task.id, 'message', '新的独立问题');
    const evidenceIds = claim.task.evidence.map(evidence => evidence.id);
    const tool = (name: string, args: unknown, index = 0) => ({ type: 'toolCall' as const, id: `${calls}-${index}`, name, arguments: args as Record<string, unknown> });
    const content: AssistantMessage['content'] = calls === 1 ? [tool('read_project_rules', {}, 0), tool('read_item', {}, 1), tool('read_file', { path: 'value.py' }, 2)]
      : calls === 2 ? [tool('propose_patch', { title: 'Empty input fix', evidenceIds, edits: [{ path: 'value.py', before: 'return -1', after: 'return 0 if value is None else len(value)' }] })]
        : calls === 3 ? [tool('propose_patch', { title: 'Add regression test', evidenceIds, edits: [{ path: 'tests/test_value.py', before: '', after: 'from value import size\ndef test_empty():\n    assert size(None) == 0, "EMPTY_EXPECTED"\n' }] })]
        : calls === 4 ? [tool('prepare_verification', { requirements: [{ text: 'Handle empty input', quote: 'Empty input must return zero.', command: 'python3 -m pytest tests/test_value.py::test_empty -q', failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }], regressionCommands: [] })]
          : [tool('submit_report', { summary: '补丁与对照已保存，等待核对执行。', findings: [], missingInformation: [], nextSteps: ['核对计划'] })];
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'custom', model: 'mock', stopReason: 'toolUse', timestamp: Date.now(), content,
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = sdk.createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'toolUse', message }); events.end(message); return events;
  };
  sdk.registerApiProvider({ api: 'openai-completions', stream, streamSimple: stream });
  try {
    await executeMaintenance(claim, new AbortController().signal);
    const saved = getTask(owner, task.id)!;
    assert.equal(saved.status, lateFollowUp ? 'queued' : 'awaiting-confirmation', JSON.stringify({ calls, notice: saved.notice, events: saved.events.slice(-8) })); assert.deepEqual(saved.artifacts.map(artifact => artifact.kind), ['patch', 'patch', 'verification']);
    assert.deepEqual(saved.artifacts.find(a => a.kind === 'patch' && !a.superseded)?.files?.map(file => file.path), ['tests/test_value.py', 'value.py']);
    assert.equal(calls, 5);
    const rows = db().prepare('SELECT status FROM reproduction_jobs WHERE owner=?').all(owner) as { status: string }[];
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.status === 'awaiting-confirmation'));
    const stored = db().prepare('SELECT internal FROM maintenance_tasks WHERE id=?').get(task.id) as { internal: string };
    assert.ok(JSON.parse(stored.internal).consumed.includes(saved.dialogue[0].id));
    if (lateFollowUp) { assert.ok(!JSON.parse(stored.internal).consumed.includes(saved.dialogue.find(message => message.content === '新的独立问题')!.id)); mutateTask(owner, task.id, 'cancel'); }
  } finally { sdk.registerApiProvider(original); }
});

test('final report remains callable within request and tool limits', async () => {
  const owner = 'report-budget';
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 2048 });
  const task = createTask(owner, { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '核对问题并保存阶段结论' });
  const claim = claimTask('budget-worker')!;
  assert.equal(claim.task.id, task.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.budget.maxTurns = 2; claim.task.budget.maxTools = 2;
  claim.internal.cache.item = JSON.stringify({ number: 1, body: 'A question to inspect.' }); saveClaim(claim);
  const sdk = await import('@mariozechner/pi-ai'), original = sdk.getApiProvider('openai-completions')!;
  let calls = 0, finalTools: string[] = [];
  const stream = (_model: unknown, context: { tools?: { name: string }[] }) => {
    calls++;
    if (calls === 2) finalTools = context.tools?.map(tool => tool.name) || [];
    const content = calls === 1 ? [{ type: 'toolCall' as const, id: 'read-one', name: 'read_item', arguments: {} }, { type: 'toolCall' as const, id: 'read-two', name: 'read_item', arguments: {} }]
      : [{ type: 'toolCall' as const, id: 'report-final', name: 'submit_report', arguments: { summary: '已读取问题，尚未完成源码调查或验证。', findings: [], missingInformation: [], scopeLimitations: ['本阶段预算有限，未完成调查。'], nextSteps: ['缩小目标后继续'] } }];
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'custom', model: 'mock', stopReason: 'toolUse', timestamp: Date.now(), content, usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = sdk.createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'toolUse', message }); events.end(message); return events;
  };
  sdk.registerApiProvider({ api: 'openai-completions', stream, streamSimple: stream });
  try {
    await executeMaintenance(claim, new AbortController().signal);
    const saved = getTask(owner, task.id)!;
    assert.deepEqual(finalTools, ['submit_report']); assert.equal(saved.status, 'completed'); assert.equal(saved.budget.turns, 2); assert.equal(saved.budget.tools, 2);
    assert.equal(saved.artifacts.length, 0); assert.match(saved.report!.summary, /尚未完成/);
  } finally { sdk.registerApiProvider(original); }
});

test('delivery recognizes SDK text blocks but never tool-result or unsubmitted user messages', () => {
  const injected = new Set(['one', 'two', 'three']);
  assert.deepEqual(deliveredDialogueIds([{ role: 'user', content: [{ type: 'text', text: '[message:one]' }] }, { role: 'user', content: '[message:two]' }, { role: 'toolResult', content: '[message:three]' }], injected), ['one', 'two']);
});

for (const correctReport of [true, false]) test(`report correction stays within the original budget; corrected=${correctReport}`, async () => {
  const owner = `report-recovery-${correctReport}`;
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 2048 });
  const task = createTask(owner, { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '核对问题并保存真实结论' });
  const claim = claimTask(`recovery-worker-${correctReport}`)!;
  assert.equal(claim.task.id, task.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.budget.maxTurns = 4; claim.task.budget.maxTools = 6;
  claim.internal.cache = { visibility: 'public', item: JSON.stringify({ number: 1, body: 'Inspect the selected input.' }),
    tree: JSON.stringify({ tree: [{ path: 'value.py', sha: 'b'.repeat(40), type: 'blob', mode: '100644', size: 10 }], occupied: ['value.py'], truncated: false }), [`blob:${'b'.repeat(40)}`]: 'VALUE = 1\n' };
  saveClaim(claim);
  const sdk = await import('@mariozechner/pi-ai'), original = sdk.getApiProvider('openai-completions')!;
  let calls = 0;
  const stream = (_model: unknown, context: { systemPrompt?: string; tools?: { name: string }[] }) => {
    calls++;
    const tool = (name: string, args: Record<string, unknown>, index = 0) => ({ type: 'toolCall' as const, id: `${calls}-${index}`, name, arguments: args });
    if (calls >= 3) assert.deepEqual(context.tools?.map(t => t.name), ['submit_report']);
    if (calls === 4) { assert.match(context.systemPrompt || '', /上次报告未通过/); assert.ok(context.systemPrompt?.includes(claim.task.evidence[0].id)); }
    const valid = calls === 4 && correctReport;
    const content: AssistantMessage['content'] = calls === 1 ? [tool('read_item', {}), tool('read_file', { path: 'value.py' }, 1)]
      : calls === 2 ? [tool('set_plan', { steps: ['保存阶段结论'] })]
        : [tool('submit_report', { summary: valid ? '已读取选定源码，未运行测试或生成补丁。' : 'UNVALIDATED_SUCCESS', findings: [{ title: '源码观察', detail: '仅观察已读取文件。', certainty: 'supported', evidenceIds: valid ? [claim.task.evidence[0].id] : [claim.task.evidence[0].id.slice(0, -1)] }], missingInformation: [], nextSteps: [] })];
    const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'custom', model: 'mock', stopReason: 'toolUse', timestamp: Date.now(), content, usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const events = sdk.createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'toolUse', message }); events.end(message); return events;
  };
  sdk.registerApiProvider({ api: 'openai-completions', stream, streamSimple: stream });
  try {
    await executeMaintenance(claim, new AbortController().signal);
    const saved = getTask(owner, task.id)!;
    assert.equal(calls, 4); assert.equal(saved.budget.turns, 4); assert.ok(saved.budget.tools <= 6);
    assert.equal(saved.artifacts.length, 0);
    if (correctReport) { assert.equal(saved.status, 'completed'); assert.match(saved.report!.summary, /未运行测试/); }
    else { assert.equal(saved.status, 'paused'); assert.equal(saved.report, undefined); assert.match(saved.notice || '', /系统阶段记录.*未通过/); assert.ok(saved.dialogue.some(m => m.content.startsWith('系统阶段记录'))); }
    assert.ok(!JSON.stringify({ report: saved.report, notice: saved.notice, dialogue: saved.dialogue }).includes('UNVALIDATED_SUCCESS'));
  } finally { sdk.registerApiProvider(original); }
});

test('report validation rejects artifact IDs and permits honest delivery summaries without findings', () => {
  const task = { evidence: [{ id: 'Eknown' }] } as Parameters<typeof checkedMaintenanceReport>[1];
  const report = { summary: '待核对', findings: [], missingInformation: [], nextSteps: [] };
  assert.equal(checkedMaintenanceReport(report, task).summary, '待核对');
  assert.throws(() => checkedMaintenanceReport({ ...report, findings: [{ title: '原文', detail: '引用', certainty: 'supported', evidenceIds: ['artifact-uuid'] }] }, task), /UUID/);
  assert.throws(() => checkedMaintenanceReport({ ...report, findings: [{ title: '原文', detail: '引用', certainty: 'supported', evidenceIds: ['Eknow'] }] }, task), /当前证据编号/);
});
