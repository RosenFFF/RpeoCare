import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireWorker, heartbeat, claimRun, releaseWorker } from '../src/lib/audit/store';
import { executeRun } from '../src/lib/audit/runner';

loadEnvConfig(process.cwd());
const controller = new AbortController();
const identity = randomUUID();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

async function main() {
  let waiting = false;
  while (!controller.signal.aborted && !acquireWorker(identity)) {
    if (!waiting) console.log('[audit-worker] Waiting for the active worker lease. Queued tasks remain saved.');
    waiting = true;
    await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
  }
  if (controller.signal.aborted) return;
  console.log('[audit-worker] Ready. Public repository audits run read-only.');
  const pulse = setInterval(() => {
    try { if (!heartbeat(identity)) controller.abort(); }
    catch { controller.abort(); }
  }, 5000);
  try {
    while (!controller.signal.aborted) {
      const run = claimRun(identity);
      if (run) {
        console.log(`[audit-worker] Starting ${run.id}`);
        await executeRun(run.id, controller.signal);
        console.log(`[audit-worker] Finished ${run.id}`);
      } else await delay(500, undefined, { signal: controller.signal }).catch(() => {});
    }
  } finally { clearInterval(pulse); releaseWorker(identity); }
}
main().catch(() => { console.error('[audit-worker] Worker stopped unexpectedly. Restart to recover queued tasks.'); process.exitCode = 1; });
