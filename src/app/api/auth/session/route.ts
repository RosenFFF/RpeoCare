import { NextRequest } from 'next/server';
import { accountSession, authDb, githubAccount, hash } from '@/server/github/connection';
import { ensureSameOrigin, errorResponse, jsonResponse } from '@/server/audit/http';

export async function GET(request: NextRequest) {
  const owner = accountSession(request.cookies.get('repocare_login')?.value), account = owner ? githubAccount(owner) : null;
  return jsonResponse({ configured: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET), signedIn: !!owner, account: account ? { login: account.login, canWrite: account.canWrite } : null });
}
export async function DELETE(request: NextRequest) {
  try {
    ensureSameOrigin(request); const token = request.cookies.get('repocare_login')?.value;
    if (token) authDb().prepare('DELETE FROM login_sessions WHERE hash=?').run(hash(token));
    const response = jsonResponse({ ok: true }); response.cookies.delete('repocare_login'); response.cookies.delete('repocare_audit_session'); return response;
  } catch { return errorResponse('无法退出登录。'); }
}
