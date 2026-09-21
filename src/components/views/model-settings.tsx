'use client';
import { useEffect, useState } from 'react';
import { Plus, PlugZap, Save } from 'lucide-react';
import type { ConnectionInput, ModelConnection, ModelSettingsResponse } from '@/lib/models/types';
import './model-settings.css';

const blank: ConnectionInput = { name: '', provider: 'custom', protocol: 'openai-completions', baseUrl: '', modelId: '', apiKey: '', keyAction: 'keep', contextWindow: 128000, maxTokens: 4096 };
const presets = {
  custom: { provider: 'custom', protocol: 'openai-completions' as const, baseUrl: '', name: '自定义连接' },
  openai: { provider: 'openai', protocol: 'openai-responses' as const, baseUrl: 'https://api.openai.com/v1', name: 'OpenAI 官方' },
  anthropic: { provider: 'anthropic', protocol: 'anthropic-messages' as const, baseUrl: 'https://api.anthropic.com', name: 'Anthropic 官方' },
  deepseek: { provider: 'deepseek', protocol: 'openai-completions' as const, baseUrl: 'https://api.deepseek.com', name: 'DeepSeek 官方' },
};
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求未完成，请稍后重试。');
  return data as T;
}
export function ModelSettings() {
  const [settings, setSettings] = useState<ModelSettingsResponse | null>(null);
  const [editing, setEditing] = useState<ModelConnection | null>(null);
  const [draft, setDraft] = useState<ConnectionInput>(blank);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removeId, setRemoveId] = useState('');
  useEffect(() => { let disposed = false; request<ModelSettingsResponse>('/api/models').then(value => { if (!disposed) setSettings(value); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, []);
  function edit(item: ModelConnection | null) {
    setEditing(item); setRemoveId(''); setMessage(''); setError('');
    setDraft(item ? { name: item.name, provider: item.provider, protocol: item.protocol, baseUrl: item.baseUrl, modelId: item.modelId, contextWindow: item.contextWindow, maxTokens: item.maxTokens, apiKey: '', keyAction: 'keep' } : { ...blank });
  }
  async function action(name: string, operation: () => Promise<void>) {
    setBusy(name); setError(''); setMessage('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败。'); } finally { setBusy(''); }
  }
  async function mutate(body: unknown) { const value = await request<ModelSettingsResponse>('/api/models', body); setSettings(value); return value; }
  function field<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) { setDraft(current => ({ ...current, [key]: value })); }
  return <section className="sv-section ms-section" aria-labelledby="ms-heading">
    <div className="sv-section-heading"><PlugZap size={21} aria-hidden="true" /><div><h2 id="ms-heading">模型连接</h2><p>为项目体检选择模型，支持官方服务与兼容接口。</p></div></div>
    <p className="ms-note">API Key 加密保存在本机服务端。测试会发送少量请求；体检会把公开仓库文件片段发送至所选服务，可能产生费用。</p>
    {!settings && !error && <p role="status">正在读取模型连接…</p>}
    {!settings && error && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void action('reload', async () => { setSettings(await request('/api/models')); })}>重新加载</button>}
    {settings && <>
      <div className="ms-connections">
        {settings.connections.length === 0 && <p className="ms-note">尚无模型连接。保存第一个连接后，将自动用于新体检。</p>}
        {settings.connections.map(item => <div key={item.id} className={`ms-connection${editing?.id === item.id ? ' ms-selected' : ''}`}>
          <div className="ms-connection-copy"><strong>{item.name}</strong>{settings.defaultId === item.id && <span className="ms-default">当前默认</span>}<p>{item.modelId} · v{item.revision} · {item.hasKey ? '密钥已保存' : '无密钥'}</p>{item.test && <p className={item.test.ok ? 'ms-success' : 'ms-test-failed'}>{item.test.message}（{item.test.latencyMs} ms）</p>}</div>
          <div className="ms-row-actions"><button type="button" disabled={!!busy} onClick={() => edit(item)}>编辑</button><button type="button" disabled={!!busy || settings.defaultId === item.id} onClick={() => void action('default', async () => { await mutate({ action: 'default', id: item.id }); setMessage('新体检将使用此连接。'); })}>设为默认</button><button type="button" disabled={!!busy} onClick={() => void action(`test:${item.id}`, async () => { const result = await request<{ connection: ModelConnection }>('/api/models/test', { id: item.id, revision: item.revision }); setSettings(current => current && ({ ...current, connections: current.connections.map(value => value.id === item.id ? result.connection : value) })); setMessage('连接测试已结束。'); })}>{busy === `test:${item.id}` ? '测试中…' : '测试连接'}</button><button type="button" disabled={!!busy} onClick={() => setRemoveId(item.id)}>删除</button></div>
          {removeId === item.id && <div className="ms-delete"><span>删除“{item.name}”？已有体检记录仍保留。</span><button type="button" disabled={!!busy} onClick={() => void action('delete', async () => { await mutate({ action: 'delete', id: item.id, revision: item.revision }); if (editing?.id === item.id) edit(null); setRemoveId(''); setMessage('连接已删除。'); })}>确认删除</button><button type="button" onClick={() => setRemoveId('')}>取消</button></div>}
        </div>)}
      </div>
      {settings.defaultId && <button className="ms-fallback" type="button" disabled={!!busy} onClick={() => void action('fallback', async () => { await mutate({ action: 'default', id: null }); setMessage('已取消默认连接。'); })}>取消默认连接</button>}
      <p className="ms-note">{settings.defaultId ? '修改设置只影响新体检，已开始或排队的任务保留原配置。' : settings.environmentConfigured ? '未选择默认连接时，使用服务端环境变量中的模型。' : '未选择默认连接时，仅运行基础规则检查。'}</p>
      <div className="ms-editor-heading"><h3>{editing ? `编辑：${editing.name}` : '添加模型连接'}</h3>{editing && <button type="button" disabled={!!busy} onClick={() => edit(null)}><Plus size={14} /> 新建连接</button>}</div>
      <form onSubmit={event => { event.preventDefault(); void action('save', async () => { const value = await mutate({ action: 'save', input: draft, ...(editing ? { id: editing.id, revision: editing.revision } : {}) }); const item = editing ? value.connections.find(value => value.id === editing.id)! : value.connections[value.connections.length - 1]; edit(item); setMessage('连接已保存，请测试模型回复与工具调用。'); }); }}>
        <fieldset disabled={!!busy}><legend className="ms-sr-only">模型连接配置</legend>
          {!editing && <div className="sv-field ms-preset"><label htmlFor="ms-preset">快速填写</label><select id="ms-preset" defaultValue="custom" onChange={event => setDraft(current => ({ ...current, ...presets[event.target.value as keyof typeof presets] }))}>{Object.entries(presets).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></div>}
          <div className="sv-fields ms-fields">
            <div className="sv-field"><label htmlFor="ms-name">连接名称</label><input id="ms-name" required maxLength={80} value={draft.name} onChange={e => field('name', e.target.value)} placeholder="例如：比赛演示模型" /></div>
            <div className="sv-field"><label htmlFor="ms-provider">服务商标识</label><input id="ms-provider" required pattern="[a-zA-Z0-9._-]+" maxLength={80} value={draft.provider} onChange={e => field('provider', e.target.value)} /><p>中转或自定义服务可填写 custom。</p></div>
            <div className="sv-field"><label htmlFor="ms-protocol">接口协议</label><select id="ms-protocol" value={draft.protocol} onChange={e => field('protocol', e.target.value as ConnectionInput['protocol'])}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></div>
            <div className="sv-field"><label htmlFor="ms-model">模型 ID</label><input id="ms-model" required maxLength={160} value={draft.modelId} onChange={e => field('modelId', e.target.value)} placeholder="填写服务商提供的精确模型 ID" /></div>
            <div className="sv-field ms-full"><label htmlFor="ms-url">服务基础地址</label><input id="ms-url" type="url" value={draft.baseUrl} onChange={e => field('baseUrl', e.target.value)} placeholder="https://your-provider.example/v1" /><p>填写你信任的服务地址，不含 /chat/completions 等请求路径。内置模型可留空使用官方地址。</p></div>
            <div className="sv-field"><label htmlFor="ms-key-action">密钥操作</label><select id="ms-key-action" value={draft.keyAction} onChange={e => { field('keyAction', e.target.value as ConnectionInput['keyAction']); field('apiKey', ''); }}><option value="keep">{editing?.hasKey ? '保留已保存密钥' : '暂不设置密钥'}</option><option value="replace">填写新密钥</option><option value="clear">清除密钥</option></select></div>
            <div className="sv-field"><label htmlFor="ms-key">API Key</label><input id="ms-key" type="password" autoComplete="new-password" disabled={draft.keyAction !== 'replace'} required={draft.keyAction === 'replace'} maxLength={2000} value={draft.apiKey || ''} onChange={e => field('apiKey', e.target.value)} placeholder={editing?.hasKey ? '已保存的密钥不会回显' : '选择“填写新密钥”后输入'} /></div>
            <div className="sv-field"><label htmlFor="ms-context">上下文长度（tokens）</label><input id="ms-context" type="number" min={4096} max={4000000} required value={draft.contextWindow} onChange={e => field('contextWindow', Number(e.target.value))} /></div>
            <div className="sv-field"><label htmlFor="ms-tokens">最大输出（tokens）</label><input id="ms-tokens" type="number" min={256} max={Math.min(200000, draft.contextWindow)} required value={draft.maxTokens} onChange={e => field('maxTokens', Number(e.target.value))} /></div>
          </div>
          <div className="ms-save"><button className="button button-primary" type="submit"><Save size={15} /> {busy === 'save' ? '正在保存…' : '保存模型连接'}</button></div>
        </fieldset>
      </form>
    </>}
    {error && <p className="sv-error" role="alert">{error}</p>}{message && <p className="ms-success" role="status">{message}</p>}
  </section>;
}
