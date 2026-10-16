export interface VerificationRequirement {
  id: string;
  text: string;
  quote: string;
  source: string;
  command: string;
  failureSignal: string;
  changedPaths: string[];
}

export interface VerificationContext {
  baseSha: string;
  headSha?: string;
  sourceFingerprint: string;
  pairId: string;
  patchId: string;
  fingerprint: string;
  productionHash: string;
  sharedTestsHash: string;
  planHash: string;
  patchedPlanHash: string;
  policyRevision: number;
  sourceUpdatedAt: string;
  requirements: VerificationRequirement[];
  sharedTestPaths: string[];
  regressionCommands: string[];
  confirmedAt?: string;
  confirmedRequirementIds?: string[];
}

export type RequirementOutcome = 'unconfirmed' | 'pending' | 'blocked' | 'improved' | 'still-failing' | 'not-demonstrated' | 'inconclusive' | 'stale';
export interface RequirementAssessment {
  requirement: VerificationRequirement;
  outcome: RequirementOutcome;
  reason: string;
}
export interface VerificationAssessment {
  state: RequirementOutcome;
  reason: string;
  requirements: RequirementAssessment[];
  limitations: string[];
}
