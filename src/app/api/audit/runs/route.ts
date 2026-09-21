import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listRuns } from '@/lib/audit/store';
import { createConfiguredRun } from '@/lib/models/run-config';
import { parseRepositoryUrl } from '@/lib/audit/github';
import { ensureSameOrigin, errorResponse, jsonResponse, ownerOrNew, session, smallJson } from '@/lib/audit/http';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const owner = session(request);
  const limit = Number(request.nextUrl.searchParams.get('limit') || 8);
  return jsonResponse({ runs: owner ? listRuns(owner, Number.isFinite(limit) ? limit : 8) : [] });
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const parsed = z.object({ repoUrl: z.string().trim().min(1).max(300) }).safeParse(await smallJson(request));
    if (!parsed.success) return errorResponse('请填写有效的公开 GitHub 仓库地址。');
    const repository = parseRepositoryUrl(parsed.data.repoUrl);
    const owner = ownerOrNew(request);
    const run = createConfiguredRun(owner, repository.url);
    return jsonResponse(run, 202, owner, request);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法创建任务。'); }
}
