import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, session } from '@/server/audit/http';
import { getProjectActivity } from '@/server/workbench/activity';

export function GET(request: NextRequest) {
  try { return jsonResponse(getProjectActivity(session(request))); }
  catch { return errorResponse('暂时无法读取维护待办，请重试。', 500); }
}
