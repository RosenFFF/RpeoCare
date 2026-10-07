import type { ConnectionInput, ModelProtocol } from '../../contracts/models';

export const modelPresets = [
  { id: 'deepseek', label: 'DeepSeek 官方', provider: 'deepseek', protocol: 'openai-completions', baseUrl: 'https://api.deepseek.com', keyLabel: 'DeepSeek API Key', modelHint: '填写 DeepSeek 控制台/API 文档中的模型 ID，不是连接名称。', note: '官方 Key 仅用于官方地址；中转平台的 Key 请选自定义服务。' },
  { id: 'openai', label: 'OpenAI 官方', provider: 'openai', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', keyLabel: 'OpenAI API Key', modelHint: '填写当前 API 账户可访问的模型 ID；ChatGPT 订阅不是 API 凭据。', note: '预设使用 Responses；需要 Chat Completions 可在高级设置中明确切换。' },
  { id: 'anthropic', label: 'Anthropic / Claude', provider: 'anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', keyLabel: 'Anthropic API Key', modelHint: '填写 Anthropic API 的 Claude 模型 ID，不填网页聊天名称。', note: '使用原生 Messages 协议，不要填 OpenAI 协议的中转地址。' },
  { id: 'gemini', label: 'Google Gemini（兼容接口）', provider: 'google', protocol: 'openai-completions', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyLabel: 'Gemini API Key', modelHint: '填写 Google AI Studio / Gemini API 中可访问的模型 ID。', note: '接入 OpenAI 兼容层，不是 Gemini 原生 generateContent；参数/工具能力需主动测试。' },
  { id: 'qwen-cn', label: '阿里云百炼 · 北京', provider: 'alibaba', protocol: 'openai-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyLabel: '百炼 API Key（北京）', modelHint: '填写该地域 API 可访问的模型 ID；模型额度和地域需匹配。', note: '这是按量 API 地址，不是 Coding Plan 专用地址；其他地域或专属端点请选自定义服务。' },
  { id: 'qwen-intl', label: '阿里云百炼 · 新加坡', provider: 'alibaba', protocol: 'openai-completions', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyLabel: '百炼 API Key（新加坡）', modelHint: '填写新加坡地域 API 可访问的模型 ID。', note: '不要混用北京地域的 Key、模型权限和地址；专属端点请选自定义服务。' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openrouter', protocol: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', keyLabel: 'OpenRouter API Key', modelHint: '填写 OpenRouter 平台完整模型 ID（通常含提供商前缀）。', note: '使用 OpenRouter 的 Key 和地址，不是下游模型服务商的官方 Key。' },
  { id: 'ollama', label: 'Ollama 本机', provider: 'ollama', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:11434/v1', keyLabel: '本机密钥（可不填）', modelHint: '填写本机已安装的模型名称；不要假定任意模型都支持工具调用。', note: '这里的本机是 RepoCare 服务所在机器，不是远程访问者的电脑。不自动安装或启动 Ollama。' },
  { id: 'custom', label: '自定义 / 中转服务', provider: 'custom', protocol: 'openai-completions', baseUrl: '', keyLabel: '该平台 API Key', modelHint: '填写这个平台实际提供的模型 ID 或别名，不必在内置目录中。', note: 'Key、协议、模型 ID、基础地址必须来自同一服务。只支持这里列出的三种接口协议。' },
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
