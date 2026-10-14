import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, ownedRun, session, smallJson } from '@/server/audit/http';
import { getSnapshot } from '@/server/workbench/store';
import { cancelReproductionJob, createContributorJourneyJob, getReproductionJob, latestContributorJourney, queueReproductionJob, withOperation } from '@/server/workbench/store';
import { reproductionWorkerOnline } from '@/server/reproduction/queue';
import { createContributorJourneyPlan } from '@/server/journey/plan';

export const runtime = 'nodejs';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('plan'), force: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('confirm'), id: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('cancel'), id: z.string().uuid() }).strict(),
]);

function capabilities(job: unknown) {
  return { job, workerOnline: reproductionWorkerOnline(), sandboxConfigured: process.env.REPOCARE_REPRO_ENABLED === 'true', dependencyNetworkAllowed: process.env.REPOCARE_REPRO_ALLOW_NETWORK === 'true' };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = (await context.params).id;
    const owner = session(request);
    const run = ownedRun(request, id);
    if (!owner || !run) return errorResponse('未找到此体检任务，或当前浏览器无权访问。', 404);
    return jsonResponse(capabilities(latestContributorJourney(owner, run.id)));
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '贡献路径读取失败。'); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    ensureSameOrigin(request);
    const id = (await context.params).id;
    const owner = session(request);
    const run = ownedRun(request, id);
    if (!owner || !run) return errorResponse('未找到此体检任务，或当前浏览器无权访问。', 404);
    if (!run.report || !run.repository || run.status !== 'completed') return errorResponse('请先完成项目体检，再验证贡献路径。', 409);
    const input = actionSchema.parse(await smallJson(request, 4096));
    if (input.action === 'cancel') {
      const job = getReproductionJob(owner, input.id);
      if (job.purpose !== 'contributor-journey' || job.auditRunId !== run.id) return errorResponse('贡献路径任务与当前体检不匹配。', 409);
      return jsonResponse(capabilities(cancelReproductionJob(owner, job.id, run.repoUrl)));
    }
    if (input.action === 'confirm') {
      const job = getReproductionJob(owner, input.id);
      if (job.purpose !== 'contributor-journey' || job.auditRunId !== run.id) return errorResponse('贡献路径任务与当前体检不匹配。', 409);
      return jsonResponse(capabilities(queueReproductionJob(owner, job.id, run.repoUrl)));
    }
    return await withOperation(owner, `contributor-journey:${run.id}`, async () => {
      const existing = latestContributorJourney(owner, run.id);
      if (existing && ['queued', 'running'].includes(existing.status)) return jsonResponse(capabilities(existing));
      if (existing?.status === 'awaiting-confirmation' && !input.force) return jsonResponse(capabilities(existing));
      const snapshot = getSnapshot(run.id);
      if (!snapshot || snapshot.repository.sha !== run.repository?.sha) throw new Error('本次体检的固定文件快照不可用，请重新体检后再生成演练计划。');
      const built = createContributorJourneyPlan(snapshot);
      const job = createContributorJourneyJob(owner, {
        repoUrl: run.repoUrl, branch: run.repository.branch, commitSha: run.repository.sha,
        auditRunId: run.id, sourceUpdatedAt: run.updatedAt, plan: built.plan, journey: built.journey,
      });
      return jsonResponse(capabilities(job));
    }, false);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '贡献路径操作失败。'); }
}
