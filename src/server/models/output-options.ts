import type { Api, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import type { RuntimeConnection } from '../../contracts/models';

/** pi-ai's simple wrapper supplies a 32k default even if maxTokens is omitted.
 * Remove that injected output parameter for optional-parameter protocols.
 * Anthropic Messages requires max_tokens: use known model metadata or explicit
 * configuration, never pretend that a fictional huge value means unlimited. */
export function outputOptions(connection: Pick<RuntimeConnection, 'maxTokens'>, model: Model<Api>): Pick<SimpleStreamOptions, 'maxTokens' | 'onPayload'> {
  if (connection.maxTokens != null) return { maxTokens: connection.maxTokens };
  if (model.api === 'anthropic-messages') {
    if (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1) throw new Error('Anthropic Messages 必须指定最大输出。此模型没有已知目录值，请在模型连接中填写最大输出 tokens。');
    return { maxTokens: model.maxTokens };
  }
  return {
    onPayload: payload => {
      if (!payload || typeof payload !== 'object') return payload;
      const next = { ...payload } as Record<string, unknown>;
      delete next.max_tokens; delete next.max_completion_tokens; delete next.max_output_tokens;
      return next;
    },
  };
}
