import type { AuditRun, RepoSnapshot } from './audit';

export interface Project { repoUrl: string; branch?: string; fullName: string; updatedAt: string }
export interface GitItem { number: number; title: string; body: string; url: string; state: string; author: string; updatedAt: string; labels: string[]; headSha?: string; files?: { path: string; status: string; additions: number; deletions: number; patch?: string }[] }
export interface Draft { id: string; kind: 'file' | 'issue' | 'review'; repoUrl: string; runId?: string; number?: number; path?: string; baseSha: string; before: string; content: string; title: string; status: 'draft' | 'publishing' | 'published' | 'uncertain'; revision: number; createdAt: string; publishedUrl?: string }
export interface Usage { calls: number; inputTokens: number; outputTokens: number; failures: number }
export interface Workbench { project: Project | null; runs: AuditRun[]; drafts: Draft[]; usage: Usage; github: { login: string; canWrite: boolean } | null }
export interface SnapshotRecord { runId: string; snapshot: RepoSnapshot }
