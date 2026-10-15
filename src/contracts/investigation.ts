import type { AgentEvidence } from './agent';

/** Read-only source work performed as part of an existing maintenance action. */
export interface InvestigationTrace {
  commitSha?: string;
  branch?: string;
  evidence: AgentEvidence[];
  toolCalls: number;
  modelTurns: number;
  limitations: string[];
}
