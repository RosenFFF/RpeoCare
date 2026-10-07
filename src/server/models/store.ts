import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../audit/store';
import { decryptSecret, encryptSecret } from './crypto';
import { environmentConnection, validateModelEndpoint } from './adapter';
import { connectionName, sameModelTarget } from '../../shared/lib/model-connection';
import { recentModelFailures } from './request-diagnostics';
import { protocols, type ModelConnection, type RuntimeConnection, type ConnectionTestResult } from '../../contracts/models';

const inputSchema = z.object({
  name: z.string().trim().min(1).max(80), provider: z.string().trim().regex(/^[a-zA-Z0-9._-]{1,80}$/),
  protocol: z.enum(protocols), baseUrl: z.string().trim().max(1000), modelId: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().max(2000).optional(), keyAction: z.enum(['keep', 'replace', 'clear']).default('keep'),
  contextWindow: z.number().int().min(4096).max(4_000_000), maxTokens: z.number().int().min(256).max(200_000),
}).strict().refine(value => value.maxTokens <= value.contextWindow);
type Row = { id: string; owner: string; state: string; secret: string };
function database() {
  const database = db();
  database.exec(`CREATE TABLE IF NOT EXISTS model_connections (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, secret TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS model_connection_owner ON model_connections(owner);
    CREATE TABLE IF NOT EXISTS model_defaults (owner TEXT PRIMARY KEY, connection_id TEXT);`);
  return database;
}
function transaction<T>(fn: () => T): T {
  const connection = database();
  connection.exec('BEGIN IMMEDIATE');
  try { const result = fn(); connection.exec('COMMIT'); return result; }
  catch (error) { connection.exec('ROLLBACK'); throw error; }
}
function row(owner: string, id: string): Row | undefined {
  return database().prepare('SELECT * FROM model_connections WHERE owner = ? AND id = ?').get(owner, id) as Row | undefined;
}
function metadata(value: Row): ModelConnection { return JSON.parse(value.state) as ModelConnection; }
export function listSettings(owner: string) {
  const connections = (database().prepare('SELECT * FROM model_connections WHERE owner = ? ORDER BY rowid').all(owner) as Row[]).map(metadata);
  const selected = database().prepare('SELECT connection_id FROM model_defaults WHERE owner = ?').get(owner) as { connection_id: string | null } | undefined;
  return { connections, defaultId: selected?.connection_id ?? null, environmentConfigured: Boolean(environmentConnection()), recentFailures: recentModelFailures(owner) };
}
export function getRuntime(owner: string, id: string): RuntimeConnection {
  const record = row(owner, id);
  if (!record) throw new Error('模型连接不存在或不属于当前会话。');
  const item = metadata(record);
  return { id, revision: item.revision, name: item.name, provider: item.provider, protocol: item.protocol,
    baseUrl: item.baseUrl, modelId: item.modelId, contextWindow: item.contextWindow, maxTokens: item.maxTokens,
    apiKey: record.secret ? decryptSecret(record.secret, `model:${owner}:${id}`) : '' };
}
export function getDefaultRuntime(owner: string) {
  const id = listSettings(owner).defaultId;
  return id ? getRuntime(owner, id) : null;
}
export function saveConnection(owner: string, value: unknown, id?: string, expectedRevision?: number, options: { allowDuplicate?: boolean; makeDefault?: boolean } = {}): ModelConnection {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new Error('请检查连接名称、服务商、协议、模型 ID 和长度设置。');
  const input = parsed.data;
  if (input.baseUrl) input.baseUrl = validateModelEndpoint(input.baseUrl);
  if (input.keyAction === 'replace' && !input.apiKey) throw new Error('请填写新的 API Key。');
  return transaction(() => {
    const previous = id ? row(owner, id) : undefined;
    if (id && !previous) throw new Error('模型连接不存在或不属于当前会话。');
    const old = previous ? metadata(previous) : undefined;
    if (old && old.revision !== expectedRevision) throw new Error('配置已在其他页面修改，请刷新后重试。');
    const peers = listSettings(owner).connections.filter(item => item.id !== id);
    const matching = peers.find(item => sameModelTarget(item, input));
    const nameChanged = !old || connectionName(old.name) !== connectionName(input.name);
    if (nameChanged && peers.some(item => connectionName(item.name) === connectionName(input.name))) throw new Error('已有同名连接，请编辑已有项或使用清晰不同的连接名称。');
    // Legacy duplicate entries may still be repaired in place; never silently
    // merge, delete, switch defaults or compare decrypted API keys.
    if (matching && (!old || !sameModelTarget(old, input)) && !options.allowDuplicate) throw new Error('相同接口、协议和模型已配置，请编辑已有连接；不同账户请使用不同名称并明确确认另建。');
    if (!id && listSettings(owner).connections.length >= 10) throw new Error('最多保存 10 个模型连接。');
    const connectionId = id || randomUUID();
    const secret = input.keyAction === 'clear' ? '' : input.keyAction === 'replace'
      ? encryptSecret(input.apiKey!, `model:${owner}:${connectionId}`) : previous?.secret || '';
    const now = new Date().toISOString();
    const item: ModelConnection = {
      id: connectionId, name: input.name, provider: input.provider, protocol: input.protocol,
      baseUrl: input.baseUrl, modelId: input.modelId, contextWindow: input.contextWindow, maxTokens: input.maxTokens,
      revision: (old?.revision || 0) + 1, hasKey: Boolean(secret), keyHint: secret ? '已保存' : '',
      createdAt: old?.createdAt || now, updatedAt: now,
    };
    database().prepare('INSERT INTO model_connections (id, owner, state, secret) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, secret = excluded.secret')
      .run(connectionId, owner, JSON.stringify(item), secret);
    if (options.makeDefault || !id && listSettings(owner).connections.length === 1) setDefault(owner, connectionId);
    return item;
  });
}
export function setDefault(owner: string, id: string | null) {
  if (id && !row(owner, id)) throw new Error('模型连接不存在或不属于当前会话。');
  database().prepare('INSERT INTO model_defaults (owner, connection_id) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET connection_id = excluded.connection_id').run(owner, id);
}
export function deleteConnection(owner: string, id: string, revision: number) {
  transaction(() => {
    const record = row(owner, id);
    if (!record || metadata(record).revision !== revision) throw new Error('配置不存在或已更新，请刷新后重试。');
    database().prepare('DELETE FROM model_connections WHERE id = ? AND owner = ?').run(id, owner);
    database().prepare('UPDATE model_defaults SET connection_id = NULL WHERE owner = ? AND connection_id = ?').run(owner, id);
  });
}
export function recordTest(owner: string, id: string, revision: number, result: ConnectionTestResult) {
  return transaction(() => {
    const record = row(owner, id);
    if (!record || metadata(record).revision !== revision) throw new Error('测试期间配置已更新，请重新测试。');
    const item = metadata(record);
    item.test = { ...result, testedAt: new Date().toISOString() };
    database().prepare('UPDATE model_connections SET state = ? WHERE id = ? AND owner = ?').run(JSON.stringify(item), id, owner);
    return item;
  });
}
