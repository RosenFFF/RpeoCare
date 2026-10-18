import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentArtifact, MaintenanceTask } from '../../src/contracts/agent';
import type { GitItem, ReproductionJob, ReproductionPlan } from '../../src/contracts/workbench';
import { maintenanceTestPlan, prepareMaintenanceVerification } from '../../src/server/workbench/maintenance-verification';
import { assessVerification, verificationCoverage, verificationNextAction, verificationDecision } from '../../src/shared/lib/maintenance-verification';
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

test('shortcut plan keeps normal regressions separate from defect requirements and remains reviewable', () => {
  const preparedPlan = maintenanceTestPlan({ requirements, regressionCommands: ['python3 -m pytest tests/test_value.py::test_normal -q'] });
  const result = prepare({ plan: preparedPlan });
  assert.equal(result.verification.requirements.length, 1);
  assert.deepEqual(result.verification.regressionCommands, ['python3 -m pytest tests/test_value.py::test_normal -q']);
  assert.equal(result.baseline.setup.length, 1); assert.equal(result.baseline.requiresHumanApproval, true);
  assert.throws(() => maintenanceTestPlan({ requirements, setupCommands: ['python3 -m pip install pytest'] }), /安装/);
  assert.throws(() => maintenanceTestPlan({ requirements, regressionCommands: ['python3 -m pytest; whoami'] }), /shell/);
});

test('regression coverage requires both versions and every attempt, independently of target improvement', () => {
  const p = pair();
  assert.equal(verificationCoverage(p.context, p.jobs).state, 'not-planned');
  const regression = 'python3 -m pytest tests/test_value.py::test_normal -q';
  p.context.regressionCommands = [regression];
  for (const job of p.jobs) for (const attempt of job.attemptHistory) attempt.steps!.push({ phase: 'verify', type: 'run-test', command: regression, code: 0, ok: true });
  const coverage = verificationCoverage(p.context, p.jobs);
  assert.equal(coverage.state, 'passed'); assert.equal(coverage.passed, 1);
  assert.match(coverage.independent, /未记录/);
  p.jobs[0].attemptHistory[1].steps!.at(-1)!.code = 1;
  assert.equal(verificationCoverage(p.context, p.jobs).state, 'failed');
  p.jobs[0].attemptHistory[1].steps!.pop();
  assert.equal(verificationCoverage(p.context, p.jobs).state, 'unknown');
  assert.equal(verificationCoverage(p.context, p.jobs, true).state, 'stale');
});

test('regression coverage never treats pending, unreviewed or mismatched records as passed', () => {
  const p = pair(); p.context.regressionCommands = ['python3 -m pytest tests -q'];
  p.jobs[1].status = 'running'; assert.equal(verificationCoverage(p.context, p.jobs).state, 'pending');
  p.jobs[1].status = 'blocked'; assert.equal(verificationCoverage(p.context, p.jobs).state, 'blocked');
  p.jobs[1].status = 'reproduced'; p.jobs[0].verification!.confirmedRequirementIds = [];
  assert.equal(verificationCoverage(p.context, p.jobs).state, 'unknown');
  p.jobs[0].verification!.confirmedRequirementIds = p.context.requirements.map(r => r.id);
  p.jobs[1].verification!.fingerprint = 'different';
  assert.equal(verificationCoverage(p.context, p.jobs).state, 'unknown');
});

test('stable normal-behavior regression is named and drives investigation without weakening tests', () => {
  const p = pair(), command = 'python3 -m pytest tests/test_value.py::test_normal -q';
  p.context.regressionCommands = [command]; p.jobs[1].status = 'not-reproduced';
  for (const job of p.jobs) for (const attempt of job.attemptHistory) attempt.steps!.push({ phase: 'verify', type: 'run-test', command, code: job.verificationRole === 'baseline' ? 0 : 1, ok: job.verificationRole === 'baseline', failureKind: job.verificationRole === 'baseline' ? undefined : 'assertion' });
  assert.match(verificationCoverage(p.context, p.jobs).label, /候选引入回归/);
  assert.equal(verificationCoverage(p.context, p.jobs).results[0].regressed, true);
  assert.equal(assessVerification(p.context, p.jobs).state, 'inconclusive');
  assert.match(assessVerification(p.context, p.jobs).reason, /存在回归/);
  const next = verificationNextAction(p.context, p.jobs)!;
  assert.match(next.title, /修复候选引入的回归/); assert.match(next.prompt, /不得删除、弱化/); assert.ok(next.prompt.includes(command));
  p.jobs[1].attemptHistory[0].environmentFingerprint = 'different';
  assert.equal(verificationCoverage(p.context, p.jobs).results[0].regressed, false);
  p.jobs[1].attemptHistory[0].environmentFingerprint = 'same-image-and-deps';
  p.jobs[0].attemptHistory[0].steps!.at(-1)!.code = 1;
  assert.equal(verificationCoverage(p.context, p.jobs).results[0].regressed, false);
  assert.doesNotMatch(verificationCoverage(p.context, p.jobs).label, /候选引入/);
});

test('a known failing requirement remains prominent when another target is inconclusive', () => {
  const p = pair(), second = { ...p.context.requirements[0], id: 'second', command: 'python3 -m pytest tests/test_value.py::test_other -q' };
  p.context.requirements.push(second); p.jobs[1].status = 'not-reproduced';
  for (const job of p.jobs) {
    job.verification!.confirmedRequirementIds!.push(second.id);
    for (const attempt of job.attemptHistory) attempt.steps!.push({ phase: 'verify', type: 'run-test', command: second.command, code: 1, ok: false, failureKind: 'assertion', stdout: 'EMPTY_EXPECTED' });
  }
  const assessment = assessVerification(p.context, p.jobs);
  assert.equal(assessment.requirements[0].outcome, 'inconclusive');
  assert.equal(assessment.requirements[1].outcome, 'still-failing');
  assert.equal(assessment.state, 'still-failing');
  assert.match(verificationNextAction(p.context, p.jobs)!.title, /失败用例/);
});

test('combined decision never promotes a local target improvement to a complete acceptance', () => {
  const p = pair();
  assert.match(verificationDecision(p.context, p.jobs).title, /尚未核验/);
  assert.equal(verificationDecision(p.context, p.jobs, true).tone, 'unknown');
  const normal = 'python3 -m pytest tests/test_value.py::test_normal -q';
  p.context.regressionCommands = [normal];
  for (const job of p.jobs) for (const attempt of job.attemptHistory) attempt.steps!.push({ phase: 'verify', command: normal, code: 0, ok: true } as never);
  assert.equal(verificationDecision(p.context, p.jobs).tone, 'success');
  p.jobs[1].status = 'not-reproduced';
  for (const attempt of p.jobs[1].attemptHistory) { const step = attempt.steps!.find(step => step.command === normal)!; step.code = 1; step.ok = false; step.failureKind = 'assertion'; }
  assert.match(verificationDecision(p.context, p.jobs).title, /不能交付/);
});

test('a blocked preflight is visible before target confirmation', () => {
  const p = pair();
  p.jobs[0].status = 'awaiting-confirmation'; p.jobs[0].id = 'original'; p.jobs[0].preflightJobId = 'check';
  const check = { id: 'check', purpose: 'environment-preflight', preflightForJobId: 'original', status: 'blocked', preflight: { status: 'blocked', commitSha: p.context.baseSha, checkedAt: new Date().toISOString() } } as ReproductionJob;
  assert.match(verificationDecision(p.context, [...p.jobs,check]).title, /环境受阻/);
});
