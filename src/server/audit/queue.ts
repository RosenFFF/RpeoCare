import { db, getRun, updateRun } from './store';
import type { AuditRun } from '@/contracts/audit';

const leaseMs = 45_000;
function database() {
  const database = db();
  database.exec(`CREATE TABLE IF NOT EXISTS worker_pool (id TEXT PRIMARY KEY, heartbeat INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS run_leases (run_id TEXT PRIMARY KEY, worker TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);`);
  return database;
}
export function pulseWorker(id: string) {
  const store = database(), now = Date.now();
  store.prepare('INSERT INTO worker_pool VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat').run(id, now);
  store.prepare('UPDATE run_leases SET expires=? WHERE worker=?').run(now + leaseMs, id);
}
export function poolOnline() {
  return !!database().prepare('SELECT id FROM worker_pool WHERE heartbeat>? LIMIT 1').get(Date.now() - leaseMs);
}
export function ownsTask(worker: string, runId: string) {
  return !!database().prepare('SELECT run_id FROM run_leases WHERE worker=? AND run_id=? AND expires>?').get(worker, runId, Date.now());
}
export function claimTask(worker: string): AuditRun | undefined {
  const store = database(), now = Date.now(); store.exec('BEGIN IMMEDIATE');
  try {
    const stale = store.prepare("SELECT a.id, a.state, l.attempts FROM audit_runs a LEFT JOIN run_leases l ON l.run_id=a.id WHERE a.status='running' AND (l.run_id IS NULL OR l.expires<?)").all(now) as { id: string; state: string; attempts: number | null }[];
    for (const item of stale) {
      const run: AuditRun = JSON.parse(item.state);
      if ((item.attempts || 0) >= 3) { run.status = 'failed'; run.error = '执行服务连续中断 3 次，请检查服务后手动重试。'; run.nodes.forEach(node => { if (node.status === 'running' || node.status === 'pending') { node.status = 'failed'; node.message = run.error!; } }); store.prepare('DELETE FROM audit_run_models WHERE run_id=?').run(run.id); }
      else { run.status = 'queued'; run.error = undefined; run.nodes.forEach(node => { if (node.status === 'running') { node.status = 'pending'; node.message = '服务恢复后将从已保存的快照继续'; } }); }
      run.seq++; run.updatedAt = new Date().toISOString();
      store.prepare('UPDATE audit_runs SET status=?, state=? WHERE id=?').run(run.status, JSON.stringify(run), run.id);
      store.prepare('UPDATE run_leases SET worker=?, expires=0 WHERE run_id=?').run('', run.id);
    }
    const row = store.prepare("SELECT id FROM audit_runs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    if (!row) { store.exec('COMMIT'); return; }
    const run = getRun(row.id)!; run.status = 'running'; run.seq++; run.updatedAt = new Date().toISOString();
    store.prepare('UPDATE audit_runs SET status=?, state=? WHERE id=?').run(run.status, JSON.stringify(run), run.id);
    store.prepare('INSERT INTO run_leases VALUES (?, ?, ?, 1) ON CONFLICT(run_id) DO UPDATE SET worker=excluded.worker, expires=excluded.expires, attempts=run_leases.attempts+1').run(run.id, worker, now + leaseMs);
    store.exec('COMMIT'); return run;
  } catch (error) { store.exec('ROLLBACK'); throw error; }
}
export function releaseTask(worker: string, runId: string) { database().prepare('DELETE FROM run_leases WHERE run_id=? AND worker=?').run(runId, worker); }
export function stopWorker(worker: string) {
  database().prepare('DELETE FROM worker_pool WHERE id=?').run(worker);
  database().prepare('UPDATE run_leases SET expires=0 WHERE worker=?').run(worker);
}
export function resumeInterrupted(id: string) {
  updateRun(id, run => { if (run.status !== 'running') return; run.status = 'queued'; run.error = undefined; run.nodes.forEach(node => { if (node.status === 'running') { node.status = 'pending'; node.message = '等待恢复执行'; } }); });
}
