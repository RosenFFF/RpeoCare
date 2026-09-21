import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRepository, getRepository, parseRepositoryUrl } from '../../src/server/audit/github';
import { runRules } from '../../src/server/audit/rules';
import type { Repository, RepoSnapshot } from '../../src/contracts/audit';

const sha = 'a'.repeat(40);
const blobSha = 'b'.repeat(40);
const repository: Repository = { owner: 'demo', name: 'project', fullName: 'demo/project', url: 'https://github.com/demo/project', description: '', branch: 'main', sha, language: 'TypeScript' };

function snapshot(paths: string[], packageContent?: string, overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { repository, files: paths.map(path => ({ path, sha: blobSha })), treeTruncated: false, contents: packageContent === undefined ? [] : [{ path: 'package.json', content: packageContent, truncated: false }], warnings: [], ...overrides };
}

test('accepts only a public GitHub repository URL without URL tricks', () => {
  assert.deepEqual(parseRepositoryUrl(' https://github.com/demo/project.git/ '), { owner: 'demo', name: 'project', url: 'https://github.com/demo/project' });
  for (const url of [
    'http://github.com/demo/project', 'https://github.com.evil.test/demo/project',
    'https://github.com:443/demo/project', 'https://user:token@github.com/demo/project',
    'https://github.com/demo/project?x=1', 'https://github.com/demo/project#readme',
    'https://github.com/demo/project/tree/main', 'https://github.com/demo/../other/project',
    'https://github.com/demo/%2e%2e', 'https://github.com/demo/.git',
    'https://127.0.0.1/demo/project', 'git@github.com:demo/project.git',
    'https://github.com/demo/project\\extra',
  ]) assert.throws(() => parseRepositoryUrl(url), { name: 'Error' }, url);
});

test('rules report observed files and scripts with immutable SHA evidence', () => {
  const data = snapshot([
    'README.md', 'LICENSE', '.github/CONTRIBUTING.md', '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/PULL_REQUEST_TEMPLATE.md', '.github/workflows/check.yml', 'package.json',
  ], JSON.stringify({ scripts: { 'test:unit': 'node --test', lint: 'eslint .' } }));
  const checks = runRules(data);
  assert.equal(checks.length, 8);
  assert.ok(checks.every(check => check.status === 'pass'));
  assert.match(checks.find(check => check.id === 'test-entry')!.summary, /未运行测试/);
  assert.ok(checks.flatMap(check => check.evidence).every(item => item.url?.includes(`/blob/${sha}/`)));
});

test('only config.yml is not an issue template and npm placeholder is not a test entry', () => {
  const checks = runRules(snapshot(['package.json', '.github/ISSUE_TEMPLATE/config.yml'], JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })));
  assert.equal(checks.find(check => check.id === 'issue-template')!.status, 'needs_attention');
  assert.equal(checks.find(check => check.id === 'test-entry')!.status, 'needs_attention');
});

test('missing content, invalid JSON and read errors never claim scripts are absent', () => {
  const scenarios = [
    snapshot(['package.json']),
    snapshot(['package.json'], 'not json'),
    snapshot(['package.json'], '[]'),
    snapshot(['package.json'], '{}', { contents: [{ path: 'package.json', content: '', truncated: false, error: 'Request failed' }] }),
    snapshot(['package.json'], '{}', { contents: [{ path: 'package.json', content: '{}', truncated: true }] }),
  ];
  for (const data of scenarios) {
    const checks = runRules(data);
    assert.equal(checks.find(check => check.id === 'test-entry')!.status, 'unknown');
    assert.equal(checks.find(check => check.id === 'code-style')!.status, 'unknown');
  }
});

test('truncated trees cannot establish missing files, but observed files remain evidence', () => {
  const checks = runRules(snapshot(['README.md', 'package.json'], '{}', { treeTruncated: true }));
  assert.equal(checks.find(check => check.id === 'readme')!.status, 'pass');
  assert.ok(checks.filter(check => check.id !== 'readme').every(check => check.status === 'unknown'));
});

test('unsupported languages and monorepos have bounded conclusions', () => {
  const python = runRules(snapshot(['pyproject.toml', 'tests/test_main.py']));
  assert.equal(python.find(check => check.id === 'test-entry')!.status, 'unknown');
  assert.equal(python.find(check => check.id === 'code-style')!.status, 'unknown');
  for (const data of [snapshot(['package.json'], '{"workspaces":["packages/*"]}'), snapshot(['package.json', 'packages/api/package.json'], '{}')]) {
    assert.equal(runRules(data).find(check => check.id === 'test-entry')!.status, 'unknown');
  }
});

test('root lint config is recognized even if package content could not be read', () => {
  const check = runRules(snapshot(['eslint.config.mjs', 'package.json'])).find(item => item.id === 'code-style')!;
  assert.equal(check.status, 'pass');
  assert.equal(check.evidence[0].path, 'eslint.config.mjs');
  assert.match(check.summary, /未执行/);
});

test('adapter pins metadata commit, tree and blob requests and refuses redirects', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const responses: unknown[] = [
    { private: false, default_branch: 'feature/docs', description: 'Demo', language: 'TypeScript' },
    [{ sha }],
    { truncated: false, tree: [{ type: 'blob', mode: '100644', path: 'README.md', sha: blobSha, size: 5 }] },
    { encoding: 'base64', content: Buffer.from('hello').toString('base64') },
  ];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const repo = await getRepository(repository.url, new AbortController().signal);
  const progress: number[] = [];
  const collected = await collectRepository(repo, new AbortController().signal, (_message, completed) => progress.push(completed));
  assert.equal(repo.sha, sha);
  assert.equal(collected.contents[0].content, 'hello');
  assert.match(calls[1].url, /sha=feature%2Fdocs&per_page=1$/);
  assert.equal(calls[2].url, `https://api.github.com/repos/demo/project/git/trees/${sha}?recursive=1`);
  assert.equal(calls[3].url, `https://api.github.com/repos/demo/project/git/blobs/${blobSha}`);
  assert.ok(calls.every(call => call.init?.redirect === 'error'));
  assert.deepEqual(progress, [0, 1]);
});

test('adapter rejects private repositories before fetching any content', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response(JSON.stringify({ private: true, default_branch: 'main' })); });
  await assert.rejects(getRepository(repository.url, new AbortController().signal), /仅支持公开/);
  assert.equal(requests, 1);
});

test('adapter records content errors and oversized files without inventing content', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    if (requests === 1) return new Response(JSON.stringify({ truncated: true, tree: [
      { type: 'blob', mode: '100644', path: 'package.json', sha: blobSha, size: 10 },
      { type: 'blob', mode: '100644', path: 'README.md', sha: blobSha, size: 200_000 },
    ] }));
    return new Response('', { status: 404 });
  });
  const data = await collectRepository(repository, new AbortController().signal);
  assert.equal(requests, 2);
  assert.ok(data.treeTruncated);
  assert.ok(data.contents.every(content => content.error && !content.content));
  assert.equal(runRules(data).find(check => check.id === 'test-entry')!.status, 'unknown');
  assert.ok(data.warnings.some(warning => warning.includes('截断')));
});

test('adapter bounds selected file reads to eleven after one tree request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response(JSON.stringify(requests === 1 ? { truncated: false, tree: Array.from({ length: 30 }, (_, i) => ({ type: 'blob', mode: '100644', path: `.github/ISSUE_TEMPLATE/bug-${i}.md`, sha: blobSha, size: 1 })) } : { encoding: 'base64', content: 'YQ==' }));
  });
  const data = await collectRepository(repository, new AbortController().signal);
  assert.equal(requests, 12);
  assert.equal(data.contents.length, 11);
  assert.equal(data.files.length, 30);
  assert.ok(data.warnings.some(warning => warning.includes('11')));
});

test('cancellation stops collection before the next request', async t => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response('{}'); });
  await assert.rejects(collectRepository(repository, controller.signal));
  assert.equal(requests, 0);
});
