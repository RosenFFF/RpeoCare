/** Explicit operator-reviewed execution of an Agent-generated historical pilot plan. */
import assert from 'node:assert/strict';
import { loadEnvConfig } from '@next/env';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { assessVerification } from '../src/shared/lib/maintenance-verification';

async function main() {
  if (!process.argv.includes('--reviewed')) throw new Error('Review the actual patch, requirements and plans, then pass --reviewed.');
  loadEnvConfig(process.cwd());
  const dataRoot = realpathSync(resolve('data')), root = realpathSync(resolve(process.argv[2])), inside = relative(dataRoot, root);
  if (!inside.startsWith('model-pilot-') || inside.includes('/') || inside.includes('\\') || isAbsolute(inside)) throw new Error('Only an isolated local pilot may be executed.');
  const initial = JSON.parse(readFileSync(join(root, 'pilot.json'), 'utf8'));
  const variant = process.argv.find(value => value.startsWith('--variant='))?.slice(10) || 'repocare';
  assert.ok(['generic', 'repocare'].includes(variant));
  const taskId = initial.rows.find((row: { variant: string }) => row.variant === variant)?.task.id;
  process.env.REPOCARE_DB_PATH = join(root, 'pilot.sqlite');
  process.env.REPOCARE_REPRO_ARTIFACTS = join(root, 'reproduction'); process.env.REPOCARE_REPRO_ENABLED = 'true';
  process.env.REPOCARE_REPRO_ALLOW_NETWORK = process.argv.includes('--allow-dependencies') ? 'true' : 'false';
  const { getTask } = await import('../src/server/agent/store');
  const { getReproductionJob, queueReproductionJob } = await import('../src/server/workbench/store');
  const { claimReproduction, releaseReproduction } = await import('../src/server/reproduction/queue');
  const { executeReproduction } = await import('../src/server/reproduction/executor');
  const { verificationHash } = await import('../src/server/workbench/maintenance-verification');
  const { requestEnvironmentPreflight, assertEnvironmentPreflight } = await import('../src/server/agent/readiness');
  const { planPrerequisites, reportPrerequisites } = await import('../src/shared/lib/execution-readiness');
  const { db } = await import('../src/server/audit/store');
  const task = getTask('pilot', taskId); assert.ok(task); assert.ok(!['queued', 'running', 'cancelled'].includes(task.status));
  const artifact = task.artifacts.find(a => a.kind === 'verification' && !a.superseded); assert.ok(artifact?.verification);
  const context = artifact.verification; assert.equal(task.kind === 'pr' ? context.headSha : context.baseSha, task.commitSha); assert.equal(artifact.jobIds?.length, 2);
  const output = join(root, `execution-${variant}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), jobs = [], preflights = [];
  try {
    for (const id of artifact.jobIds!) {
      const job = getReproductionJob('pilot', id); assert.equal(job.status, 'awaiting-confirmation'); assert.equal(job.agentTaskId, task.id);
      assert.ok(process.argv.includes('--allow-dependencies') || job.plan.setup.every(step => step.type === 'create-file'), 'Dependency preparation requires an explicit --allow-dependencies flag.');
      assert.equal(verificationHash(job.plan), job.verificationRole === 'baseline' ? context.planHash : context.patchedPlanHash);
      const preflight = requestEnvironmentPreflight('pilot', task.id, { artifactId: artifact.id, fingerprint: context.fingerprint, jobId: id });
      const preflightWorker = `pilot-preflight-${variant}-${job.verificationRole}`, check = claimReproduction(preflightWorker); assert.equal(check?.job.id, preflight.id); assert.ok(check);
      try { await executeReproduction('pilot', check.job, preflightWorker); }
      finally { releaseReproduction(preflightWorker, preflight.id); }
      preflights.push(getReproductionJob('pilot', preflight.id));
      writeFileSync(output, JSON.stringify({ taskId, variant, verification: context, jobs, preflights }, null, 2));
      if (process.argv.includes('--preflight-only')) continue;
      const current = getReproductionJob('pilot', id);
      assert.equal(planPrerequisites(current).blockers.length, 0, 'Unresolved plan prerequisites require a revised proposal.');
      assert.equal(reportPrerequisites(task).blockers.length, 0, 'Unresolved report prerequisites require a revised proposal.');
      assertEnvironmentPreflight('pilot', current, { preflightId: preflight.id, confirmed: true, prerequisiteReviewedAt: current.prerequisiteReviews?.at(-1)?.reviewedAt });
      queueReproductionJob('pilot', id, task.repoUrl, undefined, { fingerprint: context.fingerprint, requirementIds: context.requirements.map(r => r.id) });
      const worker = `pilot-${job.verificationRole}`, claim = claimReproduction(worker); assert.equal(claim?.job.id, id); assert.ok(claim);
      await executeReproduction(claim.owner, claim.job, worker); releaseReproduction(worker, id);
      const finished = getReproductionJob('pilot', id); jobs.push(finished);
      writeFileSync(output, JSON.stringify({ taskId, variant, verification: context, jobs, preflights }, null, 2));
      console.log(`${job.verificationRole}: ${finished.status}, ${finished.attemptHistory.length} attempts`);
    }
    const assessment = assessVerification(context, jobs);
    writeFileSync(output, JSON.stringify({ taskId, variant, verification: context, assessment, jobs, preflights, preflightOnly: process.argv.includes('--preflight-only') }, null, 2));
    console.log(JSON.stringify({ assessment: assessment.state, outcomes: assessment.requirements.map(r => ({ id: r.requirement.id, outcome: r.outcome })), evidence: output }));
  } finally { db().close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Pilot execution failed'); process.exitCode = 1; });
