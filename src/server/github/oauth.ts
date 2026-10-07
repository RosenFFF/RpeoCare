import * as oauth from 'oauth4webapi';
export const githubServer: oauth.AuthorizationServer = { issuer: 'https://github.com/login/oauth', authorization_endpoint: 'https://github.com/login/oauth/authorize', token_endpoint: 'https://github.com/login/oauth/access_token' };
export function oauthConfig() {
  const id = process.env.GITHUB_CLIENT_ID, secret = process.env.GITHUB_CLIENT_SECRET, origin = process.env.REPOCARE_APP_URL || 'http://127.0.0.1:3000';
  if (!id || !secret) throw new Error('GitHub 登录未配置，请设置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET 和 REPOCARE_APP_URL。');
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('公网登录必须使用 HTTPS。');
  return { client: { client_id: id } satisfies oauth.Client, secret, origin: url.origin, callback: url.origin + '/api/auth/github/callback' };
}
