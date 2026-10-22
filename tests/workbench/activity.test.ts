import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { MaintenanceTask } from '../../src/contracts/agent';
import type { GitItem, ReproductionJob, ReproductionPlan } from '../../src/contracts/workbench';
import { db, createRun, updateRun } from '../../src/server/audit/store';
import { workbenchDb, saveProject, createDraft } from '../../src/server/workbench/store';
import { listTasks } from '../../src/server/agent/store';
import { getProjectActivity } from '../../src/server/workbench/activity';
import { GET } from '../../src/app/api/workbench/activity/route';
import { safeSettingsReturn } from '../../src/shared/lib/settings-navigation';
import { prepareMaintenanceVerification } from '../../src/server/workbench/maintenance-verification';

const directory = mkdtempSync(join(tmpdir(), 'repocare-activity-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const repoUrl = 'https://github.com/example/activity';
function seed(owner: string, branch = 'main', number = 1, status: MaintenanceTask['status'] = 'completed', changes: Partial<MaintenanceTask> = {}) {
  listTasks(owner, repoUrl, branch);
  const task = { id: randomUUID(), repoUrl, branch, requestedBranch: branch, number, kind: 'issue', status,
    createdAt: '2026-10-21T09:00:00Z', updatedAt: '2026-10-21T09:00:00Z', events: [], dialogue: [], artifacts: [], evidence: [], goal: 'private-task-goal', ...changes } as unknown as MaintenanceTask;
  workbenchDb().prepare('INSERT INTO maintenance_tasks(id,owner,repo,branch,status,state,internal,connection) VALUES(?,?,?,?,?,?,?,?)').run(task.id, owner, repoUrl, branch, status, JSON.stringify(task), 'private-checkpoint', 'encrypted-credential');
  return task;
}
function saveJob(owner: string, task: MaintenanceTask, status: ReproductionJob['status']) {
  const job = { id: randomUUID(), repoUrl, branch: task.branch, issueNumber: task.number, agentTaskId: task.id, status, updatedAt: task.updatedAt, createdAt: task.createdAt, attemptHistory: [], plan: { missingInformation: [], environment: { language: 'JavaScript', dependencies: [] }, setup: [], steps: [] } } as unknown as ReproductionJob;
  workbenchDb().prepare('INSERT INTO reproduction_jobs(id,owner,repo_url,issue_number,status,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(job.id, owner, repoUrl, task.number!, status, JSON.stringify(job), job.createdAt, job.updatedAt);
  task.artifacts = [{ id: 'proposal', kind: 'reproduction', title: 'Plan', jobIds: [job.id], createdAt: task.createdAt, evidenceIds: [] }];
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=? WHERE id=?').run(JSON.stringify(task), task.id);
  return job;
}

test('activity is owner, repository and branch scoped and excludes private task contents', async () => {
  const owner = randomUUID();
  saveProject(owner, { repoUrl, fullName: 'example/activity', branch: 'main' });
  const current = seed(owner), otherOwner = seed(randomUUID()), otherBranch = seed(owner, 'dev');
  const response = GET(new NextRequest('http://localhost/api/workbench/activity', { headers: { cookie: `repocare_audit_session=${owner}` } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.ok(body.includes(current.id));
  for (const secret of [otherOwner.id, otherBranch.id, 'private-task-goal', 'private-checkpoint', 'encrypted-credential', owner]) assert.ok(!body.includes(secret));
  assert.deepEqual(getProjectActivity().items, []);
  saveProject(owner, { repoUrl: 'https://github.com/example/other', fullName: 'example/other', branch: 'main' });
  assert.deepEqual(getProjectActivity(owner).items, []);
});

test('only the current task per issue is shown; actual execution outranks completed investigation', () => {
  const owner = randomUUID(); saveProject(owner, { repoUrl, fullName: 'example/activity', branch: 'main' });
  const old = seed(owner, 'main', 1, 'failed');
  const current = seed(owner, 'main', 1);
  saveJob(owner, current, 'awaiting-confirmation');
  const blocked = seed(owner, 'main', 2); saveJob(owner, blocked, 'blocked');
  const running = seed(owner, 'main', 3); saveJob(owner, running, 'running');
  seed(owner, 'main', 4, 'cancelled');
  const items = getProjectActivity(owner).items;
  assert.equal(items.length, 3); assert.ok(!items.some(item => item.id.includes(old.id)));
  assert.equal(items[0].state, 'attention');
  assert.equal(items.find(item => item.id.endsWith(current.id))?.state, 'review');
  assert.equal(items.find(item => item.id.endsWith(running.id))?.state, 'running');
  assert.equal(items.find(item => item.id.endsWith(current.id))?.href, '/issues?number=1');
});

test('read revisions ignore polling timestamps but change when a task needs new attention', () => {
  const owner = randomUUID(); saveProject(owner, { repoUrl, fullName: 'example/activity', branch: 'main' });
  const task = seed(owner, 'main', 5, 'running');
  const revision = getProjectActivity(owner).items[0].revision;
  task.updatedAt = '2026-10-21T10:00:00Z'; task.events.push({ at: task.updatedAt, message: 'Reading another file' });
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=? WHERE id=?').run(JSON.stringify(task), task.id);
  assert.equal(getProjectActivity(owner).items[0].revision, revision);
  task.status = 'waiting-input';
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=?,status=? WHERE id=?').run(JSON.stringify(task), task.status, task.id);
  assert.notEqual(getProjectActivity(owner).items[0].revision, revision);
});

test('latest audit and unarchived drafts are actionable without claiming overall test success', () => {
  const owner = randomUUID(); saveProject(owner, { repoUrl, fullName: 'example/activity', branch: 'main' });
  const run = createRun(owner, repoUrl, undefined, null, 'main'); updateRun(run.id, value => { value.status = 'failed'; });
  const draft = createDraft(owner, { repoUrl, branch: 'main', kind: 'file', path: 'README.md', title: 'README review', baseSha: 'a'.repeat(40), before: '', content: 'Private draft body' });
  const archived = createDraft(owner, { repoUrl, branch: 'main', kind: 'file', path: 'CONTRIBUTING.md', title: 'Archived', baseSha: 'a'.repeat(40), before: '', content: '', archived: true });
  const otherBranch = createDraft(owner, { repoUrl, branch: 'dev', kind: 'file', path: 'README.md', title: 'Other branch', baseSha: 'a'.repeat(40), before: '', content: '' });
  const reply = createDraft(owner, { repoUrl, kind: 'issue', number: 12, title: 'Issue reply', baseSha: '', before: '', content: 'Private reply' });
  const items = getProjectActivity(owner).items;
  assert.equal(items.find(item => item.id === `audit:${run.id}`)?.state, 'attention');
  assert.equal(items.find(item => item.id === `draft:${draft.id}`)?.href, `/improvements?draft=${draft.id}`);
  assert.ok(items.some(item => item.id === `draft:${reply.id}`));
  assert.ok(!items.some(item => item.id === `draft:${otherBranch.id}`));
  assert.ok(!items.some(item => item.id.includes(archived.id))); assert.ok(!JSON.stringify(items).includes('Private draft body'));
  saveProject(owner, { repoUrl, fullName: 'example/activity' });
  assert.match(getProjectActivity(owner).items.find(item => item.id === `draft:${draft.id}`)!.detail, /记录分支：main/);
});

test('settings return links preserve task context and reject external or unrelated destinations', () => {
  assert.equal(safeSettingsReturn('/issues?number=42'), '/issues?number=42');
  assert.equal(safeSettingsReturn('/audit?run=abc&tab=journey'), '/audit?run=abc&tab=journey');
  for (const value of ['https://example.com', '//example.com', '/\\example.com', '/login', '/api/models', '/settings', '/%2e%2e/login', 'javascript:alert(1)']) assert.equal(safeSettingsReturn(value), null);
});

test('expected baseline failures stay results while a proven candidate regression needs attention', () => {
  const owner = randomUUID(); saveProject(owner, { repoUrl, fullName: 'example/activity', branch: 'main' });
  const task = seed(owner, 'main', 9, 'completed', { commitSha: 'a'.repeat(40), sourceUpdatedAt: '2026-10-21T09:00:00Z' });
  const command = 'python3 -m pytest tests/test_value.py::test_empty -q';
  const normal = 'python3 -m pytest tests/test_value.py::test_normal -q';
  const plan: ReproductionPlan = { mode: 'test', confidence: 'high', summary: 'Check selected behavior', environment: { language: 'Python', dependencies: [] }, setup: [], steps: [{ type: 'run-test', command }], oracle: { type: 'all-steps-pass', value: '0' }, expected: 'Pass', evidence: ['stdout'], risks: [], missingInformation: [], requiresHumanApproval: true };
  const patch = { id: 'patch', kind: 'patch' as const, title: 'Fix', createdAt: task.updatedAt, evidenceIds: [], files: [{ path: 'value.py', before: 'old', after: 'new' }, { path: 'tests/test_value.py', before: '', after: 'test', created: true }] };
  const item = { number: 9, body: 'Empty input must return zero.', updatedAt: task.sourceUpdatedAt } as GitItem;
  const prepared = prepareMaintenanceVerification({ task, item, patch, plan, requirements: [{ text: 'Handle empty input', quote: item.body, command, failureSignal: 'EMPTY_EXPECTED', changedPaths: ['value.py'] }], policyRevision: 0 });
  const context = prepared.verification;
  context.regressionCommands = [normal]; context.confirmedAt = task.updatedAt; context.confirmedRequirementIds = context.requirements.map(requirement => requirement.id);
  const jobs = (['baseline', 'patched'] as const).map(role => {
    const job = { id: randomUUID(), repoUrl, agentTaskId: task.id, issueNumber: 9, commitSha: context.baseSha, status: role === 'baseline' ? 'not-reproduced' : 'reproduced', verificationRole: role, verification: structuredClone(context), plan: role === 'baseline' ? prepared.baseline : prepared.patched, createdAt: task.updatedAt, updatedAt: task.updatedAt, totalAttempts: 1,
      attemptHistory: [{ index: 1, environmentFingerprint: 'same-environment', steps: [{ phase: 'verify', command, code: role === 'baseline' ? 1 : 0, ok: role !== 'baseline', failureKind: role === 'baseline' ? 'assertion' : undefined, stdout: role === 'baseline' ? 'AssertionError: EMPTY_EXPECTED' : 'passed' }, { phase: 'verify', command: normal, code: 0, ok: true }] }] } as ReproductionJob;
    workbenchDb().prepare('INSERT INTO reproduction_jobs(id,owner,repo_url,issue_number,status,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(job.id, owner, repoUrl, 9, job.status, JSON.stringify(job), job.createdAt, job.updatedAt);
    return job;
  });
  task.artifacts = [patch, { id: 'comparison', kind: 'verification', title: 'Comparison', createdAt: task.updatedAt, evidenceIds: [], verification: context, jobIds: jobs.map(job => job.id) }];
  workbenchDb().prepare('UPDATE maintenance_tasks SET state=? WHERE id=?').run(JSON.stringify(task), task.id);
  let activity = getProjectActivity(owner).items[0];
  assert.equal(activity.state, 'complete'); assert.match(activity.title, /所列目标与正常行为检查已通过/);
  const candidate = jobs[1];
  const normalStep = candidate.attemptHistory[0].steps![1]; normalStep.code = 1; normalStep.ok = false; normalStep.failureKind = 'assertion';
  candidate.status = 'not-reproduced';
  workbenchDb().prepare('UPDATE reproduction_jobs SET state=?,status=? WHERE id=?').run(JSON.stringify(candidate), candidate.status, candidate.id);
  activity = getProjectActivity(owner).items[0];
  assert.equal(activity.state, 'attention'); assert.match(activity.title, /候选引入回归/);
});
