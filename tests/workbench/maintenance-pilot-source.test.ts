import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { maintenancePilotSource, pilotBlobReplay } from '../../scripts/lib/maintenance-pilot-source';

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

test('PR snapshots require the complete file list and pinned head', () => {
  const source = fixture();
  const pr = { ...source, kind: 'pr', issue: { ...source.issue, html_url: 'https://github.com/example/project/pull/2' }, pullRequest: { baseSha: 'b'.repeat(40), headSha: source.commit, baseRef: 'main', headRef: 'fix/branch', headRepository: 'contributor/project', totalChangedFiles: 1, filesTruncated: false, files: [{ path: 'src/value.py', status: 'modified', additions: 1, deletions: 1, patch: '@@ value @@', patchTruncated: false }] } };
  assert.equal(maintenancePilotSource(pr).kind, 'pr');
  assert.equal(maintenancePilotSource(pr).item.baseSha, 'b'.repeat(40));
  assert.throws(() => maintenancePilotSource({ ...pr, pullRequest: { ...pr.pullRequest, headSha: 'c'.repeat(40) } }), /different head/);
  assert.throws(() => maintenancePilotSource({ ...pr, pullRequest: { ...pr.pullRequest, totalChangedFiles: 2 } }), /incomplete/);
});

test('lazy snapshot replay does not consume the source budget before a file read', async () => {
  const source = maintenancePilotSource(fixture()), sha = Object.keys(source.cache).find(key => key.startsWith('blob:'))!.slice(5);
  let delegated = 0;
  const replay = pilotBlobReplay(source, async () => { delegated++; return Response.json({ upstream: true }); });
  assert.ok(!Object.keys(replay.cache).some(key => key.startsWith('blob:')));
  const response = await replay.fetch('https://api.github.com/repos/example/project/git/blobs/' + sha);
  const blob = await response.json(); assert.equal(Buffer.from(blob.content, 'base64').toString(), 'value = 1\n');
  assert.equal(delegated, 0);
  await replay.fetch('https://api.github.com/repos/other/project/git/blobs/' + sha);
  await replay.fetch('https://model.example/v1/chat/completions', { method: 'POST' });
  await replay.fetch(new Request('https://api.github.com/repos/example/project/git/blobs/' + sha, { method: 'POST' }));
  assert.equal(delegated, 3);
  assert.ok(source.cache['blob:' + sha]);
});

test('base revision supplement preserves pinned PR blobs without preloading them', async () => {
  const head = fixture(), base = fixture('value = 0\n');
  const input = { ...head, kind: 'pr', issue: { ...head.issue, html_url: 'https://github.com/example/project/pull/2' }, pullRequest: { baseSha: 'b'.repeat(40), headSha: head.commit, baseRef: 'main', headRef: 'fix', headRepository: 'example/project', totalChangedFiles: 1, filesTruncated: false, files: [{ path: 'src/value.py', status: 'modified', additions: 1, deletions: 1, patch: '@@', patchTruncated: false }] }, revisionTrees: { ['b'.repeat(40)]: base.tree }, blobs: { ...head.blobs, ...base.blobs } };
  const result = maintenancePilotSource(input), replay = pilotBlobReplay(result);
  assert.ok(replay.cache['revision-tree:' + 'b'.repeat(40)]);
  const response = await replay.fetch('https://api.github.com/repos/example/project/git/blobs/' + Object.keys(base.blobs)[0]);
  assert.equal(Buffer.from((await response.json()).content, 'base64').toString(), 'value = 0\n');
  assert.throws(() => maintenancePilotSource({ ...input, revisionTrees: { ['c'.repeat(40)]: base.tree } }), /pinned PR base/);
});
