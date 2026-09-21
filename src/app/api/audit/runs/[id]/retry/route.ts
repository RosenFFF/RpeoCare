import { NextRequest } from 'next/server';
import { createConfiguredRun } from '@/server/models/run-config';
import { saveProject } from '@/server/workbench/store';
import { isTerminal } from '@/contracts/audit';
import { ensureSameOrigin, errorResponse, jsonResponse, ownedRun, session } from '@/server/audit/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request);
    const run = ownedRun(request, (await context.params).id);
    if (!run) return errorResponse('未找到此任务。', 404);
    if (!isTerminal(run.status)) return errorResponse('任务仍在执行，请等待完成或取消。', 409);
    const next = createConfiguredRun(session(request)!, run.repoUrl, run.id, run.branch);
    saveProject(session(request)!, { repoUrl: run.repoUrl, fullName: run.repository?.fullName || run.repoUrl.replace('https://github.com/', ''), branch: run.branch });
    return jsonResponse(next, 202);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法重新体检。'); }
}
