import type { ModelSelection } from './models';
import type { ReproductionJob } from './workbench';
export type MaintenanceKind = 'repository' | 'issue' | 'pr' | 'docs';
export type MaintenanceStatus = 'queued' | 'running' | 'waiting-input' | 'awaiting-confirmation' | 'completed' | 'paused' | 'failed' | 'cancelled';
export interface AgentEvidence {
    id: string;
    kind: 'file' | 'issue' | 'pr' | 'checks' | 'execution';
    label: string;
    excerpt: string;
    url?: string;
    commitSha: string;
    capturedAt: string;
}
export interface AgentFinding {
    title: string;
    detail: string;
    certainty: 'supported' | 'hypothesis';
    evidenceIds: string[];
}
export interface AgentReport {
    summary: string;
    findings: AgentFinding[];
    missingInformation: string[];
    nextSteps: string[];
}
export interface AgentPatchFile {
    path: string;
    before: string;
    after: string;
    created?: boolean;
}
export interface AgentArtifact {
    id: string;
    kind: 'reply' | 'patch' | 'reproduction' | 'verification';
    title: string;
    draftId?: string;
    jobIds?: string[];
    files?: AgentPatchFile[];
    diff?: string;
    fingerprint?: string;
    revision?: number;
    superseded?: boolean;
    patchId?: string;
    evidenceIds: string[];
    createdAt: string;
}
export interface MaintenanceTask {
    anchor?: string;
    sourceCommitSha?: string;
    id: string;
    repoUrl: string;
    requestedBranch?: string;
    branch?: string;
    commitSha?: string;
    kind: MaintenanceKind;
    number?: number;
    sourceUpdatedAt?: string;
    goal: string;
    status: MaintenanceStatus;
    model: ModelSelection;
    createdAt: string;
    updatedAt: string;
    plan: {
        title: string;
        status: 'pending' | 'active' | 'done';
    }[];
    events: {
        at: string;
        message: string;
        tool?: string;
        failed?: boolean;
    }[];
    dialogue: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        at: string;
    }[];
    evidence: AgentEvidence[];
    artifacts: AgentArtifact[];
    report?: AgentReport;
    notice?: string;
    budget: {
        turns: number;
        tools: number;
        maxTurns: number;
        maxTools: number;
        inputTokens: number;
        outputTokens: number;
        compactions: number;
    };
}
export interface RepositoryMemory {
    id: string;
    content: string;
    commitSha: string;
    evidenceIds: string[];
    taskId: string;
    createdAt: string;
    archived?: boolean;
}
export interface AgentWorkspaceData {
    tasks: MaintenanceTask[];
    task?: MaintenanceTask;
    memories: RepositoryMemory[];
    jobs: ReproductionJob[];
    workerOnline: boolean;
    reproductionWorkerOnline: boolean;
    sandboxConfigured: boolean;
}
