import { NextRequest, NextResponse } from 'next/server';
import { accountSession } from '@/server/github/connection';

export function proxy(request: NextRequest) {
  if (process.env.REPOCARE_REQUIRE_LOGIN !== 'true') return NextResponse.next();
  if (accountSession(request.cookies.get('repocare_login')?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: '请先登录账户。' }, { status: 401 });
  return NextResponse.redirect(new URL('/?auth=login', request.url));
}
export const config = { matcher: ['/workspace', '/overview', '/audit', '/issues', '/pull-requests', '/improvements', '/settings', '/api/audit/:path*', '/api/models/:path*', '/api/workbench/:path*'] };
