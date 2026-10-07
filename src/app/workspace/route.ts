import { NextRequest, NextResponse } from 'next/server';
import { session } from '@/server/audit/http';
import { githubAccount } from '@/server/github/connection';
import { getOverview } from '@/server/workbench/overview';

export function GET(request: NextRequest) {
  const owner = session(request);
  const overview = getOverview(owner);
  const active = overview.latestRun && ['queued', 'running'].includes(overview.latestRun.status);
  const destination = overview.report ? '/overview' : active ? `/audit?run=${overview.latestRun!.id}` : overview.project ? '/overview' : owner && githubAccount(owner) ? '/projects' : '/audit?new=1';
  // Preserve the browser-facing host; Next may normalize 127.0.0.1 to localhost.
  // Changing hosts here would drop the cookie that selected this project.
  const target = new URL(destination, request.url);
  target.host = request.headers.get('host') || request.nextUrl.host;
  const response = NextResponse.redirect(target);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
