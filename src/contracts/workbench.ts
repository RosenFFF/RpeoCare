import type { AuditRun, Evidence, RepoSnapshot } from './audit';

export interface Project { repoUrl: string; branch?: string; fullName: string; updatedAt: string }
export interface GitComment { id: number; body: string; url: string; author: string; createdAt: string; updatedAt: string }
export type IssueCategory = 'bug' | 'feature' | 'question' | 'documentation' | 'performance' | 'compatibility' | 'security' | 'other';
export type IssuePriority = 'high' | 'medium' | 'low' | 'unknown';
export type IssueConfidence = 'high' | 'medium' | 'low';
export type IssueAction = 'request-information' | 'reply' | 'investigate' | 'consider-feature' | 'close' | 'manual-review';
export type IssueWorkflowStatus = 'untriaged' | 'needs-info' | 'ready-to-reply' | 'investigate' | 'replied' | 'manual-review';
export interface IssueTriage {
  repoUrl: string;
  number: number;
  sourceUpdatedAt: string;
  category: IssueCategory;
  priority: IssuePriority;
  confidence: IssueConfidence;
  needsMoreInfo: boolean;
  language: string;
  titleZh: string;
  summaryZh: string;
  bodyZh?: string;
  actualBehavior?: string;
  expectedBehavior?: string;
  environment?: string;
  providedInformation: string[];
  missingInformation: string[];
  suggestedLabels: string[];
  suggestedAction: IssueAction;
  workflowStatus: IssueWorkflowStatus;
  commentsZh: { id: number; bodyZh: string }[];
  analyzedAt: string;
}
export interface GitItem { number: number; title: string; body: string; url: string; state: string; author: string; updatedAt: string; labels: string[]; commentCount?: number; assignees?: string[]; milestone?: string | null; headSha?: string; comments?: GitComment[]; triage?: IssueTriage; files?: { path: string; status: string; additions: number; deletions: number; patch?: string }[] }
/** Where a draft came from, so reviewers can trace generated text back to the
 * report or GitHub item that supplied its context. Optional for old drafts. */
export type DraftSource =
  | { type: 'audit-check'; runId: string; checkId: string; checkTitle: string; evidence: Evidence[] }
  | { type: 'github-item'; kind: 'issue' | 'review'; number: number };

export interface Draft { id: string; kind: 'file' | 'issue' | 'review'; repoUrl: string; runId?: string; number?: number; path?: string; baseSha: string; before: string; content: string; title: string; status: 'draft' | 'publishing' | 'published' | 'uncertain'; revision: number; createdAt: string; publishedUrl?: string; source?: DraftSource }
export interface Usage { calls: number; inputTokens: number; outputTokens: number; failures: number }
export interface Workbench { project: Project | null; runs: AuditRun[]; drafts: Draft[]; usage: Usage; github: { login: string; canWrite: boolean } | null }
export interface SnapshotRecord { runId: string; snapshot: RepoSnapshot }
