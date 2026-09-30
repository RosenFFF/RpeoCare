import type { ReproductionJob } from '@/contracts/workbench';
import { workbenchDb } from '@/server/workbench/store';

export interface ClaimedReproduction { owner: string; job: ReproductionJob }

export function pulseReproductionWorker(id: string) {
  workbenchDb().prepare('INSERT INTO reproduction_workers VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat').run(id, Date.now());
}

export function reproductionWorkerOnline() {
  const row = workbenchDb().prepare('SELECT COUNT(*) AS n FROM reproduction_workers WHERE heartbeat > ?').get(Date.now() - 15_000) as { n: number };
  return row.n > 0;
}

export function claimReproduction(worker: string, leaseMs = 180_000): ClaimedReproduction | null {
  const database = workbenchDb();
  const now = Date.now();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM reproduction_workers WHERE heartbeat < ?').run(now - 60_000);
    const stale = database.prepare("SELECT j.id, j.owner, j.state, COALESCE(l.attempts, 0) AS attempts FROM reproduction_jobs j LEFT JOIN reproduction_leases l ON l.job_id=j.id WHERE j.status='running' AND COALESCE(l.expires,0) < ?").all(now) as { id: string; owner: string; state: string; attempts: number }[];
    for (const row of stale) {
      const job = JSON.parse(row.state) as ReproductionJob;
      if (row.attempts >= 3) {
        job.status = 'failed'; job.result = 'failed'; job.error = '复现执行服务连续中断 3 次。'; job.finishedAt = new Date().toISOString();
      } else {
        job.status = 'queued'; job.progress = '执行服务恢复后将重新开始隔离复现';
      }
      job.updatedAt = new Date().toISOString();
      database.prepare('UPDATE reproduction_jobs SET status=?, state=?, updated_at=? WHERE id=?').run(job.status, JSON.stringify(job), job.updatedAt, job.id);
      database.prepare('UPDATE reproduction_leases SET worker=?, expires=0 WHERE job_id=?').run('', job.id);
    }
    const row = database.prepare("SELECT id, owner, state FROM reproduction_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as { id: string; owner: string; state: string } | undefined;
    if (!row) { database.exec('COMMIT'); return null; }
    const job = JSON.parse(row.state) as ReproductionJob;
    job.status = 'running'; job.phase = 'source'; job.progress = '正在准备固定版本的隔离工作区'; job.startedAt ||= new Date().toISOString(); job.updatedAt = new Date().toISOString();
    database.prepare('UPDATE reproduction_jobs SET status=?, state=?, updated_at=? WHERE id=?').run(job.status, JSON.stringify(job), job.updatedAt, job.id);
    database.prepare('INSERT INTO reproduction_leases VALUES (?, ?, ?, 1) ON CONFLICT(job_id) DO UPDATE SET worker=excluded.worker, expires=excluded.expires, attempts=reproduction_leases.attempts+1').run(job.id, worker, now + leaseMs);
    database.exec('COMMIT');
    return { owner: row.owner, job };
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function renewReproductionLease(worker: string, jobId: string, leaseMs = 180_000) {
  workbenchDb().prepare('UPDATE reproduction_leases SET expires=? WHERE job_id=? AND worker=?').run(Date.now() + leaseMs, jobId, worker);
}

export function releaseReproduction(worker: string, jobId: string) {
  workbenchDb().prepare('DELETE FROM reproduction_leases WHERE job_id=? AND worker=?').run(jobId, worker);
}

export function stopReproductionWorker(worker: string) {
  const database = workbenchDb();
  database.prepare('DELETE FROM reproduction_workers WHERE id=?').run(worker);
  database.prepare('UPDATE reproduction_leases SET expires=0 WHERE worker=?').run(worker);
}
