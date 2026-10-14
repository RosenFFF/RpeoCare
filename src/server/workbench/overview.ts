import { db } from '../audit/store';
import { getProject, latestProjectContributorJourney, workbenchDb } from './store';
import type { AuditRun } from '../../contracts/audit';
import type { AuditHistoryPoint, Overview } from '../../contracts/overview';

// Query the selected repository and branch directly: a completed report must
// survive later failures, and cannot disappear behind the history page limit.
export function getOverview(owner?: string): Overview {
  const empty: Overview = { project: null, report: null, latestRun: null, draftCount: 0, journey: null, history: [] };
  if (!owner) return empty;
  const project = getProject(owner);
  if (!project) return empty;
  const where = `owner=? AND json_extract(state, '$.repoUrl')=?
    AND COALESCE(json_extract(state, '$.branch'), '')=?`;
  const args = [owner, project.repoUrl, project.branch || ''];
  const latest = db().prepare(`SELECT state FROM audit_runs WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(...args) as { state: string } | undefined;
  const completed = db().prepare(`SELECT state FROM audit_runs WHERE ${where} AND status='completed'
    AND json_extract(state, '$.report') IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(...args) as { state: string } | undefined;
  const latestRun: AuditRun | null = latest ? JSON.parse(latest.state) : null;
  const run: AuditRun | null = completed ? JSON.parse(completed.state) : null;
  const drafts = workbenchDb().prepare(`SELECT COUNT(*) AS n FROM drafts WHERE owner=?
    AND json_extract(state, '$.repoUrl')=? AND json_extract(state, '$.kind')='file'
    AND json_extract(state, '$.status')='draft' AND COALESCE(json_extract(state, '$.archived'),0)=0`).get(owner, project.repoUrl) as { n: number };
  const journey = latestProjectContributorJourney(owner, project.repoUrl);
  const history = db().prepare(`SELECT json_extract(state, '$.report') AS report FROM audit_runs
    WHERE ${where} AND status='completed' AND json_extract(state, '$.report') IS NOT NULL
    ORDER BY created_at DESC, rowid DESC LIMIT 12`).all(...args).map(row => {
    const report = JSON.parse((row as { report: string }).report) as NonNullable<AuditRun['report']>;
    const point: AuditHistoryPoint = {
      runId: report.runId, sha: report.repository.sha, generatedAt: report.generatedAt,
      pass: 0, needs_attention: 0, unknown: 0, total: report.checks.length,
      agentStatus: report.agentStatus,
      checkSet: JSON.stringify(report.checks.map(check => [check.id, check.category, check.source]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))),
    };
    for (const check of report.checks) point[check.status] += 1;
    return point;
  }).reverse();
  return {
    project, report: run?.report || null,
    latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, error: latestRun.error } : null,
    draftCount: drafts.n,
    history,
    journey: journey ? { id: journey.id, auditRunId: journey.auditRunId, status: journey.status, commitSha: journey.commitSha, progress: journey.progress, updatedAt: journey.updatedAt } : null,
  };
}
