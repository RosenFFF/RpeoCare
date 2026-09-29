import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getIssueTriage, getProject, listIssueTriages } from '@/server/workbench/store';
import { getItem, listItems, updateIssue } from '@/server/github/api';

export async function GET(request: NextRequest) {
  try {
    const owner = session(request), project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const kind = request.nextUrl.searchParams.get('kind') === 'pulls' ? 'pulls' : 'issues';
    const number = Number(request.nextUrl.searchParams.get('number')), page = Number(request.nextUrl.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) return errorResponse('页码无效。');
    if (request.nextUrl.searchParams.has('number')) {
      if (!Number.isSafeInteger(number) || number < 1) return errorResponse('编号无效。');
      const item = await getItem(owner, project.repoUrl, kind, number);
      return jsonResponse({ item: kind === 'issues' ? { ...item, triage: getIssueTriage(owner, project.repoUrl, number) || undefined } : item });
    }
    const items = await listItems(owner, project.repoUrl, kind, page);
    if (kind === 'issues') {
      const triages = new Map(listIssueTriages(owner, project.repoUrl, items.map(item => item.number)).map(triage => [triage.number, triage]));
      return jsonResponse({ items: items.map(item => ({ ...item, triage: triages.get(item.number) })), page });
    }
    return jsonResponse({ items, page });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法读取 GitHub 数据。'); }
}

const updateSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']).optional(),
  labels: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  assignees: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
}).strict().refine(value => value.state !== undefined || value.labels !== undefined || value.assignees !== undefined, { message: '没有可保存的 Issue 变更。' });

export async function PATCH(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const owner = session(request), project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const input = updateSchema.parse(await smallJson(request, 40_000));
    return jsonResponse({ item: await updateIssue(owner, project.repoUrl, input.number, input, request.signal) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Issue 更新失败。');
  }
}
