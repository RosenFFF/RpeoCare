import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentArtifact, MaintenanceTask } from '../../src/contracts/agent';
import type { GitItem, ReproductionJob, ReproductionPlan } from '../../src/contracts/workbench';
import { prepareMaintenanceVerification } from '../../src/server/workbench/maintenance-verification';
import { assessVerification, verificationNextAction } from '../../src/shared/lib/maintenance-verification';
import { commandTokens, dependencyCommand } from '../../reproduction/commands.mjs';
import { maintenanceProgressHint } from '../../src/shared/lib/maintenance-progress';

const command = 'python3 -m pytest tests/test_value.py::test_empty -q';
const plan: ReproductionPlan = {
  mode: 'test', confidence: 'high', summary: 'Check empty input and normal values', environment: { language: 'Python', dependencies: [] },
  setup: [], steps: [{ type: 'run-test', command }], oracle: { type: 'all-steps-pass', value: '0' },
  expected: 'All selected tests pass', evidence: ['stdout', 'stderr', 'test-result'], risks: [], missingInformation: [], requiresHumanApproval: true,
};
const task = { commitSha: 'a'.repeat(40), kind: 'issue', sourceUpdatedAt: '2026-10-16T00:00:00Z' } as MaintenanceTask;
const item = { number: 1, body: 'Empty input must return zero.', updatedAt: task.sourceUpdatedAt } as GitItem;
const patch: AgentArtifact = { id: 'patch', kind: 'patch', title: 'fix', createdAt: task.sourceUpdatedAt!, evidenceIds: [], files: [
  { path: 'value.py', before: 'old', after: 'new', created: false },
  { path: 'tests/test_value.py', before: '', after: 'test', created: true },
] };
const requirements = [{ text: 'Handle empty input', quote: item.body, command, failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }];
function prepare(overrides = {}) { return prepareMaintenanceVerification({ task, item, patch, plan, requirements, policyRevision: 1, ...overrides }); }
function pair() {
  const { verification: context } = prepare();
  context.confirmedAt = '2026-10-16T00:00:00Z'; context.confirmedRequirementIds = context.requirements.map(r => r.id);
  const job = (role: 'baseline' | 'patched') => ({ verificationRole: role, verification: structuredClone(context), commitSha: context.baseSha,
    status: role === 'patched' ? 'reproduced' : 'not-reproduced', totalAttempts: 3,
    attemptHistory: Array.from({ length: 3 }, (_, i) => ({ index: i + 1, environmentFingerprint: 'same-image-and-deps', steps: [{ phase: 'verify', command, code: role === 'patched' ? 0 : 1, ok: role === 'patched', failureKind: role === 'patched' ? undefined : 'assertion', stdout: role === 'patched' ? 'passed' : 'AssertionError: EMPTY_EXPECTED' }] })),
  }) as ReproductionJob;
  return { context, jobs: [job('baseline'), job('patched')] };
}

test('verification shares identical tests while applying production changes only to candidate', () => {
  const result = prepare();
  assert.deepEqual(result.baseline.setup.map(s => s.path), ['tests/test_value.py']);
  assert.deepEqual(result.patched.setup.map(s => s.path), ['tests/test_value.py', 'value.py']);
  assert.equal(result.verification.baseSha, task.commitSha);
  assert.notEqual(result.verification.planHash, result.verification.patchedPlanHash);
  assert.throws(() => prepare({ requirements: [{ ...requirements[0], quote: 'Invented original requirement' }] }), /引用/);
  assert.throws(() => prepare({ patch: { ...patch, files: patch.files!.slice(1) } }), /只有测试/);
  assert.throws(() => prepare({ requirements: [{ ...requirements[0], command: 'python3 -m pytest tests -q' }] }), /明确/);
  for (const path of ['requirements.txt', 'pyproject.toml', 'pytest.ini', '.git/config']) {
    assert.throws(() => prepare({ patch: { ...patch, files: [{ ...patch.files![0], path }] } }));
  }
});

test('verification requires stable target failure before all candidate commands pass', () => {
  const { context, jobs } = pair();
  assert.equal(assessVerification(context, jobs).state, 'improved');
  for (const step of jobs[0].attemptHistory.flatMap(a => a.steps!)) { step.code = 0; step.ok = true; }
  assert.equal(assessVerification(context, jobs).state, 'not-demonstrated');
});

test('invalid patch, dependency error, stale source, missing attempts and environment drift stay distinct', () => {
  let p = pair(); p.jobs[1].attemptHistory[0].steps![0].code = 1;
  assert.equal(assessVerification(p.context, p.jobs).state, 'still-failing');
  p = pair(); p.jobs[0].status = 'blocked'; assert.equal(assessVerification(p.context, p.jobs).state, 'blocked');
  p = pair(); assert.equal(assessVerification(p.context, p.jobs, true).state, 'stale');
  p = pair(); p.jobs[1].attemptHistory.pop(); assert.equal(assessVerification(p.context, p.jobs).state, 'inconclusive');
  p = pair(); p.jobs[1].attemptHistory[0].environmentFingerprint = 'changed'; assert.equal(assessVerification(p.context, p.jobs).state, 'inconclusive');
  p = pair(); p.jobs[0].verification!.confirmedRequirementIds = []; assert.equal(assessVerification(p.context, p.jobs).state, 'unconfirmed');
  p = pair(); p.jobs[0].attemptHistory[0].steps![0].failureKind = 'collection'; assert.equal(assessVerification(p.context, p.jobs).state, 'not-demonstrated');
});

test('canonical Python dependency installation rejects arbitrary pip targets and flags', () => {
  assert.equal(dependencyCommand('python3 -m pip install --target .repocare-python --no-compile -r requirements-dev.txt'), true);
  for (const value of ['python3 -m pip install pytest', 'python3 -m pip install --target /tmp --no-compile -r requirements.txt', 'python3 -m pytest tests; whoami']) assert.throws(() => commandTokens(value));
});

test('next investigation is grounded in saved pair and never encourages stale or pending execution', () => {
  let p = pair();
  assert.match(verificationNextAction(p.context, p.jobs)!.title, /覆盖边界/);
  assert.equal(verificationNextAction(p.context, p.jobs, true), null);
  p.jobs[1].status = 'running'; assert.equal(verificationNextAction(p.context, p.jobs), null);
  p = pair(); p.jobs[1].status = 'blocked';
  const next = verificationNextAction(p.context, p.jobs)!;
  assert.match(next.title, /阻塞/); assert.match(next.prompt, /不自动确认/);
  assert.deepEqual(next.targets[0].paths, ['value.py']);
  p = pair(); p.jobs[1].attemptHistory[0].steps![0].code = 1;
  assert.match(verificationNextAction(p.context, p.jobs)!.title, /失败用例/);
  p = pair(); for (const step of p.jobs[0].attemptHistory.flatMap(a => a.steps!)) step.code = 0;
  assert.match(verificationNextAction(p.context, p.jobs)!.title, /原版/);
});

test('stage hint separates source reading, minimal patch and pending verification', () => {
  const t = { ...task, goal: '修复并准备需求对照', artifacts: [], evidence: [], budget: { maxTurns: 10, turns: 2 } } as unknown as MaintenanceTask;
  assert.match(maintenanceProgressHint(t), /先读取/);
  t.evidence = [{ kind: 'file' }, { kind: 'issue' }] as MaintenanceTask['evidence'];
  assert.match(maintenanceProgressHint(t), /最小且唯一/);
  t.artifacts = [patch]; assert.match(maintenanceProgressHint(t), /prepare_verification/);
  t.artifacts = [{ ...patch, superseded: true }]; assert.match(maintenanceProgressHint(t), /未保存补丁/);
});
