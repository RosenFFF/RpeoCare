import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { claimReproduction, pulseReproductionWorker, releaseReproduction, stopReproductionWorker } from '../src/server/reproduction/queue';
import { executeReproduction } from '../src/server/reproduction/executor';

loadEnvConfig(process.cwd());
const controller = new AbortController();
const identity = randomUUID();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

async function main() {
  pulseReproductionWorker(identity);
  const timer = setInterval(() => { try { pulseReproductionWorker(identity); } catch { controller.abort(); } }, 5000);
  console.log('[reproduction-worker] Ready. Untrusted repository code will only run in the configured Docker sandbox.');
  try {
    while (!controller.signal.aborted) {
      const claimed = claimReproduction(identity);
      if (!claimed) { await delay(750, undefined, { signal: controller.signal }).catch(() => {}); continue; }
      console.log(JSON.stringify({ event: 'reproduction_started', jobId: claimed.job.id }));
      await executeReproduction(claimed.owner, claimed.job, identity);
      releaseReproduction(identity, claimed.job.id);
      console.log(JSON.stringify({ event: 'reproduction_finished', jobId: claimed.job.id }));
    }
  } finally { clearInterval(timer); stopReproductionWorker(identity); }
}
main().catch(error => { console.error('[reproduction-worker] Unexpected failure.', error instanceof Error ? error.message : error); process.exitCode = 1; });
