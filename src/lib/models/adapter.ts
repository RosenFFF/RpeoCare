import { AsyncLocalStorage } from 'node:async_hooks';
import type { Api, Context, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { protocols, type CatalogModel, type ConnectionTestResult, type ModelProtocol, type RuntimeConnection } from './types';

// Server-only: the adapter is shared by the connection probe and the audit worker.
const TEST_TIMEOUT_MS = 25_000;
const probeTool = 'repocare_connection_check';
const probeNonce = 'repocare-tool-check';

export function validateModelEndpoint(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('模型服务地址不是有效的 URL。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('模型服务地址须使用 HTTPS（本机可用 HTTP），且不能包含凭据、查询参数或片段。');
  }
  if (/\/(chat\/completions|responses|messages)\/?$/i.test(url.pathname)) {
    throw new Error('请填写模型服务的基础地址，不要包含 chat/completions、responses 或 messages 请求路径。');
  }
  return url.toString().replace(/\/+$/, '');
}

/** Legacy server configuration remains available when no saved connection is selected. */
export function environmentConnection(): RuntimeConnection | null {
  const provider = process.env.REPOCARE_AI_PROVIDER?.trim();
  const modelId = process.env.REPOCARE_AI_MODEL?.trim();
  const apiKey = process.env.REPOCARE_AI_API_KEY?.trim();
  if (!provider || !modelId || !apiKey) return null;
  const protocol = process.env.REPOCARE_AI_PROTOCOL?.trim()
    || (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions');
  return {
    id: 'environment', revision: 1, name: '环境变量连接', provider,
    protocol: protocol as ModelProtocol, modelId, apiKey,
    baseUrl: process.env.REPOCARE_AI_BASE_URL?.trim() || '',
    contextWindow: 128_000, maxTokens: 4_096,
  };
}

export async function getCatalog(): Promise<CatalogModel[]> {
  const { getProviders, getModels } = await import('@mariozechner/pi-ai');
  return getProviders().flatMap((provider) => getModels(provider)
    .filter((model) => protocols.some((protocol) => protocol === model.api))
    .map((model) => ({ id: model.id, name: model.name, provider: model.provider,
      protocol: model.api as ModelProtocol, contextWindow: model.contextWindow, maxTokens: model.maxTokens })));
}

export const getModelCatalog = getCatalog;

/** Build explicit models: a middleman/model alias never has to exist in the SDK catalog. */
export async function modelForConnection(connection: RuntimeConnection): Promise<Model<Api>> {
  if (!protocols.includes(connection.protocol)) throw new Error('请选择受支持的模型接口协议。');
  if (!connection.modelId.trim() || !connection.provider.trim()) throw new Error('请填写服务商标识和模型 ID。');
  const localEndpoint = connection.baseUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(validateModelEndpoint(connection.baseUrl)).hostname);
  if (!connection.apiKey.trim() && !localEndpoint) throw new Error('尚未配置模型 API 密钥。');
  if (!Number.isInteger(connection.contextWindow) || connection.contextWindow < 4_096
    || !Number.isInteger(connection.maxTokens) || connection.maxTokens < 256
    || connection.maxTokens > connection.contextWindow) throw new Error('模型上下文与输出长度设置不正确。');

  const { getProviders, getModels } = await import('@mariozechner/pi-ai');
  const provider = getProviders().find((item) => item === connection.provider);
  const catalogModel = provider ? getModels(provider).find((model) => model.id === connection.modelId) : undefined;
  const baseUrl = connection.baseUrl.trim() || catalogModel?.baseUrl;
  if (!baseUrl) throw new Error('该模型不在内置模型目录中，请填写自定义模型的服务基础地址。');
  const endpoint = validateModelEndpoint(baseUrl);
  // Preserve catalog compatibility only for the exact built-in protocol AND endpoint.
  const builtin = catalogModel?.api === connection.protocol && validateModelEndpoint(catalogModel.baseUrl) === endpoint
    ? catalogModel : undefined;
  const common = {
    id: connection.modelId.trim(), name: catalogModel?.name ?? connection.modelId.trim(),
    provider: connection.provider.trim(), baseUrl: endpoint,
    reasoning: builtin?.reasoning ?? false, input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: connection.contextWindow, maxTokens: connection.maxTokens,
  };
  if (connection.protocol === 'openai-completions') {
    const compat = builtin?.api === 'openai-completions' ? builtin.compat : {
      supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      supportsUsageInStreaming: false, supportsStrictMode: false, maxTokensField: 'max_tokens' as const,
    };
    return { ...common, api: 'openai-completions', compat };
  }
  if (connection.protocol === 'openai-responses') {
    return { ...common, api: 'openai-responses', compat: { sendSessionIdHeader: false, supportsLongCacheRetention: false } };
  }
  return { ...common, api: 'anthropic-messages', compat: {
    supportsEagerToolInputStreaming: false, supportsLongCacheRetention: false,
  } };
}

interface TransportScope { endpoint: URL }
interface TransportState { context: AsyncLocalStorage<TransportScope>; wrappers: WeakSet<typeof fetch> }
const transportKey = Symbol.for('repocare.model.transport');
const transportGlobal = globalThis as typeof globalThis & { [transportKey]?: TransportState };
const transport = transportGlobal[transportKey] ??= { context: new AsyncLocalStorage<TransportScope>(), wrappers: new WeakSet() };

/**
 * pi-ai 0.73 exposes no fetch option. Install a context-aware guard once, without
 * replacing provider registries or changing requests outside model execution.
 * AsyncLocalStorage keeps concurrent users' endpoints isolated. Fetch itself
 * rejects redirects, before any Authorization/x-api-key can leave this origin.
 */
export function withModelTransport<T>(model: Model<Api>, operation: () => T): T {
  if (!transport.wrappers.has(globalThis.fetch)) {
    const upstream = globalThis.fetch;
    const guarded: typeof fetch = (input, init) => {
      const scope = transport.context.getStore();
      if (!scope) return upstream(input, init);
      let target: URL;
      try { target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); }
      catch { return Promise.reject(new Error('模型接口请求地址无效。')); }
      const basePath = scope.endpoint.pathname.replace(/\/+$/, '');
      if (target.origin !== scope.endpoint.origin || target.username || target.password
        || (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`))) {
        return Promise.reject(new Error('模型接口试图访问配置地址之外的资源，已阻止请求。'));
      }
      return upstream(input, { ...init, redirect: 'error' });
    };
    transport.wrappers.add(guarded);
    globalThis.fetch = guarded;
  }
  return transport.context.run({ endpoint: new URL(model.baseUrl) }, operation);
}

function safeFailure(status: number | undefined, aborted: boolean): string {
  if (aborted) return '连接测试已取消或超过 25 秒，请检查网络后重试。';
  if (status === 401 || status === 403) return '模型服务拒绝授权，请检查 API 密钥及该模型的访问权限。';
  if (status === 404) return '模型服务未找到接口或模型，请检查协议、基础地址及模型 ID。';
  if (status === 429) return '模型服务额度不足或请求频率受限，请稍后重试。';
  if (status && status >= 500) return '模型服务暂时不可用，请稍后重试。';
  if (status && status >= 400) return '模型服务未接受请求，请检查协议、模型 ID 和工具调用支持。';
  return '连接未完成，请检查网络、基础地址、协议和密钥。服务跳转已禁用，请填写最终接口地址。';
}

/** Real, bounded two-turn probe: receive a tool call, return its result, verify completion. */
export async function testConnection(connection: RuntimeConnection, signal?: AbortSignal): Promise<ConnectionTestResult> {
  const started = Date.now();
  const result = (ok: boolean, message: string): ConnectionTestResult => ({ ok, message, latencyMs: Date.now() - started });
  let model: Model<Api>;
  try { model = await modelForConnection(connection); }
  catch (error) { return result(false, error instanceof Error ? error.message : '模型连接配置不完整。'); }
  const local = new AbortController();
  const abort = () => local.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, TEST_TIMEOUT_MS);
  let status: number | undefined;
  try {
    local.signal.throwIfAborted();
    const { streamSimple, Type } = await import('@mariozechner/pi-ai');
    const options: SimpleStreamOptions = { apiKey: connection.apiKey || 'local', signal: local.signal,
      maxTokens: Math.min(512, connection.maxTokens), timeoutMs: TEST_TIMEOUT_MS,
      maxRetries: 0, maxRetryDelayMs: 0, cacheRetention: 'none', transport: 'sse',
      onResponse: (response) => { status = response.status; } };
    const context: Context = {
      systemPrompt: `This is a connection and tool compatibility check. First call ${probeTool} exactly once with nonce "${probeNonce}". After receiving its result, reply with exactly REPOCARE_OK.`,
      messages: [{ role: 'user', content: 'Run the connection check now.', timestamp: Date.now() }],
      tools: [{ name: probeTool, description: 'Verify that the connection supports structured tool calls.',
        parameters: Type.Object({ nonce: Type.String() }, { additionalProperties: false }) }],
    };
    const request = () => withModelTransport(model, () => streamSimple(model, context, options).result());
    const first = await request();
    if (first.stopReason === 'error' || first.stopReason === 'aborted') return result(false, safeFailure(status, local.signal.aborted));
    const calls = first.content.filter((item) => item.type === 'toolCall');
    if (first.stopReason !== 'toolUse' || calls.length !== 1 || calls[0].name !== probeTool
      || calls[0].arguments.nonce !== probeNonce || Object.keys(calls[0].arguments).length !== 1) {
      return result(false, '接口可达，但未通过工具调用验证；请选择支持工具调用的模型，并检查中转协议兼容性。');
    }
    context.messages.push(first, { role: 'toolResult', toolCallId: calls[0].id, toolName: probeTool,
      content: [{ type: 'text', text: '{"ok":true}' }], isError: false, timestamp: Date.now() });
    const final = await request();
    if (final.stopReason === 'error' || final.stopReason === 'aborted') return result(false, safeFailure(status, local.signal.aborted));
    const text = final.content.filter((item) => item.type === 'text').map((item) => item.text).join('').trim();
    if (final.stopReason !== 'stop' || text !== 'REPOCARE_OK') return result(false, '工具调用已收到，但工具结果回传验证未通过，暂不建议用于自动体检。');
    return result(true, '连接成功，模型回复与工具调用往返验证均已通过。');
  } catch {
    return result(false, safeFailure(status, local.signal.aborted));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
