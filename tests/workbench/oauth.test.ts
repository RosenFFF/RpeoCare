import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '../../src/server/audit/store';
import { accountSession, authDb, hash } from '../../src/server/github/connection';
import { GET as begin } from '../../src/app/api/auth/github/route';
import { GET as callback } from '../../src/app/api/auth/github/callback/route';

const directory = mkdtempSync(join(tmpdir(), 'repocare-oauth-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
process.env.REPOCARE_APP_URL = 'http://127.0.0.1:3000';
process.env.GITHUB_CLIENT_ID = 'test-client';
process.env.GITHUB_CLIENT_SECRET = 'test-secret';
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

test('OAuth uses PKCE, rejects mismatched state and consumes callback once', async t => {
  const start = await begin(new NextRequest('http://127.0.0.1:3000/api/auth/github?write=1'));
  const target = new URL(start.headers.get('location')!);
  assert.equal(target.origin, 'https://github.com');
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(target.searchParams.get('code_challenge'));
  const state = target.searchParams.get('state')!;
  const saved = authDb().prepare('SELECT verifier FROM oauth_states WHERE hash=?').get(hash(state)) as { verifier: string };
  const url = `http://127.0.0.1:3000/api/auth/github/callback?code=test-code&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth&state=${state}`;
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === 'https://github.com/login/oauth/access_token') {
      exchanges++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('code_verifier'), saved.verifier);
      assert.equal(body.get('code'), 'test-code');
      return Response.json({ access_token: 'mock-oauth-token', token_type: 'bearer', scope: 'repo,read:user' });
    }
    assert.equal(String(input), 'https://api.github.com/user');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer mock-oauth-token');
    return Response.json({ id: 9876, login: 'test-user' });
  });
  const rejected = await callback(new NextRequest(url, { headers: { cookie: 'repocare_oauth_state=wrong' } }));
  assert.equal(rejected.status, 400); assert.equal(exchanges, 0);
  const request = () => new NextRequest(url, { headers: { cookie: `repocare_oauth_state=${state}` } });
  const accepted = await callback(request());
  assert.equal(accepted.status, 307);
  assert.ok(accountSession(accepted.cookies.get('repocare_login')?.value));
  assert.equal((await callback(request())).status, 400);
  assert.equal(exchanges, 1);
});


test('normal GitHub login does not request repository write scope', async () => {
  const response = await begin(new NextRequest('http://127.0.0.1:3000/api/auth/github'));
  const target = new URL(response.headers.get('location')!);
  assert.equal(target.searchParams.get('scope'), 'read:user');
});

test('legacy callback without issuer remains supported', async t => {
  const start = await begin(new NextRequest('http://127.0.0.1:3000/api/auth/github'));
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'mock-legacy-token', token_type: 'bearer', scope: 'read:user' });
    assert.equal(String(input), 'https://api.github.com/user');
    return Response.json({ id: 9877, login: 'legacy-user' });
  });
  const result = await callback(new NextRequest(`http://127.0.0.1:3000/api/auth/github/callback?code=mock-code&state=${state}`, { headers: { cookie: `repocare_oauth_state=${state}` } }));
  assert.equal(result.status, 307);
  assert.ok(accountSession(result.cookies.get('repocare_login')?.value));
});

test('wrong or duplicate issuer is rejected before token exchange without leaking callback data', async t => {
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async () => { exchanges++; throw new Error('No network expected'); });
  for (const issuer of ['https://evil.example', 'https://github.com', 'https://github.com/login/oauth&iss=https://github.com/login/oauth']) {
    const start = await begin(new NextRequest('http://127.0.0.1:3000/api/auth/github'));
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const result = await callback(new NextRequest(`http://127.0.0.1:3000/api/auth/github/callback?code=mock-sensitive-code&state=${state}&iss=${issuer}`, { headers: { cookie: `repocare_oauth_state=${state}` } }));
    assert.equal(result.status, 400);
    const body = await result.text();
    assert.ok(!body.includes(state)); assert.ok(!body.includes('mock-sensitive-code')); assert.ok(!body.includes('test-secret'));
  }
  assert.equal(exchanges, 0);
});
