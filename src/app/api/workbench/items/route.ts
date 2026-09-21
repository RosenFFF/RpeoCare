import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse, session } from '@/server/audit/http';
import { getProject } from '@/server/workbench/store';
import { getItem, listItems } from '@/server/github/api';

export async function GET(request: NextRequest) {
  try {
    const owner = session(request), project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const kind = request.nextUrl.searchParams.get('kind') === 'pulls' ? 'pulls' : 'issues';
    const number = Number(request.nextUrl.searchParams.get('number')), page = Number(request.nextUrl.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) return errorResponse('页码无效。');
    if (request.nextUrl.searchParams.has('number')) {
      if (!Number.isSafeInteger(number) || number < 1) return errorResponse('编号无效。');
      return jsonResponse({ item: await getItem(owner, project.repoUrl, kind, number) });
    }
    return jsonResponse({ items: await listItems(owner, project.repoUrl, kind, page), page });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法读取 GitHub 数据。'); }
}
