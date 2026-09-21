import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { ensureSameOrigin, smallJson, session } from '../../src/server/audit/http';

test('same origin uses incoming host when Next normalizes the internal request URL', () => {
  const request = new NextRequest('http://localhost:3000/api/audit/runs', {
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
  });
  assert.doesNotThrow(() => ensureSameOrigin(request));
  assert.throws(() => ensureSameOrigin(new NextRequest('http://localhost:3000/api/audit/runs', {
    headers: { host: '127.0.0.1:3000', origin: 'https://elsewhere.invalid' },
  })), /当前站点/);
  assert.throws(() => ensureSameOrigin(new NextRequest('http://localhost:3000/api/audit/runs', {
    headers: { host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' },
  })), /当前站点/);
});

test('request reader validates JSON content type and bounds actual bytes', async () => {
  const request = (body: string, type = 'application/json') => new NextRequest('http://localhost/api', { method: 'POST', headers: { 'content-type': type }, body });
  assert.deepEqual(await smallJson(request('{"repoUrl":"https://github.com/a/b"}')), { repoUrl: 'https://github.com/a/b' });
  await assert.rejects(smallJson(request('x'.repeat(5000))), /过长/);
  await assert.rejects(smallJson(request('{broken')), /JSON/);
  await assert.rejects(smallJson(request('{}', 'text/plain')), /JSON/);
});

test('invalid session cookie cannot become an arbitrary owner ID', () => {
  assert.equal(session(new NextRequest('http://localhost/api', { headers: { cookie: 'repocare_audit_session=arbitrary' } })), undefined);
});
