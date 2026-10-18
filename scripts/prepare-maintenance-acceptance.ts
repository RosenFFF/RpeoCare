/** Review-only entry point for a separate human acceptance pair in an isolated pilot. */
import { loadEnvConfig } from '@next/env';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';

async function main() {
  if (!process.argv.includes('--reviewed')) throw new Error('Review test code, source and selectors before passing --reviewed.');
  loadEnvConfig(process.cwd());
  const root = realpathSync(resolve(process.argv[2])), inside = relative(realpathSync(resolve('data')), root);
  if (!inside.startsWith('model-pilot-') || inside.includes('/') || inside.includes('\\') || isAbsolute(inside)) throw new Error('Only an isolated pilot is supported.');
  const pilot = JSON.parse(readFileSync(join(root, 'pilot.json'), 'utf8'));
  const taskId = pilot.rows.find((row: { variant: string }) => row.variant === 'repocare')?.task.id;
  process.env.REPOCARE_DB_PATH = join(root, 'pilot.sqlite');
  const { getTask } = await import('../src/server/agent/store');
  const { prepareAcceptance } = await import('../src/server/agent/acceptance');
  const { db } = await import('../src/server/audit/store');
  try {
    const task = getTask('pilot', taskId), artifact = task?.artifacts.find(a => a.kind === 'verification' && !a.superseded);
    if (!task || !artifact?.verification) throw new Error('Current verification is unavailable.');
    const proposal = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
    const result = prepareAcceptance('pilot', task.id, { ...proposal, updatedAt: task.updatedAt, artifactId: artifact.id, fingerprint: artifact.verification.fingerprint });
    writeFileSync(join(root, `acceptance-${result.artifacts.at(-1)!.id}.json`), JSON.stringify({ task: result }, null, 2));
    console.log(JSON.stringify({ kind: result.artifacts.at(-1)!.kind, status: 'awaiting-confirmation', executed: false }));
  } finally { db().close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Acceptance preparation failed.'); process.exitCode = 1; });
