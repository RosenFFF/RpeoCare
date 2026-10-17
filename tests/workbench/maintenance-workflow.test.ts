import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentArtifact, MaintenanceTask } from '../../src/contracts/agent';
import type { ReproductionJob } from '../../src/contracts/workbench';
import { maintenanceWorkflow } from '../../src/shared/lib/maintenance-workflow';

const patch = { kind: 'patch', id: 'patch', evidenceIds: [] } as unknown as AgentArtifact;
const verification = { kind: 'verification', id: 'verification', jobIds: ['base', 'candidate'] } as unknown as AgentArtifact;
function task(changes: Partial<MaintenanceTask> = {}) {
  return { id: 'task', status: 'completed', artifacts: [patch, verification], evidence: [], events: [], ...changes } as unknown as MaintenanceTask;
}
function job(id: string, status: ReproductionJob['status']) {
  return { id, status, plan: { missingInformation: [] }, updatedAt: '2026-10-17T10:00:00Z' } as unknown as ReproductionJob;
}
test('empty workflow starts with an explicit model action, without claiming completed steps', () => {
  const workflow = maintenanceWorkflow(undefined, []);
  assert.equal(workflow.next.action, 'start'); assert.equal(workflow.next.model, true);
  assert.deepEqual(workflow.stages.map(stage => stage.state), ['current', 'pending', 'pending', 'pending']);
});
test('review and running execution navigate without model calls and exclude old plans', () => {
  const old = { kind: 'reproduction', id: 'older', jobIds: ['old'] } as unknown as AgentArtifact;
  const t = task({ artifacts: [old, patch, verification] });
  let workflow = maintenanceWorkflow(t, [job('old', 'awaiting-confirmation'), job('base', 'running'), job('candidate', 'queued')]);
  assert.equal(workflow.next.action, 'review'); assert.equal(workflow.next.model, false);
  assert.deepEqual(workflow.relevantJobs.map(job => job.id), ['base', 'candidate']);
  workflow = maintenanceWorkflow(t, [job('base', 'awaiting-confirmation'), job('candidate', 'awaiting-confirmation')]);
  assert.equal(workflow.next.label, '审阅并确认计划');
});
test('stale and cancelled tasks cannot offer confirmation; missing information is actionable', () => {
  assert.equal(maintenanceWorkflow(task(), [job('base', 'awaiting-confirmation')], true).next.action, 'restart');
  assert.equal(maintenanceWorkflow(task({ status: 'cancelled' }), [job('base', 'awaiting-confirmation')]).next.action, 'resume');
  assert.equal(maintenanceWorkflow(task({ status: 'waiting-input' }), []).next.action, 'supplement');
  assert.equal(maintenanceWorkflow(task({ status: 'running' }), []).next.action, 'stop');
});
test('execution results need a new read after the execution finished', () => {
  const jobs = [job('base', 'not-reproduced'), job('candidate', 'reproduced')];
  const t = task({ evidence: [{ kind: 'execution', label: '隔离执行 base', capturedAt: '2026-10-17T09:00:00Z' }] as MaintenanceTask['evidence'] });
  const workflow = maintenanceWorkflow(t, jobs);
  assert.equal(workflow.next.action, 'read-results'); assert.match(workflow.next.prompt!, /base、candidate/);
  assert.equal(workflow.next.model, true);
});
test('adding verification requires an active candidate; historical patch is excluded', () => {
  assert.equal(maintenanceWorkflow(task({ artifacts: [patch] }), []).next.action, 'prepare-verification');
  assert.equal(maintenanceWorkflow(task({ artifacts: [{ ...patch, superseded: true }] }), []).next.action, 'resume');
});
