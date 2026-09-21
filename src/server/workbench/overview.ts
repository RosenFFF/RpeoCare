import { db } from '../audit/store';
import { getProject, workbenchDb } from './store';
import type { AuditRun } from '../../contracts/audit';
import type { Overview } from '../../contracts/overview';

// Query the selected repository and branch directly: a completed report must
// survive later failures, and cannot disappear behind the history page limit.
export function getOverview(owner?: string): Overview {
  const empty: Overview = { project: null, report: null, latestRun: null, draftCount: 0 };
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
    AND json_extract(state, '$.status')='draft'`).get(owner, project.repoUrl) as { n: number };
  return { project, report: run?.report || null, latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, error: latestRun.error } : null, draftCount: drafts.n };
}
