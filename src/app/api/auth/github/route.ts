import { NextRequest, NextResponse } from 'next/server';
import * as oauth from 'oauth4webapi';
import { authDb, hash } from '@/server/github/connection';
import { oauthConfig } from '@/server/github/oauth';
import { errorResponse } from '@/server/audit/http';

export async function GET(request: NextRequest) {
  try {
    const { client, callback } = oauthConfig(); const state = oauth.generateRandomState(), verifier = oauth.generateRandomCodeVerifier(), write = request.nextUrl.searchParams.get('write') === '1';
    const database = authDb(); database.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
    database.prepare('INSERT INTO oauth_states VALUES (?, ?, ?, ?)').run(hash(state), Date.now() + 600_000, verifier, Number(write));
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', state, scope: write ? 'read:user repo' : 'read:user', code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set('repocare_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 600 });
    return response;
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法开始授权。', 503); }
}
