/** Explicit continuation of an isolated pilot checkpoint. Does not confirm execution or publish. */
import { loadEnvConfig } from '@next/env';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { maintenancePilotSource, pilotBlobReplay } from './lib/maintenance-pilot-source';

async function main() {
  loadEnvConfig(process.cwd());
  const dataRoot = realpathSync(resolve('data')), root = realpathSync(resolve(process.argv[2]));
  const inside = relative(dataRoot, root);
  if (!inside.startsWith('model-pilot-') || inside.includes('/') || inside.includes('\\') || isAbsolute(inside)) throw new Error('Only a local isolated model pilot may be continued.');
  const previous = JSON.parse(readFileSync(join(root, 'pilot.json'), 'utf8'));
  const taskId = previous.rows.find((row: { variant: string }) => row.variant === 'repocare')?.task.id;
  if (!taskId) throw new Error('No RepoCare task in this pilot.');
  const content = readFileSync(resolve(process.argv[3]), 'utf8');
  if (!content.trim() || content.length > 6000) throw new Error('Continuation note must contain at most 6000 characters.');
  const snapshotFlag = process.argv.find(value => value.startsWith('--snapshot='));
  if (snapshotFlag) {
    const source = maintenancePilotSource(JSON.parse(readFileSync(resolve(snapshotFlag.slice(11)), 'utf8')));
    const original = previous.rows.find((row: { variant: string }) => row.variant === 'repocare').task;
    if (source.revision !== original.commitSha || source.repoUrl !== original.repoUrl || source.number !== original.number) throw new Error('Continuation source must match the original pinned task.');
    globalThis.fetch = pilotBlobReplay(source).fetch;
  }
  const originalDb = resolve(process.env.REPOCARE_DB_PATH || 'data/repocare.sqlite');
  if (!process.env.REPOCARE_MASTER_KEY) process.env.REPOCARE_MASTER_KEY = readFileSync(join(dirname(originalDb), '.model-key')).toString('hex');
  process.env.REPOCARE_DB_PATH = join(root, 'pilot.sqlite');
  const { mutateTask, claimTask, saveClaim, pulseWorker, getTask } = await import('../src/server/agent/store');
  const { executeMaintenance } = await import('../src/server/agent/runtime');
  const { db } = await import('../src/server/audit/store');
  mutateTask('pilot', taskId, 'message', content);
  const claim = claimTask('pilot-continuation');
  if (!claim || claim.task.id !== taskId) throw new Error('The requested isolated checkpoint was not claimed.');
  claim.connection.maxTokens = 8192;
  claim.task.budget.maxTurns = Math.min(96, claim.task.budget.turns + 8);
  claim.task.budget.maxTools = Math.min(192, claim.task.budget.tools + 16); saveClaim(claim);
  const heartbeat = setInterval(() => pulseWorker(claim.worker), 5000);
  const started = Date.now();
  try { await executeMaintenance(claim, new AbortController().signal); }
  finally { clearInterval(heartbeat); }
  const task = getTask('pilot', taskId)!;
  const path = join(root, `continuation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(path, JSON.stringify({ wallMs: Date.now() - started, task }, null, 2));
  console.log(JSON.stringify({ status: task.status, calls: task.budget.turns, artifacts: task.artifacts.map(artifact => artifact.kind), evidence: path }));
  db().close();
}
main().catch(() => { console.error('Isolated pilot continuation failed; no credentials or provider error text printed.'); process.exitCode = 1; });
