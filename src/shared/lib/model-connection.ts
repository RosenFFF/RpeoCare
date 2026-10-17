import type { ConnectionInput, ModelProtocol } from '../../contracts/models';

export const modelPresets = [
  { id: 'deepseek', label: 'DeepSeek 官方', provider: 'deepseek', protocol: 'openai-completions', baseUrl: 'https://api.deepseek.com', keyLabel: 'DeepSeek API Key', modelHint: '使用控制台/API 文档中的模型 ID。', note: '官方 Key 仅配官方地址；中转服务请选择自定义。' },
  { id: 'openai', label: 'OpenAI 官方', provider: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', keyLabel: 'OpenAI API Key', modelHint: '填写此 API 账户可用的模型 ID。', note: 'ChatGPT 订阅不含 API 凭据；默认用 Responses。' },
  { id: 'anthropic', label: 'Anthropic / Claude', provider: 'anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', keyLabel: 'Anthropic API Key', modelHint: '填写 Claude API 模型 ID，不是网页聊天名称。', note: '使用 Messages 协议；中转地址需支持此协议。' },
  { id: 'gemini', label: 'Google Gemini（兼容接口）', provider: 'google', protocol: 'openai-completions', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyLabel: 'Gemini API Key', modelHint: '填写 Gemini API 中账户可用的模型 ID。', note: '使用 OpenAI 兼容接口，不是 Gemini 原生接口。' },
  { id: 'qwen-cn', label: '阿里云百炼 · 北京', provider: 'alibaba', protocol: 'openai-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyLabel: '百炼 API Key（北京）', modelHint: '模型 ID 需匹配地域和账户额度。', note: '按量 API；Coding Plan 和专属端点请选择自定义。' },
  { id: 'qwen-intl', label: '阿里云百炼 · 新加坡', provider: 'alibaba', protocol: 'openai-completions', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyLabel: '百炼 API Key（新加坡）', modelHint: '填写新加坡地域 API 可用的模型 ID。', note: '请使用新加坡地域的 Key；其他端点请选择自定义。' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openrouter', protocol: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', keyLabel: 'OpenRouter API Key', modelHint: '填写 OpenRouter 完整模型 ID（含提供商前缀）。', note: '使用 OpenRouter Key，不是底层模型平台 Key。' },
  { id: 'ollama', label: 'Ollama 本机', provider: 'ollama', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:11434/v1', keyLabel: '本机密钥（可不填）', modelHint: '填写本机已安装的模型名；工具能力需主动测试。', note: '连接 RepoCare 所在机器；需自行安装并运行 Ollama。' },
  { id: 'custom', label: '自定义 / 中转服务', provider: 'custom', protocol: 'openai-completions', baseUrl: '', keyLabel: '该平台 API Key', modelHint: '填写平台提供的模型 ID 或别名。', note: 'Key、协议、模型 ID 和地址需来自同一服务；支持三种协议。' },
] satisfies { id: string; label: string; provider: string; protocol: ModelProtocol; baseUrl: string; keyLabel: string; modelHint: string; note: string }[];
export type PresetId = typeof modelPresets[number]['id'];
export const protocolLabels: Record<ModelProtocol, string> = { 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' };
export function inferredPreset(connection: Pick<ConnectionInput, 'baseUrl' | 'provider'>): string {
  const url = endpointIdentity(connection.baseUrl, connection.provider);
  return modelPresets.find(preset => preset.id !== 'custom' && endpointIdentity(preset.baseUrl, preset.provider) === url)?.id || 'custom';
}
export function endpointIdentity(baseUrl: string, provider = ''): string {
  const value = baseUrl.trim() || (['openai','anthropic','deepseek'].includes(provider) ? modelPresets.find(preset => preset.provider === provider)?.baseUrl : '') || '';
  try {
    const url = new URL(value); let path = url.pathname.replace(/\/+$/, '');
    // DeepSeek documents / and /v1 as equivalent; don't alias custom paths.
    if (url.origin === 'https://api.deepseek.com' && path === '/v1') path = '';
    return url.origin + path;
  } catch { return `unspecified:${provider}:${value}`; }
}
export function sameModelTarget(a: Pick<ConnectionInput, 'baseUrl' | 'provider' | 'protocol' | 'modelId'>, b: Pick<ConnectionInput, 'baseUrl' | 'provider' | 'protocol' | 'modelId'>): boolean {
  return endpointIdentity(a.baseUrl, a.provider) === endpointIdentity(b.baseUrl, b.provider) && a.protocol === b.protocol && a.modelId.trim() === b.modelId.trim();
}
export function connectionName(name: string) { return name.trim().toLocaleLowerCase('en-US'); }
export function endpointSummary(baseUrl: string, provider: string) {
  const value = endpointIdentity(baseUrl, provider);
  if (value.startsWith('unspecified:')) return '内置目录地址 / 未指定';
  try { const url = new URL(value); return url.host + (url.pathname === '/' ? '' : url.pathname); } catch { return '地址未解析'; }
}
export function requestEndpoint(input: Pick<ConnectionInput, 'baseUrl' | 'protocol'>): string {
  const base = input.baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '保存后由内置目录确定；请核对对应模型是否存在。';
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash) return '地址包含凭据/查询/片段，请删除后再保存。';
    const path = input.protocol === 'anthropic-messages' ? '/v1/messages' : input.protocol === 'openai-responses' ? '/responses' : '/chat/completions';
    return base + path;
  } catch { return '请填写有效基础地址。'; }
}
