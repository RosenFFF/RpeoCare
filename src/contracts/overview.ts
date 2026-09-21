import type { AuditReport, AuditRun } from './audit';
import type { Project } from './workbench';

export interface Overview {
  project: Project | null;
  report: AuditReport | null;
  latestRun: Pick<AuditRun, 'id' | 'status' | 'error'> | null;
  draftCount: number;
}
export interface RepositoryCounts {
  repoUrl: string;
  issues: number | null;
  pulls: number | null;
  issuesError?: string;
  pullsError?: string;
  fetchedAt: string;
}
