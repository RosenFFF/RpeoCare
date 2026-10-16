import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getProject, getPullRequestReview, listPullReviewHistory, updatePullRequestFinding, withOperation } from '@/server/workbench/store';
import { getPullRequestReviewContext } from '@/server/github/api';
import { isReviewCurrent, reviewSourceFingerprint } from '@/shared/lib/pr-review-context';
import { createReviewTask, latestReviewTask, mutateReviewTask } from '@/server/workbench/review-task-store';
import { activePolicy } from '@/server/workbench/policy';
import { selectedConnection } from '@/server/models/run-config';
import { agentWorkerOnline } from '@/server/agent/store';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ repoUrl: z.string().max(300).optional(), action: z.literal('analyze'), number: z.number().int().positive(), force: z.boolean().optional() }).strict(),
  z.object({ repoUrl: z.string().max(300).optional(), action: z.enum(['retry', 'cancel']), number: z.number().int().positive(), taskId: z.string().uuid(), blockId: z.string().uuid().optional() }).strict(),
  z.object({ repoUrl: z.string().max(300).optional(), action: z.literal('finding'), number: z.number().int().positive(), reviewId: z.string().uuid(), revision: z.number().int().positive(), findingId: z.string().min(1).max(160), status: z.enum(['open', 'accepted', 'dismissed']), reviewerNote: z.string().max(1000).optional() }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    const number = Number(request.nextUrl.searchParams.get('number'));
    if (!owner || !project || !Number.isSafeInteger(number) || number < 1) return errorResponse('缺少 PR 审查上下文。', 404);
    if (request.nextUrl.searchParams.get('history') === '1') return jsonResponse({ history: listPullReviewHistory(owner, project.repoUrl, number) });
    if (request.nextUrl.searchParams.get('context') === '1') {
      const context = await getPullRequestReviewContext(owner, project.repoUrl, number, request.signal);
      const review = getPullRequestReview(owner, project.repoUrl, number);
      const current = Boolean(review && isReviewCurrent(review, context.item) && review.policy?.revision === activePolicy(owner, project.repoUrl)?.revision);
      return jsonResponse({ item: { ...context.item, reviewSnapshot: review ? {
        coverageStatus: review.coverage?.status, completedBlocks: review.coverage?.completedBlocks, totalBlocks: review.coverage?.totalBlocks,
        state: current ? 'current' : 'stale', findingCount: review.findings.length,
        openFindingCount: review.findings.filter(finding => finding.status === 'open').length,
        acceptedFindingCount: review.findings.filter(finding => finding.status === 'accepted').length,
        analyzedAt: review.analyzedAt,
      } : undefined }, review, task: latestReviewTask(owner, project.repoUrl, number), workerOnline: agentWorkerOnline() });
    }
    return jsonResponse({ review: getPullRequestReview(owner, project.repoUrl, number), task: latestReviewTask(owner, project.repoUrl, number), workerOnline: agentWorkerOnline(), repoUrl: project.repoUrl, activePolicyRevision: activePolicy(owner, project.repoUrl)?.revision ?? null });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'PR 审查读取失败。'); }
}

export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const input = inputSchema.parse(await smallJson(request, 80_000));
    if (input.repoUrl && input.repoUrl !== project.repoUrl) return errorResponse('项目已切换，请重新加载。', 409);
    return await withOperation(owner, `pull-review:${input.number}`, async () => {
      if (input.action === 'finding') {
        const context = await getPullRequestReviewContext(owner, project.repoUrl, input.number, request.signal);
        const saved = getPullRequestReview(owner, project.repoUrl, input.number);
        if (!saved || !isReviewCurrent(saved, context.item) || saved.policy?.revision !== activePolicy(owner, project.repoUrl)?.revision) return errorResponse('PR 或项目规则已更新，请重新审查。', 409);
        return jsonResponse({ review: updatePullRequestFinding(owner, project.repoUrl, input.number, input.findingId, { status: input.status, reviewerNote: input.reviewerNote }, input.reviewId, input.revision) });
      }
      if (input.action === 'cancel' || input.action === 'retry') {
        const task = latestReviewTask(owner, project.repoUrl, input.number);
        if (!task || task.id !== input.taskId) return errorResponse('任务已变化，请刷新。', 409);
        const context = input.action === 'retry' ? await getPullRequestReviewContext(owner, project.repoUrl, input.number, request.signal) : null;
        return jsonResponse({ task: mutateReviewTask(owner, project.repoUrl, input.taskId, input.action, context ? reviewSourceFingerprint(context.item) : undefined, activePolicy(owner, project.repoUrl)?.revision, input.blockId), review: getPullRequestReview(owner, project.repoUrl, input.number), workerOnline: agentWorkerOnline() });
      }
      const connection = selectedConnection(owner); if (!connection) return errorResponse('请先配置模型连接。');
      const context = await getPullRequestReviewContext(owner, project.repoUrl, input.number, request.signal);
      return jsonResponse({ task: createReviewTask(owner, project.repoUrl, context.item, activePolicy(owner, project.repoUrl), connection, 'force' in input && input.force === true), review: getPullRequestReview(owner, project.repoUrl, input.number), workerOnline: agentWorkerOnline() });
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'PR 审查未完成。'); }
}
