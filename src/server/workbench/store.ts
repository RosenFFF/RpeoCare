import { randomUUID } from 'node:crypto';
import { db } from '../audit/store';
import type { RepoSnapshot } from '../../contracts/audit';
import type { ChatMessage, Draft, Project, Usage } from '../../contracts/workbench';

export function workbenchDb() {
  const database = db();
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (owner TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (run_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS drafts_owner ON drafts(owner);
    CREATE TABLE IF NOT EXISTS conversations (owner TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(owner, run_id));
    CREATE TABLE IF NOT EXISTS model_usage (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL, purpose TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, failed INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operation_locks (key TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  `);
  return database;
}
export function getProject(owner: string): Project | null {
  const row = workbenchDb().prepare('SELECT state FROM projects WHERE owner = ?').get(owner) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}
export function saveProject(owner: string, project: Omit<Project, 'updatedAt'>) {
  const value = { ...project, updatedAt: new Date().toISOString() };
  workbenchDb().prepare('INSERT INTO projects VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state').run(owner, JSON.stringify(value));
  return value;
}
export function saveSnapshot(runId: string, snapshot: RepoSnapshot) {
  workbenchDb().prepare('INSERT INTO snapshots VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET state=excluded.state').run(runId, JSON.stringify(snapshot));
}
export function getSnapshot(runId: string): RepoSnapshot | null {
  const row = workbenchDb().prepare('SELECT state FROM snapshots WHERE run_id=?').get(runId) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}
export function getDraft(owner: string, id: string): Draft {
  const row = workbenchDb().prepare('SELECT state FROM drafts WHERE owner=? AND id=?').get(owner, id) as { state: string } | undefined;
  if (!row) throw new Error('草稿不存在或不属于当前账户。');
  const draft: Draft = JSON.parse(row.state);
  if (draft.status === 'publishing' && !workbenchDb().prepare('SELECT key FROM operation_locks WHERE key=? AND expires>?').get(`${owner}:publish:${id}`, Date.now())) return { ...draft, status: 'uncertain' };
  return draft;
}
export function listDrafts(owner: string): Draft[] {
  return (workbenchDb().prepare('SELECT id FROM drafts WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner) as { id: string }[]).map(row => getDraft(owner, row.id));
}
export function createDraft(owner: string, input: Omit<Draft, 'id' | 'revision' | 'status' | 'createdAt'>): Draft {
  const draft: Draft = { ...input, id: randomUUID(), revision: 1, status: 'draft', createdAt: new Date().toISOString() };
  workbenchDb().prepare('INSERT INTO drafts VALUES (?, ?, ?)').run(draft.id, owner, JSON.stringify(draft));
  return draft;
}
export function updateDraft(owner: string, id: string, revision: number, change: Partial<Pick<Draft, 'content' | 'status' | 'publishedUrl'>>): Draft {
  const database = workbenchDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const draft = getDraft(owner, id);
    if (draft.revision !== revision) throw new Error('草稿已变化，请刷新后重新审阅。');
    if (change.content !== undefined && draft.status !== 'draft') throw new Error('发布中或已发布的草稿不能编辑。');
    const next = { ...draft, ...change, revision: draft.revision + 1 };
    database.prepare('UPDATE drafts SET state=? WHERE id=? AND owner=?').run(JSON.stringify(next), id, owner);
    database.exec('COMMIT'); return next;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
export function getMessages(owner: string, runId: string): ChatMessage[] {
  const row = workbenchDb().prepare('SELECT state FROM conversations WHERE owner=? AND run_id=?').get(owner, runId) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : [];
}
export function saveMessages(owner: string, runId: string, messages: ChatMessage[]) {
  workbenchDb().prepare('INSERT INTO conversations VALUES (?, ?, ?) ON CONFLICT(owner,run_id) DO UPDATE SET state=excluded.state').run(owner, runId, JSON.stringify(messages.slice(-40)));
}
export function recordUsage(owner: string, purpose: string, input = 0, output = 0, failed = false) {
  workbenchDb().prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), owner, Date.now(), purpose, input, output, Number(failed));
}
export function usage(owner: string): Usage {
  const row = workbenchDb().prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(failed),0) AS failures FROM model_usage WHERE owner=?').get(owner);
  return row as unknown as Usage;
}
export async function withOperation<T>(owner: string, purpose: string, operation: () => Promise<T>): Promise<T> {
  const database = workbenchDb(), key = `${owner}:${purpose}`, now = Date.now();
  database.prepare('DELETE FROM operation_locks WHERE expires < ?').run(now);
  if (!database.prepare('INSERT OR IGNORE INTO operation_locks VALUES (?, ?)').run(key, now + 180_000).changes) throw new Error('当前操作正在执行，请勿重复提交。');
  try {
    const recent = database.prepare('SELECT COUNT(*) AS n FROM model_usage WHERE owner=? AND at>?').get(owner, now - 3600_000) as { n: number };
    if (recent.n >= 60) throw new Error('本小时模型请求已达 60 次，请稍后再试。');
    return await operation();
  } finally { database.prepare('DELETE FROM operation_locks WHERE key=?').run(key); }
}
