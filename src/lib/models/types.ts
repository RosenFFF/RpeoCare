export const protocols = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;
export type ModelProtocol = typeof protocols[number];
export interface ConnectionInput {
  name: string;
  provider: string;
  protocol: ModelProtocol;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  keyAction?: 'keep' | 'replace' | 'clear';
  contextWindow: number;
  maxTokens: number;
}
export interface ModelConnection extends Omit<ConnectionInput, 'apiKey' | 'keyAction'> {
  id: string;
  revision: number;
  hasKey: boolean;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
  test?: { ok: boolean; testedAt: string; latencyMs: number; message: string };
}
/** Server-only value: never serialize to the browser or audit state. */
export interface RuntimeConnection extends Omit<ConnectionInput, 'keyAction'> {
  apiKey: string;
  id: string;
  revision: number;
}
export interface ModelSelection {
  connectionId: string;
  name: string;
  provider: string;
  protocol: ModelProtocol;
  modelId: string;
  revision: number;
  source: 'settings' | 'environment';
}
export interface ModelSettingsResponse {
  connections: ModelConnection[];
  defaultId: string | null;
  environmentConfigured: boolean;
}
export interface ConnectionTestResult { ok: boolean; latencyMs: number; message: string }
export interface CatalogModel { id: string; name: string; provider: string; protocol: ModelProtocol; contextWindow: number; maxTokens: number }
export interface AgentProgress { kind: 'turn' | 'tool_start' | 'tool_end'; message: string; tool?: string; failed?: boolean }
