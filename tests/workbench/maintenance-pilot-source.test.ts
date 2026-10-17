import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { maintenancePilotSource } from '../../scripts/lib/maintenance-pilot-source';

function fixture(text = 'value = 1\n', path = 'src/value.py', mode = '100644') {
  const bytes = Buffer.byteLength(text), sha = createHash('sha1').update(`blob ${bytes}\0`).update(text).digest('hex');
  return { repo: 'example/project', commit: 'a'.repeat(40), ref: 'v1', issueNumber: 2,
    issue: { number: 2, title: 'Handle value', body: 'Expected behavior', updated_at: '2026-10-17T00:00:00Z', state: 'open', html_url: 'https://github.com/example/project/issues/2', user: { login: 'example' } },
    tree: { truncated: false, tree: [{ path, mode, type: 'blob', sha, size: bytes }] }, blobs: { [sha]: text } };
}

test('pilot source verifies canonical UTF-8 Git blobs and preserves actual issue state', () => {
  const input = fixture('value = "测试"\n'), result = maintenancePilotSource(input);
  assert.equal(result.item.state, 'open'); assert.equal(result.number, 2);
  assert.equal(result.cache[`blob:${Object.keys(input.blobs)[0]}`], 'value = "测试"\n');
  assert.deepEqual(JSON.parse(result.cache.tree).occupied, ['src/value.py']);
});

test('pilot source rejects mutated content, wrong issue and truncated snapshots', () => {
  const changed = fixture(); changed.blobs[Object.keys(changed.blobs)[0]] = 'value = 2\n';
  assert.throws(() => maintenancePilotSource(changed), /hash or size/);
  const wrong = fixture(); wrong.issueNumber = 3;
  assert.throws(() => maintenancePilotSource(wrong), /issue does not match/);
  assert.throws(() => maintenancePilotSource({ ...fixture(), tree: { ...fixture().tree, truncated: true } }));
});

test('pilot source excludes protected paths and links from preloaded blobs', () => {
  assert.throws(() => maintenancePilotSource(fixture('private', '.env')), /readable tree/);
  assert.throws(() => maintenancePilotSource(fixture('target.py', 'src/link.py', '120000')), /readable tree/);
  assert.throws(() => maintenancePilotSource(fixture('nul\0binary')), /二进制/);
  assert.throws(() => maintenancePilotSource(fixture('token = "sk-' + 'x'.repeat(24) + '"')), /凭据/);
});
