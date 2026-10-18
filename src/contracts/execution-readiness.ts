export interface PrerequisiteReview {
  sourceKey: string;
  source: string[];
  planHash?: string;
  scopeEntries: { index: number; reason: string }[];
  reviewedAt: string;
}

export interface EnvironmentPreflight {
  status: 'ready' | 'review' | 'blocked';
  checkedAt: string;
  planHash: string;
  commitSha: string;
  runnerImageId: string;
  runtime: { python?: string; pytest?: string };
  checks: { id: string; status: 'pass' | 'warning' | 'blocked' | 'unknown'; title: string; detail: string; path?: string; remedy?: string }[];
  limitations: string[];
  preparationOptions?: { id: string; path: string; command: string }[];
}
