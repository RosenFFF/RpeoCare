import { saveProject } from '@/server/workbench/store';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listRuns } from '@/server/audit/store';
import { createConfiguredRun } from '@/server/models/run-config';
import { parseRepositoryUrl } from '@/server/audit/github';
import { ensureSameOrigin, errorResponse, jsonResponse, ownerOrNew, session, smallJson } from '@/server/audit/http';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const owner = session(request);
  const limit = Number(request.nextUrl.searchParams.get('limit') || 8);
  return jsonResponse({ runs: owner ? listRuns(owner, Number.isFinite(limit) ? limit : 8) : [] });
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const parsed = z.object({ repoUrl: z.string().trim().min(1).max(300), branch: z.string().trim().max(200).regex(/^[^\s~^:?*[\\]*$/).optional() }).safeParse(await smallJson(request));
    if (!parsed.success) return errorResponse('请填写有效的公开 GitHub 仓库地址。');
    const repository = parseRepositoryUrl(parsed.data.repoUrl);
    const owner = ownerOrNew(request);
    const run = createConfiguredRun(owner, repository.url, undefined, parsed.data.branch);
    saveProject(owner, { repoUrl: repository.url, fullName: `${repository.owner}/${repository.name}`, branch: parsed.data.branch });
    return jsonResponse(run, 202, owner, request);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法创建任务。'); }
}
