import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { claimTask, pulseWorker, releaseTask, stopWorker } from '../src/server/audit/queue';
import { executeRun } from '../src/server/audit/runner';
loadEnvConfig(process.cwd());
const controller = new AbortController(), identity = randomUUID();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
async function main() {
  pulseWorker(identity);
  const timer = setInterval(() => { try { pulseWorker(identity); } catch { controller.abort(); } }, 5000);
  console.log('[audit-worker] Ready. Snapshot checkpoints and shared-database worker pool enabled.');
  try {
    while (!controller.signal.aborted) {
      const run = claimTask(identity);
      if (!run) { await delay(500, undefined, { signal: controller.signal }).catch(() => {}); continue; }
      console.log(JSON.stringify({ event: 'audit_started', runId: run.id }));
      await executeRun(run.id, controller.signal, identity);
      releaseTask(identity, run.id);
      console.log(JSON.stringify({ event: 'audit_finished', runId: run.id }));
    }
  } finally { clearInterval(timer); stopWorker(identity); }
}
main().catch(() => { console.error('[audit-worker] Unexpected failure. Restart to recover queued tasks.'); process.exitCode = 1; });
