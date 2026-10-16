/** Full public-source -> queue -> leased Docker executor -> shared assessment acceptance. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { prepareMaintenanceVerification } from '../src/server/workbench/maintenance-verification';
import { assessVerification } from '../src/shared/lib/maintenance-verification';

async function main() {
  const manifest = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const root = resolve('data', `workflow-${new Date().toISOString().replace(/[:.]/g, '-')}`); mkdirSync(root, { recursive: true });
  process.env.REPOCARE_DB_PATH = join(root, 'workflow.sqlite'); process.env.REPOCARE_REPRO_ARTIFACTS = join(root, 'reproduction'); process.env.REPOCARE_REPRO_ENABLED = 'true';
  const { createReproductionJob, queueReproductionJob, getReproductionJob } = await import('../src/server/workbench/store');
  const { claimReproduction } = await import('../src/server/reproduction/queue');
  const { executeReproduction } = await import('../src/server/reproduction/executor');
  const { db } = await import('../src/server/audit/store');
  const prepared = prepareMaintenanceVerification({ ...manifest, policyRevision: 0 });
  const jobs = [];
  try {
    for (const role of ['baseline', 'patched'] as const) {
      const job = createReproductionJob('acceptance', { repoUrl: manifest.repoUrl, branch: manifest.branch, commitSha: manifest.task.commitSha, issueNumber: manifest.item.number, sourceUpdatedAt: manifest.item.updatedAt,
        agentTaskId: manifest.task.id, verificationRole: role, verification: prepared.verification, plan: prepared[role] });
      assert.throws(() => queueReproductionJob('acceptance', job.id, job.repoUrl), /逐条/);
      queueReproductionJob('acceptance', job.id, job.repoUrl, undefined, { fingerprint: prepared.verification.fingerprint, requirementIds: prepared.verification.requirements.map(r => r.id) });
      const worker = `acceptance-${role}`, claim = claimReproduction(worker); assert.equal(claim?.job.id, job.id); assert.ok(claim);
      await executeReproduction(claim.owner, claim.job, worker);
      const finished = getReproductionJob('acceptance', job.id); jobs.push(finished);
      writeFileSync(join(root, 'results.json'), JSON.stringify({ jobs }, null, 2));
      console.log(`${role}: ${finished.status}, ${finished.attemptHistory.length} attempts, ${finished.artifacts.length} artifacts`);
    }
    const assessment = assessVerification(prepared.verification, jobs);
    writeFileSync(join(root, 'results.json'), JSON.stringify({ assessment, verification: prepared.verification, jobs }, null, 2));
    assert.equal(assessment.state, manifest.expected); console.log(`Assessment: ${assessment.state}; evidence: ${root}`);
  } finally { db().close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Acceptance failed'); process.exitCode = 1; });
