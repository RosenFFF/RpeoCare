import type { ModelSelection } from './models';
export type ReviewTaskStatus = 'queued' | 'running' | 'completed' | 'partial' | 'cancelled' | 'stale';
export interface ReviewBlock { id: string; path: string; part: number; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; attempts: number; reason?: string; summary?: string; finishedAt?: string }
export interface PullReviewTask { id: string; repoUrl: string; number: number; headSha: string; baseSha: string; status: ReviewTaskStatus; createdAt: string; updatedAt: string; blocks: ReviewBlock[]; model: ModelSelection; policyRevision?: number; notice?: string; totalFiles: number; filesRead: number; filesComplete: boolean; revision: number }
export interface ReviewCoverage { taskId: string; status: ReviewTaskStatus; completeFiles: string[]; partialFiles: string[]; unreviewedFiles: string[]; unreadFiles: number; completedBlocks: number; totalBlocks: number }
