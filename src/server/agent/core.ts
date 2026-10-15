import type { AgentOptions } from '@mariozechner/pi-agent-core';
/** Shared pi runtime defaults for audits and persistent maintenance sessions. */
export async function createPiAgent(options: AgentOptions) {
    const {Agent}=await import('@mariozechner/pi-agent-core');
    return new Agent({ ...options, toolExecution: 'sequential', initialState: { ...options.initialState, thinkingLevel: 'off' } });
}
