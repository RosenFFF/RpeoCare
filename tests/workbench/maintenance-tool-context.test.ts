import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { db } from '../../src/server/audit/store';
import { saveConnection } from '../../src/server/models/store';
import { createTask, claimTask } from '../../src/server/agent/store';
import { RepositoryReader } from '../../src/server/agent/repository';
import { maintenanceTools } from '../../src/server/agent/tools';

const root = mkdtempSync(join(tmpdir(), 'repocare-tool-context-'));
process.env.REPOCARE_DB_PATH = join(root, 'test.sqlite');
after(() => { db().close(); assert.ok(!relative(tmpdir(), root).startsWith('..')); rmSync(root, { recursive: true, force: true }); });

test('maintenance tools accept root browsing and normalize common plan status without changing stored contract', async () => {
  const { validateToolArguments } = await import('@mariozechner/pi-ai');
  saveConnection('context', { name: 'mock', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://model.example/v1', modelId: 'mock', apiKey: 'mock', keyAction: 'replace', contextWindow: 128000, maxTokens: 1024 });
  createTask('context', { repoUrl: 'https://github.com/example/project' }, { kind: 'issue', number: 1, goal: '修复问题' });
  const claim = claimTask('context-worker'); assert.ok(claim);
  claim.task.commitSha = 'a'.repeat(40);
  claim.internal.cache.tree = JSON.stringify({ tree: [{ path: 'src/value.py', type: 'blob', mode: '100644', sha: 'b'.repeat(40) }], truncated: false });
  const reader = new RepositoryReader(claim, new AbortController().signal), tools = await maintenanceTools(reader);
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(tool => tool.name === name)!;
    return tool.execute('call', validateToolArguments(tool, { type: 'toolCall', id: 'call', name, arguments: args }));
  };
  const listing = await invoke('list_files', { prefix: '' });
  assert.match(JSON.stringify(listing), /src\/value.py/);
  await invoke('set_plan', { steps: [{ title: '读取源码', status: 'in_progress' }] });
  assert.equal(claim.task.plan[0].status, 'active');
  const tool = tools.find(tool => tool.name === 'set_plan')!;
  assert.throws(() => validateToolArguments(tool, { type: 'toolCall', id: 'call', name: tool.name, arguments: { steps: [{ title: '读取', status: 'invented' }] } }));

  const environment = JSON.parse((await invoke('read_verification_environment', {})).content.filter(block => block.type === 'text').map(block => block.text).join('')).untrustedData;
  assert.equal(environment.observed, false); assert.ok(environment.moduleSearchPaths.includes('<workspace>/src'));
  assert.equal(environment.limits.automaticExecution, false);
  assert.equal(environment.planSchema, undefined);
  const advanced = JSON.parse((await invoke('read_verification_environment', { includePlanSchema: true })).content.filter(block => block.type === 'text').map(block => block.text).join('')).untrustedData;
  assert.ok(advanced.planSchema.properties.steps);
  assert.equal(advanced.observed, false);

  claim.task.artifacts = [{ id: 'old', kind: 'patch', title: '旧版本', createdAt: '', evidenceIds: [], superseded: true, revision: 1, files: [{ path: 'src/value.py', before: '', after: 'OLD' }] },
    { id: 'current', kind: 'patch', title: '候选', createdAt: '', evidenceIds: [], revision: 2, files: [{ path: 'src/value.py', before: '', after: Array.from({ length: 125 }, (_, i) => String(i + 1)).join('\n') }] }];
  const candidate = JSON.parse((await invoke('read_patch_file', { path: 'src/value.py' })).content.filter(block => block.type === 'text').map(block => block.text).join('')).untrustedData;
  assert.equal(candidate.patchId, 'current'); assert.equal(candidate.revision, 2); assert.equal(candidate.scope, 'unexecuted-candidate'); assert.equal(candidate.nextLine, 121);
  assert.equal(candidate.content.split('\n').length, 120); assert.equal(claim.task.evidence.length, 0);
  await assert.rejects(invoke('propose_patch', { title: '修订', evidenceIds: ['Eknown'], basePatchId: 'old', edits: [{ path: 'src/value.py', before: '1\n2', after: '0\n2' }] }), /证据/);
  claim.task.evidence.push({ id: 'Eknown', kind: 'file', label: 'src/value.py:1-2', excerpt: 'original', capturedAt: '', commitSha: claim.task.commitSha });
  await assert.rejects(invoke('propose_patch', { title: '修订', evidenceIds: ['Eknown'], basePatchId: 'old', edits: [{ path: 'src/value.py', before: '1\n2', after: '0\n2' }] }), /候选版本已变化/);
  claim.task.artifacts[1].files![0].before = 'original';
  const revised = await invoke('propose_patch', { title: '修订', evidenceIds: ['Eknown'], basePatchId: 'current', edits: [{ path: 'src/value.py', before: '1\n2\n', after: '0\n2\n' }] });
  assert.match(JSON.stringify(revised), /patch/);
  const current = claim.task.artifacts.find(artifact => artifact.kind === 'patch' && !artifact.superseded)!;
  assert.equal(current.files![0].before, 'original'); assert.ok(current.files![0].after.startsWith('0\n2\n')); assert.equal(current.revision, 3);
  await assert.rejects(invoke('read_patch_file', { path: '.env' }), /读取范围/);
  await assert.rejects(invoke('read_patch_file', { path: 'missing.py' }), /当前候选/);
  const readOnly = await maintenanceTools(reader, true);
  assert.ok(readOnly.some(tool => tool.name === 'read_verification_environment')); assert.ok(!readOnly.some(tool => tool.name === 'read_patch_file'));
  claim.internal.cache[`blob:${'b'.repeat(40)}`] = 'sk-' + 'x'.repeat(24);
  await assert.rejects(reader.file('src/value.py'), /凭据/);
  claim.internal.cache[`blob:${'b'.repeat(40)}`] = 'binary\0data';
  await assert.rejects(reader.file('src/value.py'), /二进制/);
});
