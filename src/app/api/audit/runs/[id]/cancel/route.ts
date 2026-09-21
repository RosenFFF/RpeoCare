import { NextRequest } from 'next/server';
import { cancelRun } from '@/server/audit/store';
import { ensureSameOrigin, errorResponse, jsonResponse, ownedRun } from '@/server/audit/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request);
    const run = ownedRun(request, (await context.params).id);
    return run ? jsonResponse(cancelRun(run.id)) : errorResponse('未找到此任务。', 404);
  } catch { return errorResponse('请从当前站点发起操作。', 403); }
}
