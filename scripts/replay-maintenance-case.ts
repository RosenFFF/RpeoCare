/** Public, model-free replay of an explicitly known historical PR. */
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { maintenanceTestPlan } from '../src/server/workbench/maintenance-verification';
import { assertReadableSource } from '../src/server/agent/repository';

function main() {
  const prepareOnly = process.argv.includes('--prepare-only');
  if (!prepareOnly && (!process.argv.includes('--reviewed') || !process.argv.includes('--allow-network'))) throw new Error('Read the case and checks first; execution requires --reviewed --allow-network.');
  const info = JSON.parse(readFileSync('evaluation/cattrs-800/case.json', 'utf8'));
  const checks = readFileSync('evaluation/cattrs-800/checks.py', 'utf8');
  if (createHash('sha256').update(checks).digest('hex') !== info.checkSha256) throw new Error('The published checks have changed; review their fingerprint.');
  if (info.repoUrl !== 'https://github.com/python-attrs/cattrs' || ![info.baseSha, info.headSha].every((sha: string) => /^[a-f0-9]{40}$/.test(sha)) || info.productionPath !== 'src/cattrs/disambiguators.py') throw new Error('Unsupported historical case.');
  const root = resolve('data', `public-replay-${randomUUID()}`), source = join(root, 'source');
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['-c', 'core.longpaths=true', 'clone', '--filter=blob:none', '--no-checkout', '--', info.repoUrl, source], { stdio: 'pipe', windowsHide: true, timeout: 120000 });
  for (const sha of [info.baseSha, info.headSha]) execFileSync('git', ['-C', source, 'fetch', '--depth=1', 'origin', sha], { stdio: 'pipe', windowsHide: true, timeout: 120000 });
  const production = execFileSync('git', ['-C', source, 'show', `${info.headSha}:${info.productionPath}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 25000 });
  assertReadableSource(production);
  if (Buffer.byteLength(production) > 20000) throw new Error('Historical production file exceeds the supported bound.');
  const path = 'test_repocare_public_acceptance.py';
  const requirements = [{ text: 'Default factories must behave equivalently for dataclasses and attrs.', quote: 'Historical PR #800 behavior, see case.json source links.', command: `python3 -m pytest ${path}::${info.targetNode} -q`, failureSignal: info.failureSignal, changedPaths: [info.productionPath] }];
  const plan = maintenanceTestPlan({ requirements, regressionCommands: [`python3 -m pytest ${path}::${info.normalNode} -q`], setupCommands: ['python3 -m pip install --target .repocare-python --no-compile --group test', 'python3 -m pip install --target .repocare-python --no-compile --no-build-isolation .'], scopeLimitations: info.limits });
  const manifests = ['baseline', 'patched'].map(role => {
    const value = { repoUrl: info.repoUrl, branch: 'main', commitSha: info.baseSha, expected: role === 'baseline' ? 'not-reproduced' : 'reproduced', plan: { ...plan, setup: [...plan.setup, { type: 'create-file', path, content: checks }, ...(role === 'patched' ? [{ type: 'create-file', path: info.productionPath, content: production }] : [])] } };
    const destination = join(root, `${role}.json`); writeFileSync(destination, JSON.stringify(value, null, 2)); return destination;
  });
  writeFileSync(join(root, 'source.json'), JSON.stringify({ ...info, generatedAt: new Date().toISOString(), productionSha256: createHash('sha256').update(production).digest('hex'), modelInvoked: false, attemptsPerVersion: 1 }, null, 2));
  console.log(`Prepared public historical replay: ${root}`);
  if (!prepareOnly) for (const manifest of manifests) execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/accept-python-preparation.ts'), manifest, '--reviewed', '--allow-network'], { stdio: 'inherit', windowsHide: true, timeout: 600000 });
}
try { main(); } catch { console.error('Public replay did not finish. Preserve its data directory and inspect source/preparation failures; no model is called.'); process.exitCode = 1; }
