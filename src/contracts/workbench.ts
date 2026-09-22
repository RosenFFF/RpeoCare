import type { AuditRun, Evidence, RepoSnapshot } from './audit';

export interface Project { repoUrl: string; branch?: string; fullName: string; updatedAt: string }
export interface GitItem { number: number; title: string; body: string; url: string; state: string; author: string; updatedAt: string; labels: string[]; headSha?: string; files?: { path: string; status: string; additions: number; deletions: number; patch?: string }[] }
/** Where a draft came from, so reviewers can trace generated text back to the
 * report or GitHub item that supplied its context. Optional for old drafts. */
export type DraftSource =
  | { type: 'audit-check'; runId: string; checkId: string; checkTitle: string; evidence: Evidence[] }
  | { type: 'github-item'; kind: 'issue' | 'review'; number: number };

export interface Draft { id: string; kind: 'file' | 'issue' | 'review'; repoUrl: string; runId?: string; number?: number; path?: string; baseSha: string; before: string; content: string; title: string; status: 'draft' | 'publishing' | 'published' | 'uncertain'; revision: number; createdAt: string; publishedUrl?: string; source?: DraftSource }
export interface Usage { calls: number; inputTokens: number; outputTokens: number; failures: number }
export interface Workbench { project: Project | null; runs: AuditRun[]; drafts: Draft[]; usage: Usage; github: { login: string; canWrite: boolean } | null }
export interface SnapshotRecord { runId: string; snapshot: RepoSnapshot }
