import { randomUUID } from 'node:crypto';
import type { ModelRequestDiagnostic, RuntimeConnection } from '../../contracts/models';
import { db } from '../audit/store';
import { modelFailure } from './failure';

function diagnosticDb() {
  const database = db();
  database.exec(`CREATE TABLE IF NOT EXISTS model_request_diagnostics (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS model_diagnostics_owner_at ON model_request_diagnostics(owner, at);`);
  return database;
}
export function recordModelFailure(owner: string, purpose: string, connection: RuntimeConnection, started: number, failure: ReturnType<typeof modelFailure>, status?: number) {
  const at = Date.now();
  const value: ModelRequestDiagnostic = {
    id: randomUUID(), at: new Date(at).toISOString(), purpose: purpose.slice(0, 80),
    connectionId: connection.id, connectionRevision: connection.revision, protocol: connection.protocol,
    httpStatus: Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : undefined,
    durationMs: Math.max(0, at - started), category: failure.category, message: failure.message,
  };
  const database = diagnosticDb();
  database.prepare('INSERT INTO model_request_diagnostics VALUES (?, ?, ?, ?)').run(value.id, owner, at, JSON.stringify(value));
  // Bounded local diagnostics; no headers, URLs, provider body, prompts, keys or reasoning.
  database.prepare('DELETE FROM model_request_diagnostics WHERE owner=? AND id NOT IN (SELECT id FROM model_request_diagnostics WHERE owner=? ORDER BY at DESC,rowid DESC LIMIT 50)').run(owner, owner);
  return value;
}
export function recentModelFailures(owner: string): ModelRequestDiagnostic[] {
  return (diagnosticDb().prepare('SELECT state FROM model_request_diagnostics WHERE owner=? ORDER BY at DESC,rowid DESC LIMIT 5').all(owner) as { state: string }[]).map(row => JSON.parse(row.state) as ModelRequestDiagnostic);
}
