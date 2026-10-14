import type { AuditReport, AuditRun } from './audit';
import type { Project, ReproductionStatus } from './workbench';

export interface ContributorJourneySummary {
  id: string;
  auditRunId?: string;
  status: ReproductionStatus;
  commitSha?: string;
  progress?: string;
  updatedAt: string;
}

export interface Overview {
  project: Project | null;
  report: AuditReport | null;
  latestRun: Pick<AuditRun, 'id' | 'status' | 'error'> | null;
  draftCount: number;
  journey: ContributorJourneySummary | null;
}
export interface RepositoryCounts {
  repoUrl: string;
  issues: number | null;
  pulls: number | null;
  issuesError?: string;
  pullsError?: string;
  fetchedAt: string;
}
