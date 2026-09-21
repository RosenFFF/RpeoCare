import * as oauth from 'oauth4webapi';
import { NextRequest, NextResponse } from 'next/server';
import { authDb, hash, saveGithubAccount } from '@/server/github/connection';
import { oauthConfig, githubServer } from '@/server/github/oauth';
import { errorResponse } from '@/server/audit/http';

export async function GET(request: NextRequest) {
  try {
    const state = request.nextUrl.searchParams.get('state'), code = request.nextUrl.searchParams.get('code');
    if (!state || !code || state !== request.cookies.get('repocare_oauth_state')?.value) return errorResponse('授权校验失败，请重新登录。');
    const database = authDb();
    const row = database.prepare('DELETE FROM oauth_states WHERE hash=? AND expires>? RETURNING write_access, verifier').get(hash(state), Date.now()) as { write_access: number; verifier: string } | undefined;
    if (!row) return errorResponse('授权已使用或过期，请重新登录。');
    const { client, origin, secret, callback } = oauthConfig();
    const parameters = oauth.validateAuthResponse(githubServer, client, new URL(request.url), state);
    const tokenResponse = await oauth.authorizationCodeGrantRequest(githubServer, client, oauth.ClientSecretPost(secret), parameters, callback, row.verifier, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    const tokens = await oauth.processAuthorizationCodeResponse(githubServer, client, tokenResponse);
    const token = tokens.access_token;
    const response = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'RepoCare' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('无法确认 GitHub 身份。');
    const identity = await response.json();
    if (!Number.isSafeInteger(identity.id) || typeof identity.login !== 'string') throw new Error('GitHub 身份格式异常。');
    const session = saveGithubAccount(String(identity.id), identity.login, token, !!row.write_access && (tokens.scope || '').split(/[ ,]+/).includes('repo'));
    const result = NextResponse.redirect(`${origin}/overview`);
    result.cookies.set('repocare_login', session, { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https:'), path: '/', maxAge: 30 * 86400 });
    result.cookies.delete('repocare_oauth_state'); return result;
  } catch { return errorResponse('GitHub 授权未完成，请检查回调地址和配置后重新登录。', 400); }
}
