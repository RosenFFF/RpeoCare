import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantMessage, Context, Model, Api, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { modelForConnection, testConnection, withModelTransport, validateModelEndpoint } from '../src/lib/models/adapter';
import type { RuntimeConnection } from '../src/lib/models/types';
const connection: RuntimeConnection = { id: 'test', revision: 1, name: 'test', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://provider.example/v1', modelId: 'alias-not-in-catalog', apiKey: 'private-test-key', contextWindow: 128000, maxTokens: 4096 };
function message(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return { role: 'assistant', content, stopReason, api: 'openai-completions', provider: 'custom', model: connection.modelId, timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
test('builds all supported custom protocols without requiring a catalog model', async () => {
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
    const model = await modelForConnection({ ...connection, protocol });
    assert.equal(model.api, protocol); assert.equal(model.id, connection.modelId); assert.equal(model.baseUrl, connection.baseUrl);
  }
  for (const url of ['http://remote.example', 'https://user:secret@provider.example', 'https://provider.example/v1/chat/completions', 'https://provider.example?key=secret']) assert.throws(() => validateModelEndpoint(url));
  assert.equal((await modelForConnection({ ...connection, baseUrl: 'http://127.0.0.1:8999/v1', apiKey: '' })).baseUrl, 'http://127.0.0.1:8999/v1');
});
test('connection probe requires a tool call and successful result round trip for each protocol', async () => {
  const sdk = await import('@mariozechner/pi-ai');
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
    const original = sdk.getApiProvider(protocol)!;
    let calls = 0; let fail = false;
    const stream = (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
      assert.equal(options?.apiKey, connection.apiKey);
      assert.equal(options?.maxRetries, 0);
      calls++;
      const response = fail ? message([{ type: 'text', text: 'REPOCARE_OK' }], 'stop') : calls === 1
        ? message([{ type: 'toolCall', id: 'probe', name: 'repocare_connection_check', arguments: { nonce: 'repocare-tool-check' } }], 'toolUse')
        : message([{ type: 'text', text: 'REPOCARE_OK' }], 'stop');
      if (!fail && calls === 2) assert.ok(context.messages.some(value => value.role === 'toolResult'));
      const events = sdk.createAssistantMessageEventStream();
      events.push({ type: 'done', reason: response.stopReason as 'stop' | 'toolUse', message: response }); events.end(response); return events;
    };
    sdk.registerApiProvider({ api: protocol, stream, streamSimple: stream });
    try {
      assert.equal((await testConnection({ ...connection, protocol })).ok, true);
      assert.equal(calls, 2);
      fail = true;
      const invalid = await testConnection({ ...connection, protocol });
      assert.equal(invalid.ok, false); assert.match(invalid.message, /工具调用/);
      const controller = new AbortController(); controller.abort();
      const before = calls;
      assert.equal((await testConnection({ ...connection, protocol }, controller.signal)).ok, false);
      assert.equal(calls, before);
    } finally { sdk.registerApiProvider(original); }
  }
});
test('transport blocks out-of-origin credentials and redirects without affecting unrelated fetches', async t => {
  const calls: { url: string; redirect?: RequestRedirect }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(input), redirect: init?.redirect }); return new Response('{}'); });
  const model = await modelForConnection(connection);
  await withModelTransport(model, async () => {
    await fetch(`${model.baseUrl}/chat/completions`);
    await assert.rejects(fetch('https://other.example/v1'), /配置地址之外/);
    await assert.rejects(fetch('https://provider.example/elsewhere'), /配置地址之外/);
  });
  await fetch('https://outside.example');
  assert.equal(calls.length, 2); assert.equal(calls[0].redirect, 'error'); assert.equal(calls[1].redirect, undefined);
});
