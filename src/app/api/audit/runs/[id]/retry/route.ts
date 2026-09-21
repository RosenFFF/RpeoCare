import { NextRequest } from 'next/server';
import { createConfiguredRun } from '@/server/models/run-config';
import { isTerminal } from '@/contracts/audit';
import { ensureSameOrigin, errorResponse, jsonResponse, ownedRun, session } from '@/server/audit/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request);
    const run = ownedRun(request, (await context.params).id);
    if (!run) return errorResponse('未找到此任务。', 404);
    if (!isTerminal(run.status)) return errorResponse('任务仍在执行，请等待完成或取消。', 409);
    return jsonResponse(createConfiguredRun(session(request)!, run.repoUrl, run.id), 202);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法重新体检。'); }
}
