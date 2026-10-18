import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { createTask, claimTask, getTask, saveClaim, mutateTask } from '../../src/server/agent/store';
import { createReproductionJob, getReproductionJob, saveProject, updateReproductionJob, workbenchDb } from '../../src/server/workbench/store';
import { prepareAcceptance } from '../../src/server/agent/acceptance';
import { maintenanceTestPlan, prepareMaintenanceVerification, verificationHash } from '../../src/server/workbench/maintenance-verification';
import { GET, POST } from '../../src/app/api/workbench/agent/route';
import { verificationCoverage, verificationDecision } from '../../src/shared/lib/maintenance-verification';
import { RepositoryReader } from '../../src/server/agent/repository';
import { maintenanceTools } from '../../src/server/agent/tools';

const root = mkdtempSync(join(tmpdir(), 'repocare-acceptance-'));
process.env.REPOCARE_DB_PATH = join(root, 'test.sqlite');
after(() => { db().close(); rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const owner = crypto.randomUUID(), repoUrl = 'https://github.com/example/project';
  saveConnection(owner, { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 1024 });
  const created = createTask(owner, { repoUrl }, { kind: 'issue', number: 1, goal: '修复空值并准备验证方案' });
  const claim = claimTask('acceptance-worker')!; assert.equal(claim.task.id, created.id);
  claim.task.commitSha = 'a'.repeat(40); claim.task.sourceUpdatedAt = '2026-10-17T00:00:00Z';
  const item = { number: 1, body: 'Empty input must return zero.', updatedAt: claim.task.sourceUpdatedAt };
  claim.internal.cache = { visibility: 'public', item: JSON.stringify(item) };
  const requirements = [{ text: 'Handle empty input', quote: item.body, command: 'python3 -m pytest test_value.py::test_empty -q', failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }];
  const patch = { id: crypto.randomUUID(), kind: 'patch' as const, title: '候选', createdAt: '', evidenceIds: [], files: [{ path: 'value.py', before: 'old', after: 'new' }, { path: 'test_value.py', before: '', after: 'test', created: true }] };
  const prepared = prepareMaintenanceVerification({ task: claim.task, patch, item: item as never, plan: maintenanceTestPlan({ requirements }), requirements, policyRevision: 0 });
  const jobs = [prepared.baseline, prepared.patched].map((plan, i) => createReproductionJob(owner, { repoUrl, commitSha: claim.task.commitSha!, issueNumber: 1, sourceUpdatedAt: claim.task.sourceUpdatedAt!, agentTaskId: created.id, plan, verificationRole: i ? 'patched' : 'baseline', verification: prepared.verification }));
  const artifact = { id: crypto.randomUUID(), kind: 'verification' as const, title: '对照', createdAt: '', evidenceIds: [], patchId: patch.id, verification: prepared.verification, jobIds: jobs.map(job => job.id) };
  claim.task.artifacts = [patch, artifact]; claim.task.status = 'awaiting-confirmation'; saveClaim(claim);
  const task = getTask(owner, created.id)!;
  saveProject(owner, { repoUrl, fullName: 'example/project' });
  const input = { artifactId: artifact.id, fingerprint: prepared.verification.fingerprint, updatedAt: task.updatedAt, content: 'def test_empty():\n    assert False, "EMPTY_EXPECTED"\ndef test_normal():\n    assert True\n', note: '维护者另行提供，覆盖空值和正常输入。', declaration: 'withheld' as const, targets: [{ requirementId: prepared.verification.requirements[0].id, testName: 'test_empty', failureSignal: 'EMPTY_EXPECTED' }], normalTests: ['test_normal'] };
  return { owner, task, artifact, jobs, input };
}
test('human checks form an additional unexecuted pair with provenance and immutable original plans', () => {
  const p = fixture(), before = p.jobs.map(job => JSON.stringify(getReproductionJob(p.owner, job.id).plan));
  const task = prepareAcceptance(p.owner, p.task.id, p.input), added = task.artifacts.at(-1)!;
  assert.equal(added.kind, 'acceptance'); assert.equal(added.verification!.acceptanceSource!.parentFingerprint, p.input.fingerprint);
  assert.deepEqual(p.jobs.map(job => JSON.stringify(getReproductionJob(p.owner, job.id).plan)), before);
  assert.equal(task.artifacts.find(a => a.id === p.artifact.id)!.superseded, undefined);
  const jobs = added.jobIds!.map(id => getReproductionJob(p.owner, id));
  assert.ok(jobs.every(job => job.status === 'awaiting-confirmation' && !job.attemptHistory.length));
  assert.equal(verificationHash(jobs[0].plan), added.verification!.planHash);
  assert.deepEqual(jobs[0].plan.setup.filter(step => step.type === 'create-file').map(step => step.content), [p.input.content]);
  assert.match(verificationCoverage(added.verification!, jobs).independent, /声明/);
  assert.equal(verificationDecision(added.verification!, jobs).title, '待核对要求');
});
test('stale inputs, another owner, private source and running original pair cannot add acceptance', () => {
  let p = fixture(); assert.throws(() => prepareAcceptance(p.owner, p.task.id, { ...p.input, updatedAt: 'old' }), /已变化/);
  assert.throws(() => prepareAcceptance('other', p.task.id, p.input));
  updateReproductionJob(p.owner, p.jobs[0].id, { status: 'running' });
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, p.input), /正在执行/);
  p = fixture(); const row = workbenchDb().prepare('SELECT internal FROM maintenance_tasks WHERE id=?').get(p.task.id) as { internal: string };
  const internal = JSON.parse(row.internal); internal.cache.visibility = 'private';
  workbenchDb().prepare('UPDATE maintenance_tasks SET internal=? WHERE id=?').run(JSON.stringify(internal), p.task.id);
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, p.input), /公开仓库/);
});
test('invalid selectors, overlapping normal tests, missing functions and credential text are rejected', () => {
  const p = fixture();
  for (const change of [{ normalTests: ['test_empty'] }, { normalTests: ['test_absent'] }, { targets: [{ ...p.input.targets[0], testName: 'test_empty; whoami' }] }, { content: p.input.content + '# sk-' + 'x'.repeat(24) }]) assert.throws(() => prepareAcceptance(p.owner, p.task.id, { ...p.input, ...change }));
  assert.equal(getTask(p.owner, p.task.id)!.artifacts.length, 2);
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, { ...p.input, setupCommands: ['python3 -m pytest test_value.py -q'] }), /依赖安装/);
});

test('acceptance rejects changed parent plans, version roles and production content', () => {
  let p = fixture();
  updateReproductionJob(p.owner, p.jobs[0].id, { plan: { ...p.jobs[0].plan, summary: 'changed parent plan' } });
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, p.input), /计划指纹/);
  p = fixture();
  updateReproductionJob(p.owner, p.jobs[1].id, { verificationRole: 'baseline' });
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, p.input), /计划指纹/);
  p = fixture();
  p.task.artifacts[0].files![0].after = 'different production change';
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=? WHERE owner=? AND id=?').run(JSON.stringify(p.task), p.owner, p.task.id);
  assert.throws(() => prepareAcceptance(p.owner, p.task.id, p.input), /生产补丁指纹/);
  assert.equal(getTask(p.owner, p.task.id)!.artifacts.length, 2);
});

test('a failed import preflight cannot be disguised by a scope-only model revision', async () => {
  const p = fixture();
  const check = createReproductionJob(p.owner, { repoUrl: p.task.repoUrl, commitSha: p.task.commitSha!, issueNumber: 1, sourceUpdatedAt: p.task.sourceUpdatedAt!, plan: p.jobs[0].plan });
  updateReproductionJob(p.owner, check.id, { purpose: 'environment-preflight', status: 'reproduced', preflight: { status: 'blocked', checks: [{ id: 'import-hypothesis-test_value.py', title: 'missing dependency', status: 'blocked', detail: 'Not installed.' }], limitations: [], runtime: {}, checkedAt: new Date().toISOString(), planHash: verificationHash(p.jobs[0].plan), commitSha: p.task.commitSha!, runnerImageId: 'fixed-image' } });
  updateReproductionJob(p.owner, p.jobs[0].id, { preflightJobId: check.id });
  mutateTask(p.owner, p.task.id, 'message', '依据环境预检继续准备。');
  const claim = claimTask('scope-regression')!;
  const tools = await maintenanceTools(new RepositoryReader(claim, new AbortController().signal));
  const prepare = tools.find(tool => tool.name === 'prepare_verification')!;
  const r = p.artifact.verification.requirements[0];
  await assert.rejects(() => prepare.execute('scope-only', { requirements: [{ text: r.text, quote: r.quote, command: r.command, failureSignal: r.failureSignal, changedPaths: r.changedPaths }], scopeLimitations: ['安装依赖的说明不能代替实际准备步骤。'] }), /setupCommands/);
  claim.task.status = 'awaiting-confirmation'; saveClaim(claim);
});
test('acceptance HTTP requires origin and ownership; export retains source and observed status', async () => {
  const p = fixture();
  const request = (origin: string) => new NextRequest('http://localhost/api/workbench/agent', { method: 'POST', headers: { origin, cookie: `repocare_audit_session=${p.owner}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...p.input, action: 'prepare-acceptance', id: p.task.id }) });
  assert.equal((await POST(request('https://other.example'))).status, 400);
  const response = await POST(request('http://localhost')); assert.equal(response.status, 200);
  const added = (await response.json()).task.artifacts.at(-1);
  const exported = await GET(new NextRequest(`http://localhost/api/workbench/agent?id=${p.task.id}&export=${added.id}`, { headers: { cookie: `repocare_audit_session=${p.owner}` } }));
  const record = await exported.json(); assert.equal(record.context.acceptanceSource.declaration, 'withheld'); assert.equal(record.assessment.state, 'unconfirmed');
});
