'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Eye, EyeOff, Info, Plus, PlugZap, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import type { ConnectionInput, ModelConnection, ModelSettingsResponse } from '@/contracts/models';
import { connectionName, endpointIdentity, endpointSummary, inferredPreset, modelPresets, protocolLabels, requestEndpoint, sameModelTarget } from '@/shared/lib/model-connection';
import './model-settings.css';

const blank = (): ConnectionInput => ({ name: '', provider: 'custom', protocol: 'openai-completions', baseUrl: '', modelId: '', apiKey: '', keyAction: 'replace', contextWindow: null, maxTokens: null });
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({ error: '服务未返回有效响应，请检查登录状态后重试。' }));
  if (!response.ok) throw new Error(value.error || '请求未完成，请稍后重试。');
  return value as T;
}
const taskLabels: Record<string, string> = { issue: 'Issue 回复', 'issue-triage': 'Issue 分诊', 'issue-triage-repair': '分诊格式修复', 'file-draft': '文档草稿', 'pull-request-review': 'PR 审查' };

export function ModelSettings() {
  const [settings, setSettings] = useState<ModelSettingsResponse | null>(null);
  const [editing, setEditing] = useState<ModelConnection | null>(null), [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ConnectionInput>(blank), [baseline, setBaseline] = useState('');
  const [presetId, setPresetId] = useState('custom'), [showKey, setShowKey] = useState(false), [makeDefault, setMakeDefault] = useState(false), [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [removeId, setRemoveId] = useState(''), [defaultId, setDefaultId] = useState(''), [testId, setTestId] = useState('');
  const operationLock = useRef(false), headingRef = useRef<HTMLHeadingElement>(null);
  const preset = modelPresets.find(item => item.id === presetId) || modelPresets.at(-1)!;
  const current = settings?.connections.find(item => item.id === settings.defaultId);
  const peers = (settings?.connections || []).filter(item => item.id !== editing?.id);
  const nameConflict = Boolean(draft.name.trim() && peers.some(item => connectionName(item.name) === connectionName(draft.name)) && (!editing || connectionName(editing.name) !== connectionName(draft.name)));
  const duplicates = peers.filter(item => draft.modelId.trim() && sameModelTarget(item, draft));
  const duplicateRequiresConfirmation = duplicates.length > 0 && (!editing || !sameModelTarget(editing, draft));
  const officialAddressChanged = preset.id !== 'custom' && endpointIdentity(draft.baseUrl,draft.provider) !== endpointIdentity(preset.baseUrl,preset.provider);
  const dirty = editorOpen && JSON.stringify(draft) !== baseline;

  useEffect(() => { let disposed = false; void request<ModelSettingsResponse>('/api/models').then(value => { if (!disposed) setSettings(value); }).catch(cause => { if (!disposed) setError(cause.message); }); return () => { disposed = true; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => { const target=(event.target as HTMLElement).closest('a[href],button[aria-label^="切换项目："]'); if(target&&!window.confirm('模型表单有未保存修改，仍要离开或切换项目吗？密钥输入不会保存到浏览器缓存。')){event.preventDefault();event.stopPropagation();} };
    window.addEventListener('beforeunload', leave); document.addEventListener('click',navigate,true); return () => {window.removeEventListener('beforeunload', leave);document.removeEventListener('click',navigate,true);};
  }, [dirty]);
  function canSwitch() { return !dirty || window.confirm('表单有未保存修改，仍要放弃并切换吗？'); }
  function edit(item: ModelConnection | null) {
    if (operationLock.current || !canSwitch()) return;
    const value: ConnectionInput = item ? { name: item.name, provider: item.provider, protocol: item.protocol, baseUrl: item.baseUrl, modelId: item.modelId, contextWindow: item.contextWindow ?? null, maxTokens: item.maxTokens ?? null, apiKey: '', keyAction: 'keep' } : blank();
    setEditing(item); setDraft(value); setBaseline(JSON.stringify(value)); setEditorOpen(true); setPresetId(item ? inferredPreset(item) : 'custom');
    setAllowDuplicate(false); setMakeDefault(false); setShowKey(false); setError(''); setMessage(''); setRemoveId(''); setDefaultId(''); setTestId('');
    setTimeout(() => headingRef.current?.focus(), 30);
  }
  function closeEditor() {
    if (!canSwitch()) return;
    setEditorOpen(false); setDraft(blank()); setBaseline(''); setEditing(null); setShowKey(false); setAllowDuplicate(false);
  }
  async function action(name: string, operation: () => Promise<void>) {
    if (operationLock.current) return;
    operationLock.current = true; setBusy(name); setError(''); setMessage('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成。'); }
    finally { operationLock.current = false; setBusy(''); }
  }
  async function mutate(body: unknown) { const value = await request<ModelSettingsResponse>('/api/models', body); setSettings(value); return value; }
  function field<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) { setDraft(row => ({ ...row, [key]: value })); if (['baseUrl','provider','protocol','modelId'].includes(key)) setAllowDuplicate(false); }
  function choosePreset(id: string) {
    const next = modelPresets.find(item => item.id === id)!;
    if (presetId !== id && (draft.modelId || draft.apiKey || editing?.hasKey) && !window.confirm('切换服务类型将清空本表单的模型 ID，并要求重新填写对应平台密钥；已保存连接不会立即改变。继续？')) return;
    setPresetId(id); setAllowDuplicate(false); setShowKey(false);
    setDraft(row => ({ ...row, name: editing ? row.name : next.label, provider: next.provider, protocol: next.protocol, baseUrl: next.baseUrl, modelId: '', apiKey: '', keyAction: next.id === 'ollama' ? 'clear' : 'replace' }));
  }
  async function save() {
    if (nameConflict) { setError('已有同名连接。请编辑已有项，或使用清晰不同的名称。'); return; }
    if (duplicateRequiresConfirmation && !allowDuplicate) { setError('这个接口和模型已经配置。请编辑已有连接，或明确确认另建不同账户连接。'); return; }
    if (editing && draft.keyAction === 'keep' && draft.baseUrl.trim().replace(/\/+$/, '') !== editing.baseUrl.trim().replace(/\/+$/, '') && !window.confirm('基础地址已改变，但仍会使用旧密钥。确认这把 Key 属于新地址平台且愿意发送给它？不确定请取消并替换密钥。')) return;
    if (draft.contextWindow != null && draft.maxTokens != null && draft.maxTokens > draft.contextWindow) { setError('最大输出不能大于填写的上下文长度。'); return; }
    const wasNew = !editing;
    const value = await mutate({ action: 'save', input: draft, ...(editing ? { id: editing.id, revision: editing.revision } : {}), makeDefault, allowDuplicate: duplicateRequiresConfirmation && allowDuplicate });
    const id = value.savedId || editing?.id;
    const saved = value.connections.find(item => item.id === id);
    if (!saved) { setError('已保存但未能定位返回连接，请刷新后检查；不要重复新建。'); return; }
    const next: ConnectionInput = { name: saved.name, provider: saved.provider, protocol: saved.protocol, baseUrl: saved.baseUrl, modelId: saved.modelId, contextWindow: saved.contextWindow ?? null, maxTokens: saved.maxTokens ?? null, apiKey: '', keyAction: 'keep' };
    setEditing(saved); setDraft(next); setBaseline(JSON.stringify(next)); setShowKey(false); setMakeDefault(false); setAllowDuplicate(false);
    setMessage(`${wasNew ? '已创建连接' : '已更新原连接，没有新增记录'}。${value.defaultId === saved.id ? '它是当前默认连接。' : '默认连接未切换；需要使用它时请选择设为默认。'}保存不会自动测试或调用模型。`);
  }
  return <section className="mc-section" aria-labelledby="ms-heading">
    <header className="mc-heading"><div><h2 id="ms-heading"><PlugZap size={22}/>模型连接</h2><p>管理服务地址、凭据与模型。新建、编辑、测试和启用是不同操作。</p></div><button type="button" className="button button-secondary" disabled={!!busy} onClick={() => edit(null)}><Plus size={16}/>新增连接</button></header>
    <p className="mc-safety"><ShieldCheck size={16}/>API Key 加密保存在本机服务端，不会回显。保存和切换默认不发模型请求；测试及 AI 任务可能产生费用。</p>
    {error && <div className="mc-message error" role="alert">{error}<button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void action('reload', async () => { setSettings(await request('/api/models')); })}><RefreshCw size={14}/>刷新连接列表</button></div>}
    {message && <p className="mc-message" role="status">{message}</p>}
    {!settings && !error && <p role="status">正在读取模型连接…</p>}
    {settings && <>
      <section className="mc-default" aria-label="当前默认模型"><div><span className="mc-caption">之后的 AI 任务实际使用</span><h3>{current ? current.name : settings.environmentConfigured ? '服务端环境变量连接' : '未选择默认模型'}</h3><p>{current ? `${current.modelId} · ${protocolLabels[current.protocol]} · ${endpointSummary(current.baseUrl, current.provider)}` : settings.environmentConfigured ? '未选择账户默认时使用环境变量；环境密钥不会显示。' : '项目体检仍可运行基础规则；Issue 分析、PR 审查与草稿生成需要选择模型。'}</p><small>已经排队的体检保留原配置。保存第二份连接不会自动替换默认。</small></div>{current && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => edit(current)}>编辑当前默认</button>}</section>
    {editorOpen && <form className="mc-editor" onSubmit={event=>{event.preventDefault();void action('save',save);}}>
      <header><div><span className="mc-caption">{editing ? `更新原连接 ${editing.id.slice(0,8)} · 版本 ${editing.revision}` : '明确新建一份连接'}</span><h3 ref={headingRef} tabIndex={-1}>{editing ? '编辑连接，不会新增记录' : '新增模型连接'}</h3></div><button type="button" className="mc-text-button" disabled={!!busy} onClick={closeEditor}><ArrowLeft size={15}/>关闭表单</button></header>
      <fieldset disabled={!!busy}><legend className="mc-sr-only">模型连接配置</legend>
        <div className="mc-fields"><div className="mc-field"><label htmlFor="mc-preset">服务类型</label><select id="mc-preset" value={presetId} onChange={event=>choosePreset(event.target.value)}>{modelPresets.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><p>预设只填写协议和基础地址，不保证模型权限或工具能力。</p></div><div className="mc-field"><label htmlFor="mc-name">连接名称</label><input id="mc-name" autoComplete="off" required maxLength={80} value={draft.name} onChange={event=>field('name',event.target.value)} placeholder="如：DeepSeek · 工作账户"/><p>用于区分账户和用途；不是模型 ID。</p></div></div>
        <p className="mc-provider-note"><Info size={16}/>{preset.note}</p>{officialAddressChanged && <p className="mc-duplicate">当前地址已偏离所选服务预设。请确认这是你信任的平台，并使用它提供的 Key；不会自动纠正地址或挪用旧密钥。</p>}
        <div className="mc-field"><label htmlFor="mc-base">API 基础地址</label><input id="mc-base" type="url" autoComplete="off" maxLength={1000} value={draft.baseUrl} onChange={event=>field('baseUrl',event.target.value)} placeholder={preset.baseUrl || 'https://your-provider.example/v1'}/><p>只填基础地址，不含 /chat/completions、/responses 或 /messages。HTTPS 必须；本机可用 HTTP。</p></div>
        <div className="mc-fields"><div className="mc-field"><label htmlFor="mc-model">模型 ID</label><input id="mc-model" required maxLength={160} autoComplete="off" value={draft.modelId} onChange={event=>field('modelId',event.target.value)} placeholder="按当前平台提供的 ID 填写"/><p>{preset.modelHint}不会自动查询模型列表。</p></div><div className="mc-field"><label htmlFor="mc-protocol">请求协议</label><select id="mc-protocol" value={draft.protocol} onChange={event=>field('protocol',event.target.value as ConnectionInput['protocol'])}>{Object.entries(protocolLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><p>模型名称与协议不是同一件事；中转必须采用平台实际支持的协议。</p></div></div>
        <section className="mc-key"><div className="mc-field"><label htmlFor="mc-key-action">密钥操作</label><select id="mc-key-action" value={draft.keyAction} onChange={event=>{field('keyAction',event.target.value as ConnectionInput['keyAction']);field('apiKey','');setShowKey(false);}}>{editing && <option value="keep">保留已保存密钥</option>}<option value="replace">{editing ? '替换为新密钥' : '填写此平台密钥'}</option><option value="clear">不使用密钥 / 清除（仅适合本机服务）</option></select></div>{draft.keyAction==='replace' ? <div className="mc-field"><label htmlFor="mc-key">{preset.keyLabel}</label><div className="mc-key-input"><input id="mc-key" type={showKey?'text':'password'} autoComplete="new-password" required maxLength={2000} value={draft.apiKey || ''} onChange={event=>field('apiKey',event.target.value)} placeholder="仅输入密钥本身，不添加 Bearer 前缀"/><button type="button" aria-label={showKey?'隐藏密钥输入':'显示当前输入的密钥'} onClick={()=>setShowKey(value=>!value)}>{showKey?<EyeOff size={17}/>:<Eye size={17}/>}</button></div><p>这里只显示你本次输入的内容，服务端旧密钥永远不会回显。</p></div> : <p>旧密钥不会显示。{draft.keyAction==='keep' ? '保存会保留原密钥。' : '远程服务通常需要密钥；清除后可能无法调用。'}</p>}</section>
        {(duplicates.length>0||nameConflict) && <section className="mc-duplicate-editor" aria-label="重复连接提示"><h4>已有相似连接，优先编辑而不是再次新增</h4><p>{nameConflict?'已有相同名称。请更新原连接或填写不同名称。':'同一个接口、协议和模型已经配置；更换 Key 应编辑那一份。'}</p>{(duplicates.length?duplicates:peers.filter(row=>connectionName(row.name)===connectionName(draft.name))).map(item=><button type="button" className="button button-secondary" key={item.id} onClick={()=>edit(item)}>编辑已有：{item.name} · {item.id.slice(0,8)}{item.id===settings?.defaultId?' · 当前默认':''}</button>)}{duplicateRequiresConfirmation && <label className="mc-checkbox"><input type="checkbox" checked={allowDuplicate} onChange={event=>setAllowDuplicate(event.target.checked)}/>我确实需要另一账户／用途的独立连接，会使用不同名称；不是替换原连接密钥。</label>}</section>}
        <section className="mc-token-settings" aria-labelledby="mc-token-heading">
          <h4 id="mc-token-heading">上下文与最大输出</h4><p>新连接默认留空，不再额外限制为 4096 / 3500 tokens。已有连接保留保存值；清空并保存后改为自动模式。</p>
          <div className="mc-fields">
            <div className="mc-field"><label htmlFor="mc-context">上下文长度（tokens，可留空）</label><input id="mc-context" type="number" min={1} step={1} value={draft.contextWindow ?? ''} placeholder="自动：已知目录值，否则由服务商校验" onChange={event=>field('contextWindow',event.target.value === '' ? null : Number(event.target.value))}/><p>填写时声明模型上下文能力，传给 pi 的模型元数据；不是修改服务商容量，也不是精确 token 计数。留空时自定义未知模型不会被假装成无限上下文。</p></div>
            <div className="mc-field"><label htmlFor="mc-tokens">最大输出（tokens，可留空）</label><input id="mc-tokens" type="number" min={1} step={1} max={draft.contextWindow ?? undefined} value={draft.maxTokens ?? ''} placeholder="自动：不发送额外输出上限" onChange={event=>field('maxTokens',event.target.value === '' ? null : Number(event.target.value))}/><p>填写后按原值用于 Issue / PR / 草稿及体检 Agent 单轮请求，不再被工作流悄悄压低。推理可能占用服务商输出预算。</p></div>
          </div>
          <button type="button" className="button button-secondary" onClick={()=>setDraft(value=>({...value,contextWindow:null,maxTokens:null}))}>清空两项，使用自动模式</button>
          <p className="mc-token-effective">当前选择：上下文 {draft.contextWindow == null ? '自动 / 未知由服务商校验' : `${draft.contextWindow.toLocaleString('zh-CN')} tokens`}；输出 {draft.maxTokens == null ? draft.protocol === 'anthropic-messages' ? '使用匹配 SDK 目录值；未知模型需填写' : '省略额外上限，由服务商决定默认值' : `${draft.maxTokens.toLocaleString('zh-CN')} tokens`}。</p>
          {draft.protocol === 'anthropic-messages' && draft.maxTokens == null && <p className="mc-duplicate">Anthropic Messages 强制要求 max_tokens；自动模式仅能使用完全匹配的 SDK 模型目录值。自定义模型无目录值时，需要明确填写，不会偷偷代填。</p>}
          <details className="mc-advanced"><summary>仍保留的边界（与这两个 tokens 字段不同）</summary><p>模型真实容量及默认输出由服务商决定。当前工作流还有：输入 100,000 字符、草稿文本 30,000 字符、普通请求 60 秒；体检 Agent 7 轮 / 18 次工具 / 90 秒 / 报告 24,000 字符及快照分页。连接测试单独使用最多 512 输出 tokens / 25 秒。这些不因清空两项而取消。</p><p>当前 pi-agent-core 集成没有自动压缩上下文；不会把字符数当作精确 tokens 或静默丢弃内容。体检报告结构、来源校验和发布确认保留。</p></details>
        </section>
        <details className="mc-advanced"><summary>高级设置：服务商标识</summary><div className="mc-field"><label htmlFor="mc-provider">服务商标识</label><input id="mc-provider" required maxLength={80} pattern={"[a-zA-Z0-9._\\-]+"} value={draft.provider} onChange={event=>field('provider',event.target.value)}/><p>预设自动填写；自定义平台可使用 custom。不是显示名称。</p></div></details>
        <div className="mc-request-preview"><span>按当前字段拼接的请求路径（示意，不是连接测试）</span><code>{requestEndpoint(draft)}</code><p>Key 必须来自上述地址的平台；中转 Key 不能发往官方地址。</p></div>
        <label className="mc-checkbox"><input type="checkbox" checked={makeDefault} disabled={settings?.defaultId===editing?.id&&!!editing} onChange={event=>setMakeDefault(event.target.checked)}/>{settings?.defaultId===editing?.id&&editing?'此项已经是当前默认，保存只更新原连接。':'保存后明确设为当前默认（不发请求、不影响已排队体检）'}</label>
        <p className="mc-note">{!editing&&!settings?.connections.length?'第一份连接会成为默认。':'不勾选时，保存不会切换到这份连接。'}模型能力只在用户主动测试后验证。</p>
        <footer><button type="submit" className="button button-primary" disabled={!!busy||nameConflict||duplicateRequiresConfirmation&&!allowDuplicate}><Save size={15}/>{busy==='save'?'保存中…':editing?'保存此连接的修改':'创建这份新连接'}</button><button type="button" className="button button-secondary" disabled={!!busy} onClick={closeEditor}>取消编辑</button>{dirty&&<span>有未保存修改</span>}</footer>
      </fieldset>
    </form>}
      <div className="mc-list-heading"><h3>已保存连接 <span>{settings.connections.length} / 10</span></h3><button type="button" className="mc-text-button" disabled={!!busy} onClick={() => void action('reload', async () => { setSettings(await request('/api/models')); })}>刷新</button></div>
      <div className="mc-connections">{!settings.connections.length ? <div className="mc-empty"><p>尚未添加连接。先选服务类型，再填写它的 Key 和模型 ID。</p><button type="button" className="button button-primary" onClick={() => edit(null)}>添加第一个连接</button></div> : settings.connections.map(item => {
        const sameName = settings.connections.filter(row => connectionName(row.name) === connectionName(item.name)).length > 1;
        const sameTarget = settings.connections.filter(row => sameModelTarget(row,item)).length > 1;
        return <article className={`mc-connection ${item.id === settings.defaultId ? 'is-default' : ''}`} key={item.id}>
          <div className="mc-connection-top"><div><strong>{item.name}</strong>{item.id === settings.defaultId && <span className="mc-tag">当前默认</span>}<p>{item.modelId} · {protocolLabels[item.protocol]}</p><p className="mc-endpoint">{endpointSummary(item.baseUrl,item.provider)}</p><p>上下文：{item.contextWindow == null ? '自动 / 未知' : `${item.contextWindow.toLocaleString('zh-CN')} tokens`}；最大输出：{item.maxTokens == null ? '自动（按协议）' : `${item.maxTokens.toLocaleString('zh-CN')} tokens`}</p><small>编号 {item.id.slice(0,8)} · 版本 {item.revision} · {item.hasKey ? '密钥已保存（不代表鉴权成功）' : '未保存密钥'}</small></div><span className={`mc-test-state ${item.test?.ok ? 'success' : item.test ? 'failed' : ''}`}>{item.test ? item.test.ok ? '测试通过' : '测试失败' : '未测试'}</span></div>
          {(sameName || sameTarget) && <p className="mc-duplicate"><Copy size={14}/>{sameName ? '存在同名历史连接，请按编号和默认标记区分。' : '相同接口和模型有多份连接。'}不会自动合并或删除；更新密钥请编辑对应连接。</p>}
          {item.test && <p className="mc-test-result">{item.test.message} · {item.test.latencyMs} ms</p>}
          <div className="mc-row-actions"><button type="button" className="button button-secondary" disabled={!!busy} onClick={() => edit(item)}>编辑 / 更新密钥</button><button type="button" className="button button-secondary" disabled={!!busy || settings.defaultId === item.id} onClick={() => { setDefaultId(item.id); setRemoveId(''); setTestId(''); }}>设为默认</button><button type="button" className="button button-secondary" disabled={!!busy} onClick={() => { setTestId(item.id); setDefaultId(''); setRemoveId(''); }}>测试连接</button><button type="button" className="mc-text-button danger" disabled={!!busy} onClick={() => { setRemoveId(item.id); setDefaultId(''); setTestId(''); }}>删除</button></div>
          {defaultId === item.id && <div className="mc-confirm"><p>将“{item.name}”（编号 {item.id.slice(0,8)}）用于之后的 AI 任务？{!item.test?.ok && '该配置尚未通过连接测试。'}此操作不发送模型请求。</p><button type="button" className="button button-primary" disabled={!!busy} onClick={() => void action('default', async () => { if (dirty && !canSwitch()) return; await mutate({ action:'default',id:item.id }); setDefaultId(''); setMessage('默认已切换；之后的 AI 任务将使用这份连接。'); })}>确认设为默认</button><button type="button" className="mc-text-button" disabled={!!busy} onClick={() => setDefaultId('')}>取消</button></div>}
          {testId === item.id && <div className="mc-confirm"><p>测试会发起少量模型请求，并验证文本与工具调用往返，可能计费。只测试已保存版本 {item.revision}，不切换默认。</p><button type="button" className="button button-primary" disabled={!!busy} onClick={() => void action(`test:${item.id}`, async () => { const result=await request<{connection:ModelConnection}>('/api/models/test',{id:item.id,revision:item.revision}); setSettings(value=>value&&({...value,connections:value.connections.map(row=>row.id===item.id?result.connection:row)})); setTestId(''); setMessage(result.connection.test?.message || '测试已结束。'); })}>{busy === `test:${item.id}` ? '测试中…' : '确认测试（可能计费）'}</button><button type="button" className="mc-text-button" disabled={!!busy} onClick={() => setTestId('')}>取消</button></div>}
          {removeId === item.id && <div className="mc-confirm danger"><p>删除“{item.name}”（编号 {item.id.slice(0,8)}）？{settings.defaultId===item.id ? settings.environmentConfigured ? '它是当前默认，删除后会回退到环境变量连接。' : '它是当前默认，删除后新的 AI 任务将没有默认模型。' : '默认连接不会改变。'}历史报告仍保留。</p><button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void action('delete',async()=>{ if(editing?.id===item.id&&dirty&&!canSwitch())return; await mutate({action:'delete',id:item.id,revision:item.revision}); if(editing?.id===item.id){setEditorOpen(false);setEditing(null);setDraft(blank());setShowKey(false);} setRemoveId('');setMessage('连接已删除，历史任务仍保留。'); })}>确认删除此连接</button><button type="button" className="mc-text-button" disabled={!!busy} onClick={() => setRemoveId('')}>取消</button></div>}
        </article>;
      })}</div>
      {settings.defaultId && <details className="mc-advanced"><summary>默认回退策略</summary><p>取消账户默认后，{settings.environmentConfigured ? '会使用服务端环境变量连接。' : '体检只做基础规则；其他 AI 功能需要重新选择模型。'}</p><button type="button" className="button button-secondary" disabled={!!busy} onClick={() => { if(window.confirm('确认取消当前默认模型？不会自动选择另一份已保存连接。')) void action('fallback',async()=>{await mutate({action:'default',id:null});setMessage('已取消账户默认，其他连接没有自动启用。');}); }}>取消账户默认</button></details>}
    </>}

    {!!settings?.recentFailures?.length && <details className="ms-request-diagnostics"><summary>最近模型请求诊断（仅本账户，最多 5 条）</summary><p>旧失败不具备足够记录时不能补推原因；原始响应和密钥不在此显示。</p><ul>{settings.recentFailures.map(item=><li key={item.id}><strong>{taskLabels[item.purpose] || item.purpose} · {item.httpStatus?`HTTP ${item.httpStatus}`:item.category}</strong><p>{item.message}</p><small>{item.at.replace('T',' ').slice(0,19)} UTC · {(item.durationMs/1000).toFixed(1)} 秒 · 配置编号 {item.connectionId.slice(0,8)} / 版本 {item.connectionRevision} · 诊断 {item.id.slice(0,8)}</small></li>)}</ul></details>}
  </section>;
}
