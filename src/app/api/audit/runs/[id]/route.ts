import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, ownedRun } from '@/server/audit/http';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const run = ownedRun(request, (await context.params).id);
  return run ? jsonResponse(run) : errorResponse('未找到此任务，或当前浏览器无权访问。', 404);
}
