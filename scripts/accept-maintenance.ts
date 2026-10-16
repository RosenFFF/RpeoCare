/** Explicit Docker acceptance; never run as part of npm test or execute project code on the host. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { AgentArtifact, MaintenanceTask } from '../src/contracts/agent';
import type { GitItem, ReproductionJob, ReproductionPlan, VerificationStepResult } from '../src/contracts/workbench';
import { prepareMaintenanceVerification } from '../src/server/workbench/maintenance-verification';
import { assessVerification } from '../src/shared/lib/maintenance-verification';

type RunnerResult = { reproduced: boolean; failureKind?: string; error?: string; steps: VerificationStepResult[]; environment: Record<string, string>; durationMs: number };
const root = resolve('data', `acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(root, { recursive: true });
function exec(file: string, args: string[], timeout = 180000) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${file} failed: ${(result.stderr || result.error?.message || '').slice(-1000)}`);
  return result.stdout.trim();
}
const image = exec('docker', ['image', 'inspect', '--format', '{{.Id}}', process.env.REPOCARE_REPRO_IMAGE || 'repocare-repro-runner:local']);
const command = 'python3 -m pytest acceptance/test_contract.py::test_empty -q';
const regression = 'python3 -m pytest acceptance/test_contract.py::test_normal -q';
const testSource = `from value import size

def test_empty():
    assert size(None) == 0, 'EMPTY_EXPECTED'

def test_normal():
    assert size('abc') == 3, 'NORMAL_EXPECTED'
`;
const fixed = 'def size(value):\n    return 0 if value is None else len(value)\n';
const broken = "def size(value):\n    return -1 if value is None else len(value)\n";
const plan: ReproductionPlan = { mode: 'test', confidence: 'high', summary: 'Controlled acceptance', environment: { language: 'Python', dependencies: [] }, setup: [],
  steps: [{ type: 'run-test', command }, { type: 'run-test', command: regression }], oracle: { type: 'all-steps-pass', value: '0' }, expected: 'Selected commands pass', evidence: ['stdout', 'stderr', 'test-result'], risks: [], missingInformation: [], requiresHumanApproval: true };
const task = { id: 'controlled', kind: 'issue', commitSha: 'a'.repeat(40), sourceUpdatedAt: '2026-10-16T00:00:00Z' } as MaintenanceTask;
const item = { number: 1, body: 'Empty input must return zero.', updatedAt: task.sourceUpdatedAt } as GitItem;
const requirements = [{ text: 'Handle empty input', quote: item.body, command, failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }];

function run(directory: string, source: string, reviewed: ReproductionPlan, original?: string, phase = 'execution', network = 'none'): RunnerResult {
  const workspace = join(directory, 'workspace'), artifacts = join(directory, 'artifacts');
  mkdirSync(workspace, { recursive: true }); mkdirSync(artifacts, { recursive: true });
  if (original) copyFixture(original, workspace);
  else writeFileSync(join(workspace, 'value.py'), source);
  const planPath = join(directory, 'plan.json'); writeFileSync(planPath, JSON.stringify(reviewed, null, 2));
  const result = spawnSync('docker', ['run', '--rm', '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '256', '--memory', '2g', '--cpus', '2', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
    '-e', `REPRO_PHASE=${phase}`, '-e', 'REPRO_TIMEOUT_MS=60000', '-v', `${workspace.replaceAll('\\', '/')}:/workspace:rw`, '-v', `${artifacts.replaceAll('\\', '/')}:/artifacts:rw`, '-v', `${planPath.replaceAll('\\', '/')}:/input/plan.json:ro`, image],
  { encoding: 'utf8', windowsHide: true, timeout: 100000, maxBuffer: 2_000_000 });
  writeFileSync(join(directory, 'docker.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.error) throw result.error;
  return JSON.parse(readFileSync(join(artifacts, 'result.json'), 'utf8'));
}

function copyFixture(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    if (entry.isSymbolicLink()) throw new Error('Acceptance input must not contain symlinks.');
    const target = join(destination, entry.name), path = join(source, entry.name);
    if (entry.isDirectory()) copyFixture(path, target);
    else if (entry.isFile()) writeFileSync(target, readFileSync(path));
  }
}

const reports: unknown[] = [];
function compare(name: string, before: string, after: string, expected: string, customPlan = plan, tests = testSource, sourceDir?: string, customPatch?: AgentArtifact, customItem = item, customTask = task, customRequirements = requirements) {
  const patch: AgentArtifact = customPatch || { id: name, kind: 'patch', title: name, createdAt: task.sourceUpdatedAt!, evidenceIds: [], files: [
    { path: 'value.py', before, after, created: false }, { path: 'acceptance/test_contract.py', before: '', after: tests, created: true },
  ] };
  const prepared = prepareMaintenanceVerification({ task: customTask, item: customItem, patch, plan: customPlan, requirements: customRequirements, policyRevision: 1 });
  const context = prepared.verification; context.confirmedAt = new Date().toISOString(); context.confirmedRequirementIds = context.requirements.map(r => r.id);
  const jobs: ReproductionJob[] = [];
  for (const role of ['baseline', 'patched'] as const) {
    const history = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = run(join(root, name, role, String(attempt)), before, prepared[role], sourceDir);
      const environmentFingerprint = result.environment?.dependencies && result.environment.dependencies !== 'unavailable'
        ? createHash('sha256').update(JSON.stringify({ ...result.environment, image })).digest('hex') : undefined;
      history.push({ index: attempt, result: result.reproduced ? 'reproduced' : 'not-reproduced', steps: result.steps, environmentFingerprint, failureKind: result.failureKind });
    }
    const blocked = history.some(a => ['dependencies', 'collection', 'setup'].includes(a.failureKind || ''));
    jobs.push({ id: `${name}-${role}`, verificationRole: role, verification: context, commitSha: customTask.commitSha, totalAttempts: 3, attemptHistory: history,
      status: blocked ? 'blocked' : history.every(a => a.result === 'reproduced') ? 'reproduced' : 'not-reproduced' } as ReproductionJob);
  }
  const assessment = assessVerification(context, jobs);
  const report = { name, expected, actual: assessment.state, passed: assessment.state === expected, verification: context, assessment, jobs };
  reports.push(report); writeFileSync(join(root, 'results.json'), JSON.stringify({ image, createdAt: new Date().toISOString(), reports }, null, 2));
  console.log(`${name}: ${assessment.state} (expected ${expected})`); assert.equal(assessment.state, expected);
}

if (!process.argv.includes('--manifest-only') && !process.argv.includes('--dependency-only')) {
compare('valid-patch', broken, fixed, 'improved');
compare('invalid-patch', broken, broken.replace('return -1', 'return -2'), 'still-failing');
compare('normal-already-passes', fixed, fixed + '# harmless comment\n', 'not-demonstrated');
compare('environment-failure', broken, fixed, 'blocked', { ...plan, environment: { ...plan.environment, version: '0.0' } });
compare('missing-dependency', broken, fixed, 'blocked', plan, 'import repocare_missing_dependency_987654\n' + testSource);
compare('collection-error', broken, fixed, 'blocked', plan, 'this is invalid python !!!\n' + testSource);
compare('regression-failure', broken, 'def size(value):\n    return 0\n', 'inconclusive');
}

// Optional locally prepared historical manifest. It contains only public case inputs and candidate files.
const manifestPath = process.argv.slice(2).find(value => !value.startsWith('--'));
if (manifestPath) {
  const m = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  compare(m.name, '', '', m.expected, m.plan, '', resolve(m.sourceDir), m.patch, m.item, m.task, m.requirements);
}

if (!process.argv.includes('--manifest-only')) {
const dependencyDirectory = join(root, 'local-python-package');
const dependencySource = join(root, 'local-python-package-input');
mkdirSync(join(dependencySource, 'lib'), { recursive: true });
mkdirSync(join(dependencySource, 'acceptance'), { recursive: true });
writeFileSync(join(dependencySource, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools", "wheel"]\nbuild-backend = "setuptools.build_meta"\n');
writeFileSync(join(dependencySource, 'setup.cfg'), '[metadata]\nname = repocare-acceptance-dependency\nversion = 1.0.0\n[options]\npy_modules = repocare_acceptance_dependency\npackage_dir =\n    =lib\n');
writeFileSync(join(dependencySource, 'lib/repocare_acceptance_dependency.py'), 'VALUE = 42\n');
writeFileSync(join(dependencySource, 'acceptance/test_installed.py'), 'import repocare_acceptance_dependency\ndef test_installed():\n    assert repocare_acceptance_dependency.VALUE == 42\n');
const dependencyPlan: ReproductionPlan = { ...plan, setup: [{ type: 'run-command', command: 'python3 -m pip install --target .repocare-python --no-compile --no-build-isolation .' }], steps: [{ type: 'run-test', command: 'python3 -m pytest acceptance/test_installed.py -q' }] };
// Local package needs no download. Keep both phases offline while exercising actual pip and PYTHONPATH.
const preparedDependency = run(dependencyDirectory, '', dependencyPlan, dependencySource, 'dependencies');
assert.equal(preparedDependency.error, undefined);
assert.equal(preparedDependency.steps[0].code, 0);
const installed = run(dependencyDirectory, '', dependencyPlan, dependencySource);
assert.equal(installed.reproduced, true);
assert.equal(installed.environment.dependencies, preparedDependency.environment.dependencies);
reports.push({ name: 'local-python-dependency', passed: true, preparation: preparedDependency, execution: installed });
writeFileSync(join(root, 'results.json'), JSON.stringify({ image, createdAt: new Date().toISOString(), reports }, null, 2));
console.log('local-python-dependency: installed package imported with network disabled');
}
console.log(`Evidence directory: ${root}`);
