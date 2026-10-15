import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getIssueTriage, getProject, listIssueTriages, listPullRequestReviews } from '@/server/workbench/store';
import { getItem, listItemsPage, updateIssue } from '@/server/github/api';

export async function GET(request: NextRequest) {
  try {
    const owner = session(request), project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const expectedRepo = request.nextUrl.searchParams.get('repoUrl');
    if (expectedRepo && expectedRepo !== project.repoUrl) return errorResponse('项目已切换，请重新读取数据。', 409);
    const kind = request.nextUrl.searchParams.get('kind') === 'pulls' ? 'pulls' : 'issues';
    const number = Number(request.nextUrl.searchParams.get('number')), page = Number(request.nextUrl.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) return errorResponse('页码无效。');
    if (request.nextUrl.searchParams.has('number')) {
      if (!Number.isSafeInteger(number) || number < 1) return errorResponse('编号无效。');
      const item = await getItem(owner, project.repoUrl, kind, number);
      return jsonResponse({ item: kind === 'issues' ? { ...item, triage: getIssueTriage(owner, project.repoUrl, number) || undefined } : item });
    }
    const base = request.nextUrl.searchParams.get('base') || undefined;
    if (base && (base.length > 500 || [...base].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) return errorResponse('目标分支名称无效。');
    const { items, hasNext } = await listItemsPage(owner, project.repoUrl, kind, page, { base, signal: request.signal });
    const reviews = listPullRequestReviews(owner, project.repoUrl);
    if (kind === 'issues') {
      const triages = new Map(listIssueTriages(owner, project.repoUrl, items.map(item => item.number)).map(triage => [triage.number, triage]));
      const relatedPulls = new Map<number, { number: number; title: string; url: string; headSha: string; analyzedAt: string }[]>();
      for (const review of reviews) for (const issue of review.linkedIssues || []) {
        const related = relatedPulls.get(issue.number) || [];
        related.push({ number: review.number, title: review.title, url: `${project.repoUrl}/pull/${review.number}`, headSha: review.headSha, analyzedAt: review.analyzedAt });
        relatedPulls.set(issue.number, related);
      }
      return jsonResponse({ items: items.map(item => ({
        ...item,
        triage: triages.get(item.number),
        relatedPulls: relatedPulls.get(item.number),
      })), page });
    }
    const reviewsByNumber = new Map(reviews.map(review => [review.number, review]));
    return jsonResponse({ items: items.map(item => {
      const review = reviewsByNumber.get(item.number);
      if (!review) return item;
      const current = Boolean(item.headSha && review.headSha === item.headSha && (!item.baseSha || !review.baseSha || review.baseSha === item.baseSha));
      return {
        ...item,
        checks: current ? review.checks : undefined,
        checksAvailable: current ? review.checksAvailable : undefined,
        linkedIssues: current ? review.linkedIssues : undefined,
        reviewSnapshot: {
          state: current ? 'current' : 'stale',
          findingCount: review.findings.length,
          openFindingCount: review.findings.filter(finding => finding.status === 'open').length,
          acceptedFindingCount: review.findings.filter(finding => finding.status === 'accepted').length,
          analyzedAt: review.analyzedAt,
        },
      };
    }), page, hasNext, repoUrl: project.repoUrl, base });
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
