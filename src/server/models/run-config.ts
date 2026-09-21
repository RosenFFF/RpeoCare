import { createRun } from '../audit/store';
import { environmentConnection } from './adapter';
import { getDefaultRuntime } from './store';
import type { ModelSelection, RuntimeConnection } from '../../contracts/models';

export function selectedConnection(owner?: string): RuntimeConnection | null {
  return (owner ? getDefaultRuntime(owner) : null) ?? environmentConnection();
}

export function publicSelection(connection: RuntimeConnection): ModelSelection {
  return { connectionId: connection.id, name: connection.name, provider: connection.provider,
    protocol: connection.protocol, modelId: connection.modelId, revision: connection.revision,
    source: connection.id === 'environment' ? 'environment' : 'settings' };
}

export function createConfiguredRun(owner: string, repoUrl: string, retryOf?: string) {
  // Capture at enqueue time, before the worker can claim it. Later edits/deletions
  // do not change this job, and even queued jobs keep their selected revision.
  return createRun(owner, repoUrl, retryOf, selectedConnection(owner));
}
