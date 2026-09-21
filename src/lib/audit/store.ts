import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nodeDefinitions, isTerminal, type AuditRun } from './types';
import { decryptSecret, encryptSecret } from '../models/crypto';
import type { RuntimeConnection } from '../models/types';

let database: DatabaseSync | undefined;
export function db() {
  if (database) return database;
  const path = resolve(/* turbopackIgnore: true */ process.env.REPOCARE_DB_PATH || 'data/repocare.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, state TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_owner_created ON audit_runs(owner, created_at);
    CREATE TABLE IF NOT EXISTS audit_worker (id TEXT PRIMARY KEY, owner TEXT NOT NULL, heartbeat INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_run_models (run_id TEXT PRIMARY KEY, encrypted_config TEXT NOT NULL);`);
  return database;
}

function transaction<T>(fn: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const result = fn(); db().exec('COMMIT'); return result; }
  catch (error) { db().exec('ROLLBACK'); throw error; }
}

function decode(row: unknown): AuditRun | undefined {
  return row ? JSON.parse((row as { state: string }).state) as AuditRun : undefined;
}

export function getRun(id: string, owner?: string): AuditRun | undefined {
  return decode(owner
    ? db().prepare('SELECT state FROM audit_runs WHERE id = ? AND owner = ?').get(id, owner)
    : db().prepare('SELECT state FROM audit_runs WHERE id = ?').get(id));
}

export function listRuns(owner: string, limit = 8): AuditRun[] {
  return db().prepare('SELECT state FROM audit_runs WHERE owner = ? ORDER BY created_at DESC LIMIT ?')
    .all(owner, Math.max(1, Math.min(limit, 20))).map(row => decode(row)!);
}

function persist(run: AuditRun) {
  run.updatedAt = new Date().toISOString();
  run.seq += 1;
  db().prepare('UPDATE audit_runs SET status = ?, state = ? WHERE id = ?').run(run.status, JSON.stringify(run), run.id);
  if (isTerminal(run.status)) db().prepare('DELETE FROM audit_run_models WHERE run_id = ?').run(run.id);
  return run;
}

export function updateRun(id: string, change: (run: AuditRun) => void): AuditRun {
  return transaction(() => {
    const run = getRun(id);
    if (!run) throw new Error('任务不存在。');
    change(run);
    return persist(run);
  });
}

export function createRun(owner: string, repoUrl: string, retryOf?: string, connection?: RuntimeConnection | null): AuditRun {
  return transaction(() => {
    const active = db().prepare("SELECT COUNT(*) AS n FROM audit_runs WHERE owner = ? AND status IN ('queued', 'running')").get(owner) as { n: number };
    if (active.n >= 2) throw new Error('已有两个待完成任务，请等待完成或取消后再试。');
    const queued = db().prepare("SELECT COUNT(*) AS n FROM audit_runs WHERE status IN ('queued', 'running')").get() as { n: number };
    if (queued.n >= 20) throw new Error('体检队列已满，请稍后重试。');
    const recent = db().prepare('SELECT COUNT(*) AS n FROM audit_runs WHERE owner = ? AND created_at > ?')
      .get(owner, new Date(Date.now() - 3600_000).toISOString()) as { n: number };
    if (recent.n >= 30) throw new Error('本小时体检次数已达到上限，请稍后重试。');
    const now = new Date().toISOString();
    const run: AuditRun = {
      id: randomUUID(), repoUrl, status: 'queued', createdAt: now, updatedAt: now,
      seq: 1, cancelRequested: false, retryOf,
      nodes: nodeDefinitions.map(node => ({ ...node, status: 'pending', message: '等待执行' })),
      ...(connection ? { model: {
        connectionId: connection.id, name: connection.name, provider: connection.provider,
        protocol: connection.protocol, modelId: connection.modelId, revision: connection.revision,
        source: connection.id === 'environment' ? 'environment' as const : 'settings' as const,
      }, agentEvents: [] } : {}),
    };
    db().prepare('INSERT INTO audit_runs (id, owner, status, created_at, state) VALUES (?, ?, ?, ?, ?)')
      .run(run.id, owner, run.status, now, JSON.stringify(run));
    if (connection) db().prepare('INSERT INTO audit_run_models (run_id, encrypted_config) VALUES (?, ?)')
      .run(run.id, encryptSecret(JSON.stringify(connection), `audit-run:${run.id}`));
    return run;
  });
}

/** Worker-only snapshot. Credentials are never included in public run state. */
export function getRunConnection(id: string): RuntimeConnection | null {
  const run = getRun(id);
  if (!run?.model || isTerminal(run.status)) return null;
  const row = db().prepare('SELECT encrypted_config FROM audit_run_models WHERE run_id = ?').get(id) as { encrypted_config: string } | undefined;
  if (!row) throw new Error('本次任务的模型配置快照不可用，请重新体检。');
  try { return JSON.parse(decryptSecret(row.encrypted_config, `audit-run:${id}`)) as RuntimeConnection; }
  catch { throw new Error('无法解密本次任务的模型配置，请检查服务端主密钥。'); }
}

export function cancelRun(id: string): AuditRun {
  return updateRun(id, run => {
    if (isTerminal(run.status)) return;
    run.cancelRequested = true;
    run.status = 'cancelled';
    run.nodes.forEach(node => {
      if (node.status === 'pending' || node.status === 'running') {
        node.status = 'cancelled'; node.message = '已取消'; node.finishedAt = new Date().toISOString();
      }
    });
  });
}

const leaseDuration = 30_000;
export function workerOnline() {
  const row = db().prepare("SELECT heartbeat FROM audit_worker WHERE id = 'audit'").get() as { heartbeat: number } | undefined;
  return Boolean(row && Date.now() - row.heartbeat < leaseDuration);
}

export function acquireWorker(owner: string): boolean {
  return transaction(() => {
    if (workerOnline()) return false;
    db().prepare("INSERT INTO audit_worker (id, owner, heartbeat) VALUES ('audit', ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, heartbeat = excluded.heartbeat")
      .run(owner, Date.now());
    for (const row of db().prepare("SELECT state FROM audit_runs WHERE status = 'running'").all()) {
      const run = decode(row)!;
      run.status = 'failed';
      run.error = '上次执行进程已中断。已有记录已保留，请重新体检。';
      run.nodes.forEach(node => {
        if (node.status === 'running') { node.status = 'failed'; node.message = run.error!; node.finishedAt = new Date().toISOString(); }
        else if (node.status === 'pending') { node.status = 'skipped'; node.message = '上游执行中断'; }
      });
      persist(run);
    }
    return true;
  });
}

export function heartbeat(owner: string): boolean {
  return Number(db().prepare("UPDATE audit_worker SET heartbeat = ? WHERE id = 'audit' AND owner = ?").run(Date.now(), owner).changes) === 1;
}
export function releaseWorker(owner: string) { db().prepare("DELETE FROM audit_worker WHERE id = 'audit' AND owner = ?").run(owner); }

export function claimRun(owner: string): AuditRun | undefined {
  return transaction(() => {
    const lease = db().prepare("SELECT owner, heartbeat FROM audit_worker WHERE id = 'audit'").get() as { owner: string; heartbeat: number } | undefined;
    if (!lease || lease.owner !== owner || Date.now() - lease.heartbeat >= leaseDuration) return;
    const run = decode(db().prepare("SELECT state FROM audit_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get());
    if (!run) return;
    run.status = 'running';
    return persist(run);
  });
}
