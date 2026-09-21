import type { AgentProgress, ModelSelection } from './models';

export type NodeId = 'repository' | 'collect' | 'rules' | 'agent' | 'report';
export type NodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CheckStatus = 'pass' | 'needs_attention' | 'unknown';
export type Category = '文档' | '协作' | '工程';

export interface Evidence { path: string; excerpt?: string; url?: string; note?: string }
export interface CheckResult { id: string; title: string; category: Category; status: CheckStatus; summary: string; evidence: Evidence[]; suggestion?: string; source: 'rule' | 'agent' }
export interface Repository { owner: string; name: string; fullName: string; url: string; description: string; branch: string; sha: string; language: string | null }
export interface RepoFile { path: string; sha: string; size?: number }
export interface FileContent { path: string; content: string; truncated: boolean; error?: string }
export interface RepoSnapshot { repository: Repository; files: RepoFile[]; treeTruncated: boolean; contents: FileContent[]; warnings: string[] }
export interface AuditNode { id: NodeId; label: string; status: NodeStatus; message: string; startedAt?: string; finishedAt?: string; completed?: number; total?: number; evidence?: Evidence[] }
export interface ToolProgress extends AgentProgress { at: string; index: number }
export interface AuditReport { runId: string; repository: Repository; generatedAt: string; checks: CheckResult[]; warnings: string[]; agentStatus: 'completed' | 'disabled' | 'failed'; scope: string; model?: ModelSelection }
export interface AuditRun { id: string; repoUrl: string; branch?: string; status: RunStatus; createdAt: string; updatedAt: string; nodes: AuditNode[]; repository?: Repository; error?: string; report?: AuditReport; seq: number; cancelRequested: boolean; retryOf?: string; model?: ModelSelection; agentEvents?: ToolProgress[] }
export interface AuditEvent { seq: number; runId: string; type: 'snapshot'; run: AuditRun }
export interface AuditCapabilities { workerOnline: boolean; agentConfigured: boolean; githubAuthenticated: boolean; model?: ModelSelection; modelError?: string }

export const nodeDefinitions: { id: NodeId; label: string }[] = [
  { id: 'repository', label: '读取仓库' },
  { id: 'collect', label: '收集文件' },
  { id: 'rules', label: '规范检查' },
  { id: 'agent', label: 'Agent 分析' },
  { id: 'report', label: '生成报告' },
];
export const isTerminal = (status: RunStatus) => ['completed', 'failed', 'cancelled'].includes(status);
