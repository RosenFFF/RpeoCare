import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReproductionPlan } from '../../src/contracts/workbench';

const directory = mkdtempSync(join(tmpdir(), 'repocare-reproduction-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
process.env.REPOCARE_REPRO_ARTIFACTS = join(directory, 'artifacts');
process.env.REPOCARE_REPRO_ENABLED = 'false';

import { db } from '../../src/server/audit/store';
import { cancelReproductionJob, createReproductionJob, getReproductionJob, listReproductionJobs, queueReproductionJob, updateLeasedReproduction, workbenchDb } from '../../src/server/workbench/store';
import { validateReproductionPlan } from '../../src/server/reproduction/plan';
import { claimReproduction, pulseReproductionWorker, releaseReproduction, reproductionWorkerOnline } from '../../src/server/reproduction/queue';
import { executeReproduction, sourceCloneArguments } from '../../src/server/reproduction/executor';


const browserPlan: ReproductionPlan = {
  mode: 'browser', confidence: 'medium', summary: '启动本地应用并复现按钮点击后的错误提示。',
  environment: { language: 'TypeScript', dependencies: ['npm lockfile'] },
  setup: [
    { type: 'run-command', command: 'npm ci' },
    { type: 'run-command', command: 'npm run dev', background: true },
  ],
  steps: [
    { type: 'goto', target: 'http://127.0.0.1:3000/login' },
    { type: 'click', target: 'role=button[name=提交]' },
    { type: 'expect', target: 'text=Internal Server Error', expected: 'Internal Server Error' },
  ],
  oracle: { type: 'selector-visible', value: 'text=Internal Server Error' },
  expected: '提交空表单后页面错误可见。', evidence: ['screenshot', 'trace', 'console', 'network'],
  risks: ['需要安装 lockfile 中的依赖'], missingInformation: [], requiresHumanApproval: true,
};

beforeEach(() => {
  const database = workbenchDb();
  database.exec('DELETE FROM reproduction_leases; DELETE FROM reproduction_workers; DELETE FROM reproduction_jobs;');
});
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

test('reproduction plan accepts explicit local browser evidence workflow', () => {
  const plan = validateReproductionPlan(browserPlan);
  assert.equal(plan.mode, 'browser');
  assert.equal(plan.oracle.type, 'selector-visible');
});

test('reproduction plan rejects shell escape, external URLs, arbitrary Node and unapproved plans', () => {
  assert.throws(() => validateReproductionPlan({ ...browserPlan, setup: [{ type: 'run-command', command: 'npm test && curl https://example.com' }] }), /shell/);
  assert.throws(() => validateReproductionPlan({ ...browserPlan, steps: [{ type: 'goto', target: 'https://example.com' }] }), /localhost/);
  assert.throws(() => validateReproductionPlan({ ...browserPlan, mode: 'test', setup: [], steps: [{ type: 'run-test', command: 'node exploit.js' }] }), /允许列表/);
  assert.throws(() => validateReproductionPlan({ ...browserPlan, requiresHumanApproval: false }));
  assert.throws(() => validateReproductionPlan({ ...browserPlan, steps: [{ type: 'click' }] }), /target/);
  assert.throws(() => validateReproductionPlan({ ...browserPlan, oracle: { type: 'http-status', value: '999' } }), /request|状态/);
});

test('reproduction jobs isolate owners and queue claims exactly once', () => {
  const alice = createReproductionJob('alice', { repoUrl: 'https://github.com/example/project', branch: 'main', commitSha: 'a'.repeat(40), issueNumber: 12, sourceUpdatedAt: new Date().toISOString(), plan: browserPlan });
  assert.equal(listReproductionJobs('bob', alice.repoUrl, 12).length, 0);
  assert.throws(() => getReproductionJob('bob', alice.id));
  queueReproductionJob('alice', alice.id, alice.repoUrl);
  const second = createReproductionJob('alice', { repoUrl: alice.repoUrl, commitSha: 'a'.repeat(40), issueNumber: 13, sourceUpdatedAt: new Date().toISOString(), plan: browserPlan });
  queueReproductionJob('alice', second.id, alice.repoUrl);
  const third = createReproductionJob('alice', { repoUrl: alice.repoUrl, commitSha: 'a'.repeat(40), issueNumber: 14, sourceUpdatedAt: new Date().toISOString(), plan: browserPlan });
  assert.throws(() => queueReproductionJob('alice', third.id, alice.repoUrl), /最多同时/);
  assert.equal(cancelReproductionJob('alice', second.id, alice.repoUrl).status, 'cancelled');
  pulseReproductionWorker('worker-a');
  assert.equal(reproductionWorkerOnline(), true);
  const claimed = claimReproduction('worker-a');
  assert.equal(claimed?.job.id, alice.id);
  assert.equal(claimed?.job.status, 'running');
  assert.equal(claimReproduction('worker-b'), null);
  releaseReproduction('worker-a', alice.id);
});

test('executor fails closed when Docker reproduction is disabled', async () => {
  const job = createReproductionJob('alice', { repoUrl: 'https://github.com/example/project', commitSha: 'a'.repeat(40), issueNumber: 99, sourceUpdatedAt: new Date().toISOString(), plan: browserPlan });
  queueReproductionJob('alice', job.id, job.repoUrl);
  const claim = claimReproduction('worker-test');
  assert.ok(claim);
  await executeReproduction(claim.owner, claim.job, 'worker-test');
  const final = getReproductionJob('alice', job.id);
  assert.equal(final.status, 'blocked');
  assert.match(final.error || '', /尚未启用/);
  assert.equal(final.artifacts.some(artifact => artifact.path.includes('/workspace/')), false);
});

test('pinned PR verification does not require a fork-only branch on the upstream repository', () => {
  const job = createReproductionJob('alice', { repoUrl: 'https://github.com/example/project', branch: 'fix/fork-only', commitSha: 'a'.repeat(40), issueNumber: 12, sourceUpdatedAt: '', plan: browserPlan });
  const pr = { ...job, verification: { headSha: 'b'.repeat(40) } } as typeof job;
  assert.equal(sourceCloneArguments(pr, '/scratch/source').includes('--branch'), false);
  assert.equal(sourceCloneArguments({ ...job, purpose: 'environment-preflight' }, '/scratch/source').includes('--branch'), false);
  assert.deepEqual(sourceCloneArguments(pr, '/scratch/source').slice(-3), ['--', 'https://github.com/example/project.git', '/scratch/source']);
});

test('explicit issue tags remain available to VCS build backends and unsafe refs are ignored', () => {
  const job = createReproductionJob('alice', { repoUrl: 'https://github.com/example/project', branch: '4.16.0', commitSha: 'a'.repeat(40), issueNumber: 12, sourceUpdatedAt: '', plan: browserPlan });
  assert.ok(sourceCloneArguments(job, '/scratch/source').includes('4.16.0'));
  assert.equal(sourceCloneArguments({ ...job, branch: '--upload-pack=bad' }, '/scratch/source').includes('--branch'), false);
});

test('expired worker cannot overwrite a reclaimed reproduction', () => {
  const job = createReproductionJob('alice', { repoUrl: 'https://github.com/example/project', commitSha: 'a'.repeat(40), issueNumber: 100, sourceUpdatedAt: new Date().toISOString(), plan: browserPlan });
  queueReproductionJob('alice', job.id, job.repoUrl);
  assert.ok(claimReproduction('old-worker', -1));
  assert.ok(claimReproduction('new-worker'));
  assert.throws(() => updateLeasedReproduction('alice', job.id, 'old-worker', { status: 'reproduced' }), /租约/);
  assert.equal(updateLeasedReproduction('alice', job.id, 'new-worker', { progress: 'claimed' }).status, 'running');
  assert.throws(() => cancelReproductionJob('alice', job.id, job.repoUrl), /不能取消/);
  assert.equal(getReproductionJob('alice', job.id).status, 'running');
});
