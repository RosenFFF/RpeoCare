import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, ownedRun } from '@/lib/audit/http';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const run = ownedRun(request, (await context.params).id);
  if (!run) return errorResponse('未找到此任务。', 404);
  return run.report ? jsonResponse(run.report) : errorResponse('本次报告尚未生成。', 409);
}
