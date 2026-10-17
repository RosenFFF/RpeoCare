import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePatchFiles, preparePatchFiles, preparePatchRevision } from '../../src/server/agent/patch';

function reader(contents: Record<string, string>, truncated = false, blockedParents: string[] = []) {
  return { async file(path: string) { assert.ok(Object.hasOwn(contents, path)); return { content: contents[path] }; },
    async tree() { return { tree: Object.keys(contents).map(path => ({ path })), occupied: [...Object.keys(contents), ...blockedParents], truncated, blockedParents }; } };
}
test('multiple edits use original offsets and preserve unchanged content and line endings', async () => {
  const source = 'first\r\nmiddle\r\nlast\r\n';
  const files = await preparePatchFiles([{ path: 'value.py', before: 'last', after: 'end' }, { path: 'value.py', before: 'first', after: 'a longer beginning' }], reader({ 'value.py': source }), () => true);
  assert.equal(files.length, 1); assert.equal(files[0].before, source); assert.equal(files[0].after, 'a longer beginning\r\nmiddle\r\nend\r\n');
});
test('ambiguous, overlapping, missing, unread and candidate-relative edits are rejected', async () => {
  const r = reader({ 'value.py': 'alpha beta alpha' });
  await assert.rejects(preparePatchFiles([{ path: 'value.py', before: 'alpha', after: 'x' }], r, () => true), /唯一/);
  await assert.rejects(preparePatchFiles([{ path: 'value.py', before: 'missing', after: 'x' }], r, () => true), /唯一/);
  await assert.rejects(preparePatchFiles([{ path: 'value.py', before: 'alpha beta', after: 'x' }, { path: 'value.py', before: 'beta alpha', after: 'y' }], r, () => true), /重叠/);
  await assert.rejects(preparePatchFiles([{ path: 'value.py', before: 'beta', after: 'x' }], r, () => false), /read_file/);
  await assert.rejects(preparePatchFiles([{ path: 'value.py', before: 'beta', after: 'new' }, { path: 'value.py', before: 'new', after: 'other' }], r, () => true), /唯一/);
});
test('file count and creation safeguards remain enforced with multiple edit support', async () => {
  await assert.rejects(preparePatchFiles(Array.from({ length: 5 }, (_, n) => ({ path: `f${n}.py`, before: '', after: 'new' })), reader({}), () => true), /四个文件/);
  await assert.rejects(preparePatchFiles([{ path: 'link/value.py', before: '', after: 'new' }], reader({}, false, ['link']), () => true), /符号链接/);
  await assert.rejects(preparePatchFiles([{ path: 'new.py', before: '', after: 'new' }], reader({}, true), () => true), /新增路径/);
  await assert.rejects(preparePatchFiles([{ path: '.env', before: '', after: 'new' }], reader({}), () => true));
  const files = await preparePatchFiles([{ path: 'tests/test_value.py', before: '', after: 'assert True' }], reader({}), () => false);
  assert.equal(files[0].created, true);
});

test('adding tests preserves production files while explicit replacement can discard them', () => {
  const production = { path: 'value.py', before: 'old', after: 'fixed' };
  const tests = { path: 'tests/test_value.py', before: '', after: 'new test', created: true };
  assert.deepEqual(combinePatchFiles([production], [tests]).map(file => file.path), ['tests/test_value.py', 'value.py']);
  assert.deepEqual(combinePatchFiles([production], [tests], true), [tests]);
  assert.throws(() => combinePatchFiles([production], [{ ...production, before: 'different snapshot' }]), /基准不同/);
  assert.equal(production.after, 'fixed');
});

test('explicit candidate revision edits candidate bytes but keeps original review and execution baseline', async () => {
  const previous = [{ path: 'value.py', before: 'return -1\r\n', after: 'return 0\r\n', created: false }, { path: 'tests/test_value.py', before: '', after: 'assert value() == 0\n', created: true }];
  const changes = await preparePatchRevision([{ path: 'value.py', before: 'return 0', after: 'return 1' }, { path: 'tests/test_value.py', before: '== 0', after: '== 1' }], previous, reader({ 'value.py': 'return -1\r\n' }), () => false);
  const production = changes.find(file => file.path === 'value.py')!, test = changes.find(file => file.path === 'tests/test_value.py')!;
  assert.equal(production.before, 'return -1\r\n'); assert.equal(production.after, 'return 1\r\n'); assert.equal(production.created, false);
  assert.equal(test.before, ''); assert.equal(test.created, true); assert.equal(test.after, 'assert value() == 1\n');
  assert.deepEqual(previous.map(file => file.after), ['return 0\r\n', 'assert value() == 0\n']);
  assert.equal(combinePatchFiles(previous, changes).length, 2);
  await assert.rejects(preparePatchRevision([{ path: 'value.py', before: 'return -1', after: 'return 2' }], previous, reader({}), () => true), /唯一/);
  await assert.rejects(preparePatchRevision([{ path: '.env', before: '', after: 'no' }], previous, reader({}), () => true));
});
