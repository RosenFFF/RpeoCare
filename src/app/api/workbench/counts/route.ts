import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, session } from '@/server/audit/http';
import { getProject } from '@/server/workbench/store';
import { repositoryCounts } from '@/server/github/api';

export async function GET(request: NextRequest) {
  const owner = session(request), project = owner ? getProject(owner) : null;
  if (!owner || !project) return errorResponse('请先选择项目。', 404);
  try { return jsonResponse(await repositoryCounts(owner, project.repoUrl)); }
  catch { return errorResponse('Issue 和 PR 数量暂时无法读取。', 502); }
}
