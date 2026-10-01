import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getProject, getPullRequestReview, listPullReviewHistory, updatePullRequestFinding, withOperation } from '@/server/workbench/store';
import { getPullRequestReviewContext } from '@/server/github/api';
import { analyzePullRequest } from '@/server/workbench/review';
import { prepareReviewFiles, reviewFingerprint } from '@/shared/lib/pr-review-context';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('analyze'), number: z.number().int().positive(), force: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('finding'), number: z.number().int().positive(), reviewId: z.string().uuid(), revision: z.number().int().positive(), findingId: z.string().min(1).max(160), status: z.enum(['open', 'accepted', 'dismissed']), reviewerNote: z.string().max(1000).optional() }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    const number = Number(request.nextUrl.searchParams.get('number'));
    if (!owner || !project || !Number.isSafeInteger(number) || number < 1) return errorResponse('缺少 PR 审查上下文。', 404);
    if (request.nextUrl.searchParams.get('history') === '1') return jsonResponse({ history: listPullReviewHistory(owner, project.repoUrl, number) });
    if (request.nextUrl.searchParams.get('context') === '1') { const context = await getPullRequestReviewContext(owner, project.repoUrl, number, request.signal); return jsonResponse({ item: context.item, review: getPullRequestReview(owner, project.repoUrl, number) }); }
    return jsonResponse({ review: getPullRequestReview(owner, project.repoUrl, number) });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'PR 审查读取失败。'); }
}

export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const input = inputSchema.parse(await smallJson(request, 80_000));
    return await withOperation(owner, `pull-review:${input.number}`, async () => {
      if (input.action === 'finding') {
        const context = await getPullRequestReviewContext(owner, project.repoUrl, input.number, request.signal);
        const saved = getPullRequestReview(owner, project.repoUrl, input.number);
        if (!saved || saved.headSha !== context.headSha || saved.baseSha !== context.baseSha || saved.contextFingerprint !== reviewFingerprint(context.item, prepareReviewFiles(context.files))) return errorResponse('PR 已更新，请重新审查。', 409);
        return jsonResponse({ review: updatePullRequestFinding(owner, project.repoUrl, input.number, input.findingId, { status: input.status, reviewerNote: input.reviewerNote }, input.reviewId, input.revision) });
      }
      return jsonResponse({ review: await analyzePullRequest(owner, project.repoUrl, input.number, request.signal, input.force === true) });
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'PR 审查未完成。'); }
}
