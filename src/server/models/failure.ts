import type { ModelRequestFailure } from '../../contracts/models';

/** Use trusted numeric status / finite runtime states only. Provider error text
 * may contain credentials, prompts or hidden reasoning and is never surfaced. */
export function modelFailure(input: { status?: number; timedOut?: boolean; cancelled?: boolean; transportFailure?: 'network' | 'blocked-endpoint'; stopReason?: string; invalidText?: 'empty' | 'oversize' }): { category: ModelRequestFailure; message: string } {
  if (input.cancelled) return { category: 'cancelled', message: '请求已取消，已有记录保留。请重新发起操作。' };
  if (input.timedOut) return { category: 'timeout', message: '模型请求超过 60 秒未完成，已有记录保留。请检查服务响应速度或稍后重试。' };
  const status = input.status;
  if (status === 401 || status === 403) return { category: 'authorization', message: `模型服务拒绝授权（HTTP ${status}）。请检查当前默认连接的 API Key 和模型访问权限。` };
  if (status === 402) return { category: 'balance', message: '模型服务返回余额不足或付费限制（HTTP 402）。请在服务商后台核对余额与账户状态。' };
  if (status === 429) return { category: 'rate-limit', message: '模型服务限流或额度受限（HTTP 429）。请稍后重试，并核对服务商限制。' };
  if (status === 404) return { category: 'not-found', message: '模型服务未找到接口或模型（HTTP 404）。请核对协议、基础地址和模型 ID。' };
  if (status && status >= 500) return { category: 'provider', message: `模型服务暂时异常（HTTP ${status}）。已有记录保留，请稍后重试。` };
  if (status && status >= 400) return { category: 'invalid-request', message: `模型服务未接受请求（HTTP ${status}）。请核对接口协议、模型 ID、上下文及输出参数。` };
  if (input.transportFailure === 'blocked-endpoint') return { category: 'blocked-endpoint', message: '模型请求试图访问配置地址范围之外的资源，已安全阻止。请使用最终基础地址并核对协议。' };
  if (input.transportFailure === 'network') return { category: 'network', message: '服务端未能完成模型接口网络请求。请检查网络、代理、TLS 或接口跳转；浏览器可打开服务网站不代表后台 API 请求可达。' };
  if (input.stopReason === 'length') return { category: 'truncated', message: '模型输出达到本次长度上限，结果不完整。请缩小输入或核对最大输出设置；推理内容也可能占用输出预算，已有记录保留。' };
  if (input.invalidText === 'empty') return { category: 'empty-output', message: '模型请求结束但没有可用文本。请检查模型是否只返回推理内容、工具调用或不兼容响应；未保存空草稿。' };
  if (input.invalidText === 'oversize') return { category: 'incompatible-output', message: '模型文本超过 30,000 字符限制，未保存结果。请缩小任务范围。' };
  if (input.stopReason === 'toolUse') return { category: 'incompatible-output', message: '当前任务需要文本，但模型返回工具调用。请核对模型与接口兼容性；不会执行这些调用。' };
  return { category: 'unknown', message: '模型请求未正常完成，已有记录保留。当前没有足够证据确定原因；请查看模型设置中的请求诊断，必要时主动测试连接。' };
}
