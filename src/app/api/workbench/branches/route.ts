import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, session } from '@/server/audit/http';
import { getProject } from '@/server/workbench/store';
import { listBranches } from '@/server/github/api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const owner = session(request), project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    if (request.nextUrl.searchParams.get('repoUrl') !== project.repoUrl) return errorResponse('项目已切换，请重新读取分支。', 409);
    const page = Number(request.nextUrl.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) return errorResponse('分支目录页码无效。');
    return jsonResponse(await listBranches(owner, project.repoUrl, page, request.signal));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : '分支目录无法读取。');
  }
}
