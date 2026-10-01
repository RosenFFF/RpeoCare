import type { AuditRun, Evidence, RepoSnapshot } from './audit';
import type { ModelSelection } from './models';

export interface Project { repoUrl: string; branch?: string; fullName: string; updatedAt: string }
export interface GitComment { id: number; body: string; url: string; author: string; createdAt: string; updatedAt: string }
export type IssueCategory = 'bug' | 'feature' | 'question' | 'documentation' | 'performance' | 'compatibility' | 'security' | 'other';
export type IssuePriority = 'high' | 'medium' | 'low' | 'unknown';
export type IssueConfidence = 'high' | 'medium' | 'low';
export type IssueAction = 'request-information' | 'reply' | 'investigate' | 'consider-feature' | 'close' | 'manual-review';
export type IssueWorkflowStatus = 'untriaged' | 'needs-info' | 'ready-to-reproduce' | 'ready-to-reply' | 'investigate' | 'replied' | 'manual-review';
export type IssueReadinessLevel = 'ready' | 'partial' | 'insufficient';
export interface IssueTriageReview {
  category?: IssueCategory;
  priority?: IssuePriority;
  workflowStatus?: IssueWorkflowStatus;
  note?: string;
  confirmedAt: string;
}
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
  readinessScore?: number;
  readinessLevel?: IssueReadinessLevel;
  readinessBlockers?: string[];
  rationale?: string[];
  review?: IssueTriageReview;
  commentsZh: { id: number; bodyZh: string }[];
  analyzedAt: string;
}

export type ReproductionMode = 'command' | 'browser' | 'http' | 'test';
export type ReproductionStatus = 'draft' | 'awaiting-confirmation' | 'queued' | 'running' | 'reproduced' | 'not-reproduced' | 'blocked' | 'unsafe' | 'failed' | 'cancelled';
export type ReproductionResult = 'reproduced' | 'not-reproduced' | 'blocked' | 'unsafe' | 'failed';
export type ReproductionPhase = 'planning' | 'source' | 'dependencies' | 'execution' | 'evidence';
export type ReproductionEvidenceKind = 'stdout' | 'stderr' | 'screenshot' | 'trace' | 'video' | 'network' | 'console' | 'stacktrace' | 'test-result';
export interface ReproductionStep {
  type: 'goto' | 'click' | 'fill' | 'expect' | 'run-test' | 'run-command' | 'create-file' | 'request';
  target?: string;
  value?: string;
  command?: string;
  path?: string;
  content?: string;
  expected?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: string;
  background?: boolean;
}
export interface ReproductionOracle {
  type: 'exit-code' | 'stdout-contains' | 'stderr-contains' | 'selector-visible' | 'url-contains' | 'http-status';
  value: string;
}
export interface ReproductionPlan {
  mode: ReproductionMode;
  confidence: IssueConfidence;
  summary: string;
  environment: { language?: string; version?: string; os?: string; dependencies: string[] };
  setup: ReproductionStep[];
  steps: ReproductionStep[];
  oracle: ReproductionOracle;
  expected: string;
  evidence: ReproductionEvidenceKind[];
  risks: string[];
  missingInformation: string[];
  requiresHumanApproval: boolean;
}
export interface ReproductionArtifact {
  id: string;
  kind: ReproductionEvidenceKind | 'plan' | 'result' | 'source-log';
  path: string;
  sha256: string;
  contentType: string;
  size: number;
  createdAt: string;
}
export interface ReproductionAttempt {
  index: number;
  result: ReproductionResult;
  durationMs: number;
  summary: string;
  startedAt: string;
  finishedAt: string;
}
export interface ReproductionJob {
  id: string;
  repoUrl: string;
  branch?: string;
  issueNumber: number;
  sourceUpdatedAt: string;
  plan: ReproductionPlan;
  status: ReproductionStatus;
  phase?: ReproductionPhase;
  progress?: string;
  attempts: number;
  successfulAttempts: number;
  attemptHistory: ReproductionAttempt[];
  result?: ReproductionResult;
  commitSha?: string;
  environment?: Record<string, string>;
  currentAttempt?: number;
  totalAttempts?: number;
  currentStep?: number;
  totalSteps?: number;
  currentStepLabel?: string;
  phaseStartedAt?: string;
  artifacts: ReproductionArtifact[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
export type ReviewFindingSeverity = 'blocking' | 'warning' | 'suggestion' | 'info';
export type ReviewFindingStatus = 'open' | 'accepted' | 'dismissed';
export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: 'correctness' | 'security' | 'performance' | 'tests' | 'maintainability' | 'compatibility' | 'scope';
  title: string;
  explanation: string;
  path?: string;
  line?: number;
  evidence?: string;
  confidence: IssueConfidence;
  status: ReviewFindingStatus;
  reviewerNote?: string;
  evidenceVerified?: boolean;
  reviewedAt?: string;
  side?: 'LEFT' | 'RIGHT';
}
export interface PullRequestCheck { name: string; status: 'queued' | 'in_progress' | 'completed' | 'unknown'; conclusion?: string | null; detailsUrl?: string; startedAt?: string; completedAt?: string }
export interface PullRequestReview {
  id: string;
  revision: number;
  repoUrl: string;
  number: number;
  headSha: string;
  baseSha?: string;
  title: string;
  summary: string;
  scope: { files: number; totalFiles?: number; filesComplete?: boolean; additions: number; deletions: number; truncatedFiles: number; reviewedFiles: string[]; testFiles?: string[]; docsFiles?: string[] };
  checks: PullRequestCheck[];
  checksAvailable?: boolean;
  contextFingerprint?: string;
  model?: ModelSelection;
  linkedIssues?: { number: number; title: string; body: string; url: string }[];
  findings: ReviewFinding[];
  limitations: string[];
  analyzedAt: string;
  promptVersion: string;
}
export interface GitItem { number: number; title: string; body: string; url: string; state: string; author: string; updatedAt: string; labels: string[]; commentCount?: number; assignees?: string[]; milestone?: string | null; headSha?: string; baseSha?: string; totalChangedFiles?: number; filesTruncated?: boolean; headRef?: string; baseRef?: string; isDraft?: boolean; checks?: PullRequestCheck[]; checksAvailable?: boolean; snapshotWarnings?: string[]; linkedIssues?: { number: number; title: string; body: string; url: string }[]; comments?: GitComment[]; triage?: IssueTriage; files?: { path: string; status: string; additions: number; deletions: number; patch?: string; patchTruncated?: boolean }[] }
/** Where a draft came from, so reviewers can trace generated text back to the
 * report or GitHub item that supplied its context. Optional for old drafts. */
export type DraftSource =
  | { type: 'audit-check'; runId: string; checkId: string; checkTitle: string; evidence: Evidence[] }
  | { type: 'github-item'; kind: 'issue' | 'review'; number: number; reviewId?: string; reviewRevision?: number };

export interface Draft { id: string; kind: 'file' | 'issue' | 'review'; repoUrl: string; runId?: string; number?: number; path?: string; baseSha: string; before: string; content: string; title: string; status: 'draft' | 'publishing' | 'published' | 'uncertain'; revision: number; createdAt: string; publishedUrl?: string; source?: DraftSource }
export interface Usage { calls: number; inputTokens: number; outputTokens: number; failures: number }
export interface Workbench { project: Project | null; runs: AuditRun[]; drafts: Draft[]; usage: Usage; github: { login: string; canWrite: boolean } | null }
export interface SnapshotRecord { runId: string; snapshot: RepoSnapshot }
