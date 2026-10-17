import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { createTask, claimTask, saveClaim, getTask } from '../../src/server/agent/store';
import { createReproductionJob, getReproductionJob, queueReproductionJob, updateReproductionJob, saveProject, workbenchDb } from '../../src/server/workbench/store';
import { maintenanceTestPlan, prepareMaintenanceVerification } from '../../src/server/workbench/maintenance-verification';
import { assertEnvironmentPreflight, readinessHash, requestEnvironmentPreflight, reviewPrerequisites } from '../../src/server/agent/readiness';
import { planPrerequisites, preflightReadiness, reportPrerequisites, reviewedPrerequisites, requiresPythonPreflight } from '../../src/shared/lib/execution-readiness';
import { POST } from '../../src/app/api/workbench/agent/route';
import { pulseReproductionWorker } from '../../src/server/reproduction/queue';

const root = mkdtempSync(join(tmpdir(), 'repocare-readiness-'));
process.env.REPOCARE_DB_PATH = join(root, 'test.sqlite');
after(() => { db().close(); assert.ok(!relative(tmpdir(), root).startsWith('..')); rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const owner = crypto.randomUUID();
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 1024 });
  const task = createTask(owner, { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '修复并准备验证方案' });
  const claim = claimTask('readiness-worker')!; assert.equal(claim.task.id, task.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.sourceUpdatedAt = '2026-10-17T00:00:00Z';
  const requirements = [{ text: 'Handle empty input', quote: 'Empty input must return zero.', command: 'python3 -m pytest test_value.py::test_empty -q', failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }];
  const patch = { id: crypto.randomUUID(), kind: 'patch' as const, title: '修复', createdAt: '', evidenceIds: [], files: [{ path: 'value.py', before: 'old', after: 'new' }, { path: 'test_value.py', before: '', after: 'assert True', created: true }] };
  const prepared = prepareMaintenanceVerification({ task: claim.task, patch, item: { number: 1, body: requirements[0].quote } as never, plan: maintenanceTestPlan({ requirements, missingInformation: ['未运行完整套件'], scopeLimitations: ['只核对当前接口'] }), requirements, policyRevision: 0 });
  const jobs = [prepared.baseline, prepared.patched].map((plan, index) => createReproductionJob(owner, { repoUrl: task.repoUrl, commitSha: claim.task.commitSha!, issueNumber: 1, sourceUpdatedAt: claim.task.sourceUpdatedAt!, agentTaskId: task.id, verificationRole: index ? 'patched' : 'baseline', verification: prepared.verification, plan }));
  const artifact = { id: crypto.randomUUID(), kind: 'verification' as const, title: '对照', createdAt: '', evidenceIds: [], verification: prepared.verification, jobIds: jobs.map(job => job.id) };
  claim.task.artifacts = [patch, artifact]; claim.task.report = { summary: '待核对', findings: [], missingInformation: ['等待人工确认'], nextSteps: [] }; claim.task.status = 'waiting-input'; saveClaim(claim);
  return { owner, task: getTask(owner, task.id)!, artifact, jobs };
}

test('scope limitations remain nonblocking and legacy missing information stays blocking by default', () => {
  const p = fixture();
  assert.equal(planPrerequisites(p.jobs[0]).blockers.length, 1);
  assert.throws(() => queueReproductionJob(p.owner, p.jobs[0].id, p.task.repoUrl, undefined, { fingerprint: p.artifact.verification.fingerprint, requirementIds: p.artifact.verification.requirements.map(r => r.id) }), /前置条件/);
  assert.equal(p.jobs[0].plan.scopeLimitations?.length, 1);
});

test('report revisions invalidate human classification without discarding audit history', () => {
  const p = fixture();
  const reviewed = reviewPrerequisites(p.owner, p.task.id, { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, updatedAt: p.task.updatedAt, planScopes: [], reportScopes: [{ index: 0, reason: '当前阶段仅等待人工执行确认，不缺运行依赖。' }] });
  assert.equal(reportPrerequisites(reviewed).blockers.length, 0);
  const nextReport = { ...reviewed, reportRevision: 1 };
  assert.equal(reportPrerequisites(nextReport).blockers.length, 1);
  assert.equal(nextReport.prerequisiteReviews?.length, 1);
  assert.equal(reportPrerequisites({ ...reviewed, report: { ...reviewed.report!, missingInformation: ['changed'] } }).blockers.length, 1);
});

test('preflight remains available for the other version after one version was queued', () => {
  const p = fixture();
  updateReproductionJob(p.owner, p.jobs[0].id, { status: 'running' });
  assert.throws(() => reviewPrerequisites(p.owner, p.task.id, { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, updatedAt: p.task.updatedAt, planScopes: [], reportScopes: [] }), /尚未确认/);
  const check = requestEnvironmentPreflight(p.owner, p.task.id, { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, jobId: p.jobs[1].id });
  assert.equal(check.preflightForJobId, p.jobs[1].id);
  assert.throws(() => requestEnvironmentPreflight(p.owner, p.task.id, { artifactId: p.artifact.id, fingerprint: 'old', jobId: p.jobs[1].id }), /已变化/);
});

test('client readiness treats expired and failed inspection as unknown and recognizes implicit pytest plans', () => {
  const p = fixture(), job = { ...p.jobs[0], preflightJobId: 'inspection' };
  const result = { status: 'ready' as const, checkedAt: new Date(Date.now() - 31 * 60000).toISOString(), planHash: readinessHash(job.plan), commitSha: job.commitSha!, runnerImageId: 'image', runtime: {}, checks: [], limitations: [] };
  const check = { ...job, id: 'inspection', purpose: 'environment-preflight' as const, preflightForJobId: job.id, status: 'reproduced' as const, preflight: result };
  assert.equal(preflightReadiness(job, [check]).state, 'unknown');
  assert.equal(preflightReadiness(job, [{ ...check, status: 'failed', preflight: { ...result, checkedAt: new Date().toISOString() } }]).state, 'unknown');
  assert.equal(requiresPythonPreflight({ ...job.plan, environment: { ...job.plan.environment, language: undefined } }), true);
  assert.deepEqual(reviewedPrerequisites(['a'], 'key', [{ sourceKey: 'key', source: ['a'], reviewedAt: '', scopeEntries: [{ index: 9, reason: 'invalid' }] }]).blockers, ['a']);
});

test('route enforces origin, ownership, mandatory preflight and genuine environment blocks', async () => {
  const p = fixture();
  saveProject(p.owner, { repoUrl: p.task.repoUrl, fullName: 'example/project' });
  const request = (body: unknown, owner = p.owner, origin = 'http://localhost') => new NextRequest('http://localhost/api/workbench/agent', { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: `repocare_audit_session=${owner}` }, body: JSON.stringify(body) });
  const input = { action: 'review-prerequisites', id: p.task.id, artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, updatedAt: p.task.updatedAt, planScopes: [{ index: 0, reason: '当前验证只覆盖选定接口，不声称完整套件通过。' }], reportScopes: [{ index: 0, reason: '等待人工确认仅属流程状态，不影响命令执行。' }] };
  assert.equal((await POST(request(input, p.owner, 'https://foreign.example'))).status, 400);
  const other = crypto.randomUUID(); saveProject(other, { repoUrl: p.task.repoUrl, fullName: 'example/project' });
  assert.equal((await POST(request(input, other))).status, 400);
  assert.equal((await POST(request(input))).status, 200);
  process.env.REPOCARE_REPRO_ENABLED = 'true'; pulseReproductionWorker('readiness-test');
  try {
    const confirmation = { action: 'confirm', id: p.task.id, jobId: p.jobs[0].id, confirmed: true };
    const missing = await POST(request(confirmation)); assert.equal(missing.status, 400); assert.match((await missing.json()).error, /检查.*运行环境/);
    const response = await POST(request({ action: 'preflight', id: p.task.id, artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, jobId: p.jobs[0].id }));
    assert.equal(response.status, 200); const { job: check } = await response.json();
    updateReproductionJob(p.owner, check.id, { status: 'blocked', preflight: { status: 'blocked', checkedAt: new Date().toISOString(), planHash: readinessHash(p.jobs[0].plan), commitSha: p.jobs[0].commitSha!, runnerImageId: 'image', runtime: {}, checks: [], limitations: [] } });
    const denied = await POST(request({ ...confirmation, readinessReview: { preflightId: check.id, confirmed: true, prerequisiteReviewedAt: getReproductionJob(p.owner, p.jobs[0].id).prerequisiteReviews?.at(-1)?.reviewedAt } }));
    assert.equal(denied.status, 400); assert.match((await denied.json()).error, /阻塞/);
    assert.equal(getReproductionJob(p.owner, p.jobs[0].id).status, 'awaiting-confirmation');
  } finally { delete process.env.REPOCARE_REPRO_ENABLED; }
});

test('superseded proposals cannot be reclassified or inspected', () => {
  const p = fixture(), task = getTask(p.owner, p.task.id)!;
  task.artifacts.find(artifact => artifact.id === p.artifact.id)!.superseded = true;
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=? WHERE id=?').run(JSON.stringify(task), task.id);
  assert.throws(() => requestEnvironmentPreflight(p.owner, task.id, { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, jobId: p.jobs[0].id }), /已变化/);
});

test('human review preserves original plan bytes, audit trail and fingerprint; stale or wrong owner cannot review', () => {
  const p = fixture(), original = JSON.stringify(p.jobs[0].plan);
  const input = { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, updatedAt: p.task.updatedAt, planScopes: [{ index: 0, reason: '当前仅验证指定接口，不宣称完整回归通过。' }], reportScopes: [{ index: 0, reason: '等待人工确认属于操作状态，没有额外执行缺口。' }] };
  assert.throws(() => reviewPrerequisites('other', p.task.id, input));
  assert.throws(() => reviewPrerequisites(p.owner, p.task.id, { ...input, updatedAt: 'old' }), /已更新/);
  const reviewed = reviewPrerequisites(p.owner, p.task.id, input), job = getReproductionJob(p.owner, p.jobs[0].id);
  assert.equal(JSON.stringify(job.plan), original); assert.equal(job.verification?.fingerprint, p.artifact.verification.fingerprint);
  assert.equal(planPrerequisites(job).blockers.length, 0); assert.equal(reportPrerequisites(reviewed).blockers.length, 0); assert.equal(reviewed.status, 'awaiting-confirmation');
  assert.equal(job.prerequisiteReviews?.length, 1); assert.equal(job.prerequisiteReviews?.[0].source[0], '未运行完整套件');
  assert.equal(reviewed.artifacts.length, 2);
  assert.deepEqual(reviewedPrerequisites(['changed'], job.id, job.prerequisiteReviews).blockers, ['changed']);
});

test('preflight is an isolated idempotent queue job and cannot authorize execution when blocked or stale', () => {
  const p = fixture(), input = { artifactId: p.artifact.id, fingerprint: p.artifact.verification.fingerprint, jobId: p.jobs[0].id };
  const check = requestEnvironmentPreflight(p.owner, p.task.id, input);
  assert.equal(check.purpose, 'environment-preflight'); assert.equal(check.status, 'queued'); assert.equal(check.verificationRole, undefined);
  assert.equal(requestEnvironmentPreflight(p.owner, p.task.id, input).id, check.id);
  let job = getReproductionJob(p.owner, input.jobId);
  assert.throws(() => assertEnvironmentPreflight(p.owner, job, { preflightId: check.id, confirmed: true }), /未完成/);
  const result = { status: 'ready' as const, checkedAt: new Date().toISOString(), planHash: readinessHash(job.plan), commitSha: job.commitSha!, runnerImageId: 'sha256:image', runtime: { python: '3.12.3', pytest: '7.4.4' }, checks: [], limitations: [] };
  updateReproductionJob(p.owner, check.id, { status: 'reproduced', preflight: result });
  assert.equal(assertEnvironmentPreflight(p.owner, job, { preflightId: check.id, confirmed: true }).status, 'ready');
  updateReproductionJob(p.owner, check.id, { preflight: { ...result, status: 'blocked' } });
  assert.throws(() => assertEnvironmentPreflight(p.owner, job, { preflightId: check.id, confirmed: true }), /阻塞/);
  updateReproductionJob(p.owner, check.id, { preflight: { ...result, checkedAt: 'invalid' } });
  assert.throws(() => assertEnvironmentPreflight(p.owner, job, { preflightId: check.id, confirmed: true }), /过期/);
  job = { ...job, plan: { ...job.plan, summary: 'changed' } };
  updateReproductionJob(p.owner, check.id, { preflight: result });
  assert.throws(() => assertEnvironmentPreflight(p.owner, job, { preflightId: check.id, confirmed: true }), /过期/);
});
