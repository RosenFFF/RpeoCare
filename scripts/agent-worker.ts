import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { claimTask, pulseWorker, stopWorker } from '../src/server/agent/store';
import { executeMaintenance } from '../src/server/agent/runtime';
import { claimReviewBlock, pulseReviewWorker, releaseReviewWorker } from '../src/server/workbench/review-task-store';
import { executeReviewBlock } from '../src/server/workbench/review-worker';
loadEnvConfig(process.cwd());
const controller = new AbortController(), identity = randomUUID();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
async function main() {
    pulseWorker(identity);
    const heartbeat = setInterval(() => { try {
        pulseWorker(identity);
        pulseReviewWorker(identity);
    }
    catch {
        controller.abort();
    } }, 5000);
    console.log('[agent-worker] Ready. Maintenance sessions use commit-pinned read tools and local proposals.');
    try {
        while (!controller.signal.aborted) {
            try {
                const review = claimReviewBlock(identity);
                if (review) { await executeReviewBlock(review, controller.signal); }
                if (controller.signal.aborted) break;
                const claim = claimTask(identity);
                if (claim) {
                    await executeMaintenance(claim, controller.signal);
                    continue;
                }
            }
            catch {
                console.error('[agent-worker] Task unavailable; saved state is retained.');
            }
            await delay(750, undefined, { signal: controller.signal }).catch(() => { });
        }
    }
    finally {
        clearInterval(heartbeat);
        stopWorker(identity);
        releaseReviewWorker(identity);
    }
}
main().catch(() => { console.error('[agent-worker] Startup failed. Check database and model configuration.'); process.exitCode = 1; });
