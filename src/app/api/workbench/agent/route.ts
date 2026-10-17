import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getProject, getReproductionJob, queueReproductionJob } from '@/server/workbench/store';
import { agentWorkerOnline, archiveMemory, contextualTask, createTask, getTask, listTasks, memories, mutateTask, remember } from '@/server/agent/store';
import { reproductionWorkerOnline } from '@/server/reproduction/queue';
import { getBranchCommit, getItem, getPullRequestReviewContext } from '@/server/github/api';
import type { MaintenanceTask } from '@/contracts/agent';
import { activePolicy } from '@/server/workbench/policy';
import { verificationSourceFingerprint, verificationHash } from '@/server/workbench/maintenance-verification';
import { assessVerification, verificationCoverage } from '@/shared/lib/maintenance-verification';
import { planPrerequisites, reportPrerequisites, requiresPythonPreflight } from '@/shared/lib/execution-readiness';
import { assertEnvironmentPreflight, prerequisiteReviewSchema, requestEnvironmentPreflight, reviewPrerequisites } from '@/server/agent/readiness';
export const runtime = 'nodejs';
const id = z.string().uuid();
const actions = z.discriminatedUnion('action', [
    prerequisiteReviewSchema.extend({ action: z.literal('review-prerequisites'), id }).strict(),
    z.object({ action: z.literal('preflight'), id, artifactId: id, fingerprint: z.string().min(1).max(100), jobId: id }).strict(),
    z.object({ action: z.literal('create'), repoUrl:z.string().url().max(500), branch:z.string().max(200).optional(), kind: z.enum(['repository', 'issue', 'pr', 'docs']), anchor:z.string().max(200).optional(), sourceCommitSha:z.string().regex(/^[a-f0-9]{40}$/i).optional(), number: z.number().int().positive().optional(), goal: z.string().trim().min(8).max(4000) }).strict(),
    z.object({ action: z.literal('message'), id, content: z.string().trim().min(1).max(4000) }).strict(),
    z.object({ action: z.literal('resume'), id }).strict(), z.object({ action: z.literal('cancel'), id }).strict(),
    z.object({ action: z.literal('confirm'), id, jobId: id, confirmed: z.literal(true), readinessReview: z.object({ preflightId: id, confirmed: z.literal(true), prerequisiteReviewedAt: z.string().optional() }).strict().optional(), review: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requirementIds: z.array(z.string().max(40)).min(1).max(8) }).strict().optional() }).strict(),
    z.object({ action: z.literal('remember'), id, content: z.string().trim().min(1).max(2000), evidenceIds: z.array(z.string().max(40)).min(1).max(12) }).strict(),
    z.object({ action: z.literal('archive-memory'), memoryId: id }).strict(),
]);
function context(request: NextRequest) { const owner = session(request), project = owner ? getProject(owner) : null; if (!owner || !project)
    throw new Error('请先连接项目。'); return { owner, project }; }
function ownedTask(owner: string, id: string, project: {
    repoUrl: string;
    branch?: string;
}): MaintenanceTask {
    const task = getTask(owner, id);
    if (!task || task.repoUrl !== project.repoUrl || (task.requestedBranch || '') !== (project.branch || ''))
        throw new Error('任务不属于当前项目与分支。');
    return task;
}
export async function GET(request: NextRequest) {
    try {
        const { owner, project } = context(request), id = request.nextUrl.searchParams.get('id');
        if(request.nextUrl.searchParams.has('repoUrl')&&(request.nextUrl.searchParams.get('repoUrl')!==project.repoUrl||(request.nextUrl.searchParams.get('branch')||'')!==(project.branch||'')))throw new Error('项目已切换，请刷新当前页面。');
        const kind=request.nextUrl.searchParams.get('kind'),number=Number(request.nextUrl.searchParams.get('number'))||undefined,anchor=request.nextUrl.searchParams.get('anchor')||undefined;
        const scoped=kind&&['issue','pr','docs','repository'].includes(kind);
        const task = id ? ownedTask(owner, id, project) : scoped?contextualTask(owner,project.repoUrl,project.branch,kind as MaintenanceTask['kind'],number,anchor)||undefined:undefined;
        const jobs = task?.artifacts.flatMap(a => a.jobIds || []).map(id => getReproductionJob(owner, id)) || [];
        jobs.push(...jobs.filter(job => job.preflightJobId).map(job => getReproductionJob(owner, job.preflightJobId!)));
        if (task) {
            const revision = activePolicy(owner, project.repoUrl)?.revision || 0;
            task.artifacts.forEach(artifact => { if (artifact.verification) artifact.verificationStale = artifact.verification.policyRevision !== revision || !!artifact.superseded; });
        }
        const exported = request.nextUrl.searchParams.get('export');
        if (exported) {
            const artifact = task?.artifacts.find(artifact => artifact.id === exported && artifact.verification);
            if (!task || !artifact?.verification) throw new Error('需求对照记录不存在。');
            const report = { schemaVersion: 1, exportedAt: new Date().toISOString(), repository: task.repoUrl, taskId: task.id, kind: task.kind, number: task.number, context: artifact.verification, assessment: assessVerification(artifact.verification, jobs, artifact.verificationStale), coverage: verificationCoverage(artifact.verification, jobs, artifact.verificationStale), scopeLimitations: task.report?.scopeLimitations || [], reportRevision: task.reportRevision || 0, reportPrerequisites: reportPrerequisites(task), prerequisiteReviews: task.prerequisiteReviews || [], environmentPreflights: jobs.filter(job => job.purpose === 'environment-preflight' && jobs.some(original => artifact.jobIds?.includes(original.id) && original.preflightJobId === job.id)), jobs: jobs.filter(job => artifact.jobIds?.includes(job.id)), freshness: '结论属于记录的固定版本；导出不自动查询 GitHub 最新提交。' };
            return new Response(JSON.stringify(report, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="repocare-verification-${task.id.slice(0, 8)}.json"`, 'cache-control': 'no-store' } });
        }
        const tasks = scoped?[]:listTasks(owner, project.repoUrl, project.branch).map(task => ({ ...task, evidence: [], events: [], dialogue: [], artifacts: [], report: undefined }));
        return jsonResponse({ tasks, task, memories: memories(owner, project.repoUrl), jobs, workerOnline: agentWorkerOnline(), reproductionWorkerOnline: reproductionWorkerOnline(), sandboxConfigured: process.env.REPOCARE_REPRO_ENABLED === 'true' });
    }
    catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Agent任务读取失败。');
    }
}
export async function POST(request: NextRequest) {
    try {
        ensureSameOrigin(request);
        const { owner, project } = context(request), input = actions.parse(await smallJson(request, 16000));
        if (input.action === 'create') {
            if(input.repoUrl!==project.repoUrl||(input.branch||'')!==(project.branch||''))throw new Error('项目或分支已切换，请刷新后重新发起任务。');
            if (['issue', 'pr'].includes(input.kind) && !input.number)
                throw new Error('请输入Issue或PR编号。');
            if (!['issue', 'pr'].includes(input.kind) && input.number)
                throw new Error('仓库任务不需要Issue/PR编号。');
            return jsonResponse({ task: createTask(owner, project, {kind:input.kind,number:input.number,goal:input.goal,anchor:input.anchor,sourceCommitSha:input.kind==='docs'?input.sourceCommitSha:undefined}) });
        }
        if (input.action === 'archive-memory') {
            archiveMemory(owner, project.repoUrl, input.memoryId);
            return jsonResponse({ ok: true });
        }
        const task = ownedTask(owner, input.id, project);
        if (input.action === 'review-prerequisites') {
            const { action: _action, id: _id, ...review } = input;
            return jsonResponse({ task: reviewPrerequisites(owner, task.id, review) });
        }
        if (input.action === 'preflight') {
            if (process.env.REPOCARE_REPRO_ENABLED !== 'true' || !reproductionWorkerOnline()) throw new Error('请先启用隔离执行器并启动复现Worker。');
            return jsonResponse({ job: requestEnvironmentPreflight(owner, task.id, input) });
        }
        if (input.action === 'remember')
            return jsonResponse({ memory: remember(owner, task, input.content, input.evidenceIds) });
        if (input.action === 'confirm') {
            if (!task.artifacts.some(a => !a.superseded && a.jobIds?.includes(input.jobId)))
                throw new Error('复现计划不属于当前任务。');
            if (['cancelled', 'running', 'queued'].includes(task.status))
                throw new Error('请等待调查结束并审阅当前方案后执行。');
            if (process.env.REPOCARE_REPRO_ENABLED !== 'true' || !reproductionWorkerOnline())
                throw new Error('请先启用Docker隔离执行器并启动复现Worker。');
            const job = getReproductionJob(owner, input.jobId);
            if (job.commitSha !== (job.verification?.baseSha || task.commitSha) || job.repoUrl !== task.repoUrl || job.sourceUpdatedAt !== task.sourceUpdatedAt || job.verification?.headSha && job.verification.headSha !== task.commitSha)
                throw new Error('任务版本不一致，请新建调查。');
            if (planPrerequisites(job).blockers.length || reportPrerequisites(task).blockers.length)
                throw new Error('计划仍有缺失信息，请补充后新建方案。');
            if (requiresPythonPreflight(job.plan)) assertEnvironmentPreflight(owner, job, input.readinessReview);
            const item = task.kind === 'pr' ? (await getPullRequestReviewContext(owner, task.repoUrl, task.number!, request.signal)).item : await getItem(owner, task.repoUrl, 'issues', task.number!, request.signal);
            const head = task.kind === 'pr' ? item.headSha : (await getBranchCommit(owner, task.repoUrl, task.branch, request.signal)).sha;
            if (head !== task.commitSha || item.updatedAt !== task.sourceUpdatedAt || job.verification && (verificationSourceFingerprint(item) !== job.verification.sourceFingerprint || item.baseSha && item.baseSha !== job.verification.baseSha))
                throw new Error('分支或Issue已更新，请基于最新版本新建任务。');
            if (job.purpose === 'agent-verification' && !job.verification) throw new Error('此历史方案没有需求与共享测试记录，请重新准备对照。');
            if (job.verification && verificationHash(job.plan) !== (job.verificationRole === 'baseline' ? job.verification.planHash : job.verification.patchedPlanHash)) throw new Error('验证计划指纹不匹配，请重新准备。');
            return jsonResponse({ job: queueReproductionJob(owner, input.jobId, project.repoUrl,()=>{
                const latest=ownedTask(owner,input.id,project);
                if(['cancelled','running','queued'].includes(latest.status)||!latest.artifacts.some(a=>!a.superseded&&a.jobIds?.includes(input.jobId)))throw new Error('调查已变化或计划已有新版本，请刷新后审阅当前方案。');
                if (reportPrerequisites(latest).blockers.length) throw new Error('阶段报告仍有未解决的执行前置条件。');
                if (requiresPythonPreflight(job.plan)) assertEnvironmentPreflight(owner, getReproductionJob(owner, job.id), input.readinessReview);
                if (job.verification && (activePolicy(owner, task.repoUrl)?.revision || 0) !== job.verification.policyRevision) throw new Error('项目规则已变化，请重新准备对照。');
            }, input.review) });
        }
        return jsonResponse({ task: mutateTask(owner, input.id, input.action, input.action === 'message' ? input.content : undefined) });
    }
    catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Agent操作未完成。');
    }
}
