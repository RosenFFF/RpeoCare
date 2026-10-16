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
  const taskId = initial.rows.find((row: { variant: string }) => row.variant === 'repocare')?.task.id;
  process.env.REPOCARE_DB_PATH = join(root, 'pilot.sqlite');
  process.env.REPOCARE_REPRO_ARTIFACTS = join(root, 'reproduction'); process.env.REPOCARE_REPRO_ENABLED = 'true';
  const { getTask } = await import('../src/server/agent/store');
  const { getReproductionJob, queueReproductionJob } = await import('../src/server/workbench/store');
  const { claimReproduction, releaseReproduction } = await import('../src/server/reproduction/queue');
  const { executeReproduction } = await import('../src/server/reproduction/executor');
  const { verificationHash } = await import('../src/server/workbench/maintenance-verification');
  const { db } = await import('../src/server/audit/store');
  const task = getTask('pilot', taskId); assert.ok(task); assert.ok(!['queued', 'running', 'cancelled'].includes(task.status));
  const artifact = task.artifacts.find(a => a.kind === 'verification' && !a.superseded); assert.ok(artifact?.verification);
  const context = artifact.verification; assert.equal(context.baseSha, task.commitSha); assert.equal(artifact.jobIds?.length, 2);
  const output = join(root, `execution-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), jobs = [];
  try {
    for (const id of artifact.jobIds!) {
      const job = getReproductionJob('pilot', id); assert.equal(job.status, 'awaiting-confirmation'); assert.equal(job.agentTaskId, task.id);
      assert.equal(job.plan.missingInformation.length, 0, 'Unresolved execution prerequisites require a revised proposal.');
      assert.ok(job.plan.setup.every(step => step.type === 'create-file'), 'This offline acceptance does not install dependencies.');
      assert.equal(verificationHash(job.plan), job.verificationRole === 'baseline' ? context.planHash : context.patchedPlanHash);
      queueReproductionJob('pilot', id, task.repoUrl, undefined, { fingerprint: context.fingerprint, requirementIds: context.requirements.map(r => r.id) });
      const worker = `pilot-${job.verificationRole}`, claim = claimReproduction(worker); assert.equal(claim?.job.id, id); assert.ok(claim);
      await executeReproduction(claim.owner, claim.job, worker); releaseReproduction(worker, id);
      const finished = getReproductionJob('pilot', id); jobs.push(finished);
      writeFileSync(output, JSON.stringify({ taskId, verification: context, jobs }, null, 2));
      console.log(`${job.verificationRole}: ${finished.status}, ${finished.attemptHistory.length} attempts`);
    }
    const assessment = assessVerification(context, jobs);
    writeFileSync(output, JSON.stringify({ taskId, verification: context, assessment, jobs }, null, 2));
    console.log(JSON.stringify({ assessment: assessment.state, outcomes: assessment.requirements.map(r => ({ id: r.requirement.id, outcome: r.outcome })), evidence: output }));
  } finally { db().close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Pilot execution failed'); process.exitCode = 1; });
