import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RepositoryReader } from '../../src/server/agent/repository';
import type { ClaimedTask } from '../../src/server/agent/store';
import { pullVerificationFiles } from '../../src/server/workbench/maintenance-verification';

const hash = (s: string) => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
function fixture() {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const entry = (content: string) => ({ path: 'value.py', type: 'blob', mode: '100644', size: Buffer.byteLength(content), sha: hash(content) });
  const before = 'value = 1\n', after = 'value = 2\n';
  const cache = { tree: JSON.stringify({ tree: [entry(after)], truncated: false }), [`revision-tree:${base}`]: JSON.stringify({ tree: [entry(before)], truncated: false }), [`blob:${hash(before)}`]: before, [`blob:${hash(after)}`]: after };
  const claim = { task: { commitSha: head, repoUrl: 'https://github.com/example/project' }, internal: { cache } } as unknown as ClaimedTask;
  let saves = 0;
  return { base, head, before, after, claim, reader: new RepositoryReader(claim, new AbortController().signal, () => { saves++; }), saves: () => saves };
}
test('PR preparation uses pinned checkpoints without a contents API request', async () => {
  const p = fixture();
  p.reader.api = async () => { throw new Error('No network expected'); };
  const files = await pullVerificationFiles('owner', p.claim.task.repoUrl, { baseSha: p.base, headSha: p.head, files: [{ path: 'value.py', status: 'modified' }], totalChangedFiles: 1 } as never, undefined, (path, sha) => p.reader.revisionFile(path, sha));
  assert.deepEqual(files, [{ path: 'value.py', before: p.before, after: p.after, created: false }]);
  assert.equal(p.saves(), 2);
});
test('revision reader rejects corrupted checkpoints, symlinks, secrets and oversized metadata', async () => {
  let p = fixture(); p.claim.internal.cache[`blob:${hash(p.before)}`] = 'tampered';
  await assert.rejects(() => p.reader.revisionFile('value.py', p.base), /指纹/);
  p = fixture(); p.claim.internal.cache[`revision-tree:${p.base}`] = JSON.stringify({ tree: [{ path: 'value.py', type: 'blob', mode: '120000', sha: hash(p.before), size: p.before.length }] });
  await assert.rejects(() => p.reader.revisionFile('value.py', p.base), /普通文件/);
  p = fixture(); await assert.rejects(() => p.reader.revisionFile('.env', p.base), /范围/);
  await assert.rejects(() => p.reader.revisionFile('value.py', 'main'), /固定/);
  p.claim.internal.cache[`revision-tree:${p.base}`] = JSON.stringify({ tree: [{ path: 'value.py', type: 'blob', mode: '100644', sha: hash(p.before), size: 20001 }] });
  await assert.rejects(() => p.reader.revisionFile('value.py', p.base), /20KB/);
});
test('a partial PR fetch resumes from a saved first blob rather than rereading it', async () => {
  const p = fixture(); delete p.claim.internal.cache[`blob:${hash(p.before)}`];
  let requests = 0;
  p.reader.api = async <T>() => { requests++; return { encoding: 'base64', size: Buffer.byteLength(p.before), content: Buffer.from(p.before).toString('base64') } as T; };
  await p.reader.revisionFile('value.py', p.base);
  const restored = new RepositoryReader(structuredClone(p.claim), new AbortController().signal, () => {});
  restored.api = async () => { throw new Error('Should reuse the saved blob'); };
  assert.equal((await restored.revisionFile('value.py', p.base)).content, p.before);
  assert.equal(requests, 1);
});
