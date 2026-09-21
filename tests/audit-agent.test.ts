import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_LIMITS, analyzeWithAgent, createSnapshotTools, isAgentConfigured, validateAgentReport } from '../src/lib/audit/agent';
import type { RepoSnapshot } from '../src/lib/audit/types';
import type { AssistantMessage, Context, Model, Api, SimpleStreamOptions } from '@mariozechner/pi-ai';

const snapshot: RepoSnapshot = {
  repository: { owner: 'example', name: 'demo', fullName: 'example/demo', url: 'https://github.com/example/demo',
    description: '', branch: 'main', sha: '0123456789abcdef', language: 'TypeScript' },
  files: [
    { path: 'README.md', sha: 'readme' },
    { path: 'package.json', sha: 'package' },
    { path: 'CONTRIBUTING.md', sha: 'contributing' },
  ],
  contents: [
    { path: 'README.md', content: '# Demo\n安装：npm install\n验证：npm run test\n使用：npm run dev', truncated: false },
    { path: 'package.json', content: '{"scripts":{"dev":"next dev"}}', truncated: false },
    { path: 'CONTRIBUTING.md', content: '', truncated: false, error: 'unavailable' },
  ],
  warnings: [], treeTruncated: false,
};

const report = () => ({ checks: [{
  id: 'command-consistency', status: 'needs_attention', summary: 'README 提到 test 命令，但配置未定义该脚本。',
  evidence: [
    { path: 'README.md', excerpt: 'npm run test' },
    { path: 'package.json', excerpt: '{"scripts":{"dev":"next dev"}}' },
  ], suggestion: '补充测试脚本或修正文档中的验证命令。',
}] });

test('validates evidence and constructs commit-pinned links without trusting model URLs', () => {
  const result = validateAgentReport(JSON.stringify(report()), snapshot);
  assert.equal(result[0].id, 'agent-command-consistency');
  assert.equal(result[0].status, 'needs_attention');
  assert.equal(result[0].source, 'agent');
  assert.equal(result[0].evidence[0].url, 'https://github.com/example/demo/blob/0123456789abcdef/README.md');
});

test('rejects malformed schemas, duplicate IDs, model-supplied links and oversized output', () => {
  assert.throws(() => validateAgentReport('```json\n{}\n```', snapshot), /格式/);
  const duplicate = report();
  duplicate.checks.push(duplicate.checks[0]);
  assert.throws(() => validateAgentReport(JSON.stringify(duplicate), snapshot), /重复/);
  const external = report();
  Object.assign(external.checks[0].evidence[0], { url: 'https://untrusted.example' });
  assert.throws(() => validateAgentReport(JSON.stringify(external), snapshot), /格式/);
  assert.throws(() => validateAgentReport('x'.repeat(AGENT_LIMITS.outputChars + 1), snapshot), /长度/);
});

test('downgrades fabricated quotes, missing files and incomplete comparisons to unknown', () => {
  for (const evidence of [
    [{ path: 'README.md', excerpt: 'tests all passed' }],
    [{ path: '../../.env', excerpt: 'API_KEY' }],
    [{ path: 'README.md', excerpt: 'npm run test' }],
    [{ path: 'CONTRIBUTING.md', excerpt: 'unknown content' }],
    [],
  ]) {
    const output = report();
    output.checks[0].evidence = evidence;
    const result = validateAgentReport(JSON.stringify(output), snapshot)[0];
    assert.equal(result.status, 'unknown');
    assert.equal(result.suggestion, undefined);
    assert.match(result.summary, /证据不足|引用核验/);
  }
});

test('does not infer whole-file completeness from truncated content', () => {
  const truncated = structuredClone(snapshot);
  truncated.contents[0].truncated = true;
  const result = validateAgentReport(JSON.stringify(report()), truncated)[0];
  assert.equal(result.status, 'unknown');
  assert.match(result.summary, /截断/);
});

test('snapshot tools cannot read outside the snapshot or failed files and label repository text as untrusted', async () => {
  const tools = await createSnapshotTools(snapshot);
  const read = tools.find((tool) => tool.name === 'read_file')!;
  for (const path of ['../../.env', 'C:\\secrets', 'CONTRIBUTING.md', 'https://example.com']) {
    await assert.rejects(read.execute('test', { path }), /没有可读取/);
  }
  const data = await read.execute('test', { path: 'README.md' });
  assert.equal(data.content[0].type, 'text');
  if (data.content[0].type === 'text') assert.match(data.content[0].text, /untrustedRepositoryData/);
  const search = tools.find((tool) => tool.name === 'search_files')!;
  const matches = await search.execute('test', { query: 'npm run test' });
  if (matches.content[0].type === 'text') assert.match(matches.content[0].text, /README.md/);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(read.execute('test', { path: 'README.md' }, cancelled.signal), { name: 'AbortError' });
});

type FakeStep = (context: Context, options: SimpleStreamOptions | undefined, call: number) => AssistantMessage;

async function withFakeProvider(step: FakeStep, execute: () => Promise<void>) {
  const sdk = await import('@mariozechner/pi-ai');
  const model = sdk.getModels('deepseek')[0];
  assert.ok(model, 'test needs one built-in catalog model');
  const originalProvider = sdk.getApiProvider(model.api)!;
  const keys = ['REPOCARE_AI_PROVIDER', 'REPOCARE_AI_MODEL', 'REPOCARE_AI_API_KEY', 'REPOCARE_AI_BASE_URL'];
  const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.REPOCARE_AI_PROVIDER = model.provider;
  process.env.REPOCARE_AI_MODEL = model.id;
  process.env.REPOCARE_AI_API_KEY = 'test-only-secret';
  delete process.env.REPOCARE_AI_BASE_URL;
  let calls = 0;
  const stream = (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    assert.equal(options?.maxRetries, 0);
    assert.equal(options?.maxTokens, AGENT_LIMITS.maxTokens);
    assert.equal(options?.apiKey, 'test-only-secret');
    const response = step(context, options, ++calls);
    const events = sdk.createAssistantMessageEventStream();
    events.push({ type: 'start', partial: response });
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      events.push({ type: 'error', reason: response.stopReason, error: response });
    } else {
      events.push({ type: 'done', reason: response.stopReason, message: response });
    }
    events.end(response);
    return events;
  };
  sdk.registerApiProvider({ api: model.api, stream, streamSimple: stream });
  try { await execute(); } finally {
    sdk.registerApiProvider(originalProvider);
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function message(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return { role: 'assistant', content, stopReason, api: 'test', provider: 'test', model: 'test', timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

test('real pi Agent executes a snapshot tool and validates final JSON; progress excludes hidden reasoning', async () => {
  const updates: string[] = [];
  await withFakeProvider((context, _options, call) => {
    assert.match(context.systemPrompt ?? '', /不可信/);
    if (call === 1) return message([
      { type: 'thinking', thinking: 'private analysis must stay private' },
      { type: 'toolCall', id: 'read-1', name: 'read_file', arguments: { path: 'README.md' } },
    ], 'toolUse');
    assert.ok(context.messages.some((item) => item.role === 'toolResult' && item.toolName === 'read_file'));
    return message([{ type: 'text', text: JSON.stringify(report()) }], 'stop');
  }, async () => {
    const results = await analyzeWithAgent(snapshot, new AbortController().signal, (update) => updates.push(update));
    assert.equal(results[0].status, 'needs_attention');
    assert.ok(updates.some((update) => update.includes('读取快照文件')));
    assert.ok(updates.every((update) => !update.includes('private') && !update.includes('test-only-secret')));
  });
});

test('bounds automatic model turns instead of following an endless tool loop', async () => {
  let calls = 0;
  await withFakeProvider((_context, _options, call) => {
    calls = call;
    return message([{ type: 'toolCall', id: `list-${call}`, name: 'list_files', arguments: {} }], 'toolUse');
  }, async () => {
    await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), /轮数限制/);
    assert.equal(calls, AGENT_LIMITS.turns);
  });
});

test('bounds tool execution batches', async () => {
  await withFakeProvider(() => message(Array.from({ length: AGENT_LIMITS.toolCalls + 1 }, (_, index) => ({
    type: 'toolCall' as const, id: `list-${index}`, name: 'list_files', arguments: {},
  })), 'toolUse'), async () => {
    await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), /工具调用次数限制/);
  });
});

test('provider failure does not leak raw provider diagnostics or keys', async () => {
  await withFakeProvider(() => ({ ...message([], 'error'), errorMessage: 'test-only-secret private provider payload' }), async () => {
    await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Agent 服务未完成/);
      assert.doesNotMatch(error.message, /test-only-secret|private provider/);
      return true;
    });
  });
});

test('forwards cancellation during a model call', async () => {
  const controller = new AbortController();
  await withFakeProvider((_context, options) => {
    assert.equal(options?.signal?.aborted, false);
    queueMicrotask(() => controller.abort());
    return message([{ type: 'text', text: JSON.stringify(report()) }], 'stop');
  }, async () => {
    await assert.rejects(analyzeWithAgent(snapshot, controller.signal), { name: 'AbortError' });
  });
});

test('rejects non-HTTPS remote model endpoints before provider execution', async () => {
  await withFakeProvider(() => { throw new Error('provider should not be called'); }, async () => {
    for (const baseUrl of ['http://remote.example/v1', 'https://user:secret@remote.example/v1', 'https://remote.example/v1?key=secret']) {
      process.env.REPOCARE_AI_BASE_URL = baseUrl;
      await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), /服务地址/);
    }
  });
});

test('does not silently invent an unconfigured or unknown model', async () => {
  await withFakeProvider(() => message([], 'stop'), async () => {
    assert.equal(isAgentConfigured(), true);
    process.env.REPOCARE_AI_MODEL = 'nonexistent-test-model';
    await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), /模型目录/);
    delete process.env.REPOCARE_AI_API_KEY;
    assert.equal(isAgentConfigured(), false);
    await assert.rejects(analyzeWithAgent(snapshot, new AbortController().signal), /尚未配置/);
  });
});

test('honors caller cancellation before making any model request', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeWithAgent(snapshot, controller.signal), { name: 'AbortError' });
});
