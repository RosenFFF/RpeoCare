/** Opt-in acceptance of a reviewed public-source Python plan; isolated DB only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateReproductionPlan } from '../src/server/reproduction/plan';

async function main() {
  if (!process.argv.includes('--reviewed')) throw new Error('Review the complete plan and source, then pass --reviewed.');
  const manifest = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const plan = validateReproductionPlan(manifest.plan);
  assert.match(manifest.repoUrl, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  assert.match(manifest.commitSha, /^[a-f0-9]{40}$/);
  const root = resolve('data', 'python-preparation-' + randomUUID()); mkdirSync(root);
  process.env.REPOCARE_DB_PATH = join(root, 'acceptance.sqlite');
  process.env.REPOCARE_REPRO_ARTIFACTS = join(root, 'reproduction');
  process.env.REPOCARE_REPRO_ENABLED = 'true';
  process.env.REPOCARE_REPRO_ALLOW_NETWORK = process.argv.includes('--allow-network') ? 'true' : 'false';
  const { createReproductionJob, getReproductionJob, queueReproductionJob, updateReproductionJob } = await import('../src/server/workbench/store');
  const { claimReproduction, releaseReproduction } = await import('../src/server/reproduction/queue');
  const { executeReproduction } = await import('../src/server/reproduction/executor');
  const { assertEnvironmentPreflight } = await import('../src/server/agent/readiness');
  const { db } = await import('../src/server/audit/store');
  const owner = 'python-acceptance', worker = 'python-acceptance-' + randomUUID();
  const job = createReproductionJob(owner, { repoUrl: manifest.repoUrl, branch: manifest.branch, commitSha: manifest.commitSha, issueNumber: 0, sourceUpdatedAt: manifest.sourceUpdatedAt || '', plan });
  const check = createReproductionJob(owner, { repoUrl: job.repoUrl, branch: job.branch, commitSha: job.commitSha!, issueNumber: 0, sourceUpdatedAt: job.sourceUpdatedAt, plan });
  updateReproductionJob(owner, check.id, { purpose: 'environment-preflight', preflightForJobId: job.id, totalAttempts: 1 });
  updateReproductionJob(owner, job.id, { purpose: 'contributor-journey', totalAttempts: 1, preflightJobId: check.id });
  const execute = async (id: string) => {
    queueReproductionJob(owner, id, job.repoUrl);
    const claim = claimReproduction(worker); assert.equal(claim?.job.id, id); assert.ok(claim);
    try { await executeReproduction(owner, claim.job, worker); }
    finally { releaseReproduction(worker, id); }
    return getReproductionJob(owner, id);
  };
  try {
    const preflight = await execute(check.id);
    writeFileSync(join(root, 'results.json'), JSON.stringify({ manifest, preflight, job: getReproductionJob(owner, job.id) }, null, 2));
    assertEnvironmentPreflight(owner, getReproductionJob(owner, job.id), { preflightId: check.id, confirmed: true });
    const finished = await execute(job.id);
    writeFileSync(join(root, 'results.json'), JSON.stringify({ manifest, preflight, job: finished }, null, 2));
    console.log(JSON.stringify({ status: finished.status, failureKind: finished.failureKind, environment: finished.environment, dependencySteps: finished.dependencySteps?.map(step => ({ command: step.command, code: step.code })), evidence: root }));
    assert.equal(finished.status, manifest.expected || 'reproduced');
  } finally { db().close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Python acceptance failed.'); process.exitCode = 1; });
