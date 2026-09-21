import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, session } from '@/server/audit/http';
import { getOverview } from '@/server/workbench/overview';

export function GET(request: NextRequest) {
  try { return jsonResponse(getOverview(session(request))); }
  catch { return errorResponse('项目概览暂时无法读取，请重试。', 500); }
}
