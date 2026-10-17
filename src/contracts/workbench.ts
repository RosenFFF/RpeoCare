import type { AuditRun, Evidence, RepoSnapshot } from './audit';
import type { ModelSelection } from './models';
import type { InvestigationTrace } from './investigation';
import type { PolicyAssessment, PolicyObservation } from './policy';
import type { ReviewCoverage } from './review-task';

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
  policyOutdated?: boolean;
  policy?: PolicyAssessment;
  policyEvidence?: PolicyObservation[];
  investigation?: InvestigationTrace;
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
  type: 'exit-code' | 'stdout-contains' | 'stderr-contains' | 'selector-visible' | 'url-contains' | 'http-status' | 'all-steps-pass';
  value: string;
}
export interface ReproductionPlan {
  scopeLimitations?: string[];
  workingDirectory?: string;
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
  failureKind?: ExecutionFailureKind;
  steps?: VerificationStepResult[];
  environmentFingerprint?: string;
  index: number;
  result: ReproductionResult;
  durationMs: number;
  summary: string;
  startedAt: string;
  finishedAt: string;
}
export interface ContributorJourneySource {
  phase: 'setup' | 'verify';
  command: string;
  label: string;
  path: string;
  line?: number;
  origin: 'documentation' | 'manifest';
}
export interface ContributorJourneyContext {
  auditRunId: string;
  repository: string;
  documents: string[];
  sources: ContributorJourneySource[];
  derivedAt: string;
}
export interface VerificationStepResult {
  phase?: 'setup' | 'verify' | 'dependencies';
  stdout?: string;
  stderr?: string;
  failureKind?: ExecutionFailureKind;
  index?: number;
  type: ReproductionStep['type'];
  command?: string;
  target?: string;
  path?: string;
  code?: number;
  background?: boolean;
  ok: boolean;
}
export interface ReproductionJob {
  prerequisiteReviews?: import('./execution-readiness').PrerequisiteReview[];
  preflightJobId?: string;
  preflightForJobId?: string;
  preflight?: import('./execution-readiness').EnvironmentPreflight;
  failureKind?: ExecutionFailureKind;
  dependencySteps?: VerificationStepResult[];
  executionEnvironment?: Record<string, string>;
  verification?: import('./maintenance-verification').VerificationContext;
  id: string;
  repoUrl: string;
  branch?: string;
  issueNumber: number;
  sourceUpdatedAt: string;
  purpose?: 'issue-reproduction' | 'contributor-journey' | 'agent-verification' | 'environment-preflight';
  agentTaskId?: string;
  verificationRole?: 'baseline' | 'patched';
  auditRunId?: string;
  journey?: ContributorJourneyContext;
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
  verificationSteps?: VerificationStepResult[];
  phaseStartedAt?: string;
  artifacts: ReproductionArtifact[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
export type ExecutionFailureKind = 'source' | 'sandbox' | 'dependencies' | 'collection' | 'assertion' | 'setup' | 'timeout' | 'unknown';
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
  policy?: PolicyAssessment;
  coverage?: ReviewCoverage;
  snapshotFingerprint?: string;
  investigation?: InvestigationTrace;
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
export interface PullReviewSnapshot {
  coverageStatus?: ReviewCoverage['status'];
  completedBlocks?: number;
  totalBlocks?: number;
  state: 'current' | 'stale';
  findingCount: number;
  openFindingCount: number;
  acceptedFindingCount: number;
  analyzedAt: string;
}
export interface RelatedPullEvidence { number: number; title: string; url: string; headSha: string; analyzedAt: string }
export interface GitItem { number: number; title: string; body: string; url: string; state: string; author: string; updatedAt: string; labels: string[]; commentCount?: number; assignees?: string[]; milestone?: string | null; headSha?: string; baseSha?: string; totalChangedFiles?: number; filesTruncated?: boolean; headRef?: string; headRepository?: string; baseRef?: string; isDraft?: boolean; checks?: PullRequestCheck[]; checksAvailable?: boolean; snapshotWarnings?: string[]; linkedIssues?: { number: number; title: string; body: string; url: string }[]; reviewSnapshot?: PullReviewSnapshot; relatedPulls?: RelatedPullEvidence[]; comments?: GitComment[]; triage?: IssueTriage; files?: { path: string; status: string; additions: number; deletions: number; patch?: string; patchTruncated?: boolean }[] }
/** Where a draft came from, so reviewers can trace generated text back to the
 * report or GitHub item that supplied its context. Optional for old drafts. */
export type DraftSource =
  | { type: 'audit-check'; runId: string; checkId: string; checkTitle: string; evidence: Evidence[] }
  | { type: 'github-item'; kind: 'issue' | 'review'; number: number; reviewId?: string; reviewRevision?: number };

export interface DraftQualityItem { code: string; level: 'blocker' | 'warning' | 'info'; message: string }
export interface DraftPublication { url?: string; branch?: string; batchId?: string; state?: 'open' | 'closed' | 'merged' | 'comment'; checkedAt?: string; mergeSha?: string; verification?: 'not-verified' | 'passed' | 'needs-attention'; verificationRunId?: string }
export interface Draft { policyRevision?: number; investigation?: InvestigationTrace; id: string; kind: 'file' | 'issue' | 'review'; repoUrl: string; runId?: string; number?: number; path?: string; baseSha: string; before: string; content: string; title: string; status: 'draft' | 'publishing' | 'published' | 'uncertain'; revision: number; createdAt: string; publishedUrl?: string; source?: DraftSource; branch?: string; archived?: boolean; previousDraftId?: string; publication?: DraftPublication }
export interface Usage { calls: number; inputTokens: number; outputTokens: number; failures: number }
export interface Workbench { project: Project | null; runs: AuditRun[]; drafts: Draft[]; usage: Usage; github: { login: string; canWrite: boolean } | null }
export interface SnapshotRecord { runId: string; snapshot: RepoSnapshot }
