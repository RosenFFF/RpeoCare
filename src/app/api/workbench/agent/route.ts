import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getProject, getReproductionJob, queueReproductionJob } from '@/server/workbench/store';
import { agentWorkerOnline, archiveMemory, createTask, getTask, listTasks, memories, mutateTask, remember } from '@/server/agent/store';
import { reproductionWorkerOnline } from '@/server/reproduction/queue';
import { getBranchCommit, getItem } from '@/server/github/api';
import type { MaintenanceTask } from '@/contracts/agent';
export const runtime = 'nodejs';
const id = z.string().uuid();
const actions = z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), repoUrl:z.string().url().max(500), branch:z.string().max(200).optional(), kind: z.enum(['repository', 'issue', 'pr', 'docs']), number: z.number().int().positive().optional(), goal: z.string().trim().min(8).max(4000) }).strict(),
    z.object({ action: z.literal('message'), id, content: z.string().trim().min(1).max(4000) }).strict(),
    z.object({ action: z.literal('resume'), id }).strict(), z.object({ action: z.literal('cancel'), id }).strict(),
    z.object({ action: z.literal('confirm'), id, jobId: id, confirmed: z.literal(true) }).strict(),
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
        const task = id ? ownedTask(owner, id, project) : undefined;
        const jobs = task?.artifacts.flatMap(a => a.jobIds || []).map(id => getReproductionJob(owner, id)) || [];
        const tasks = listTasks(owner, project.repoUrl, project.branch).map(task => ({ ...task, evidence: [], events: [], dialogue: [], artifacts: [], report: undefined }));
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
            return jsonResponse({ task: createTask(owner, project, {kind:input.kind,number:input.number,goal:input.goal}) });
        }
        if (input.action === 'archive-memory') {
            archiveMemory(owner, project.repoUrl, input.memoryId);
            return jsonResponse({ ok: true });
        }
        const task = ownedTask(owner, input.id, project);
        if (input.action === 'remember')
            return jsonResponse({ memory: remember(owner, task, input.content, input.evidenceIds) });
        if (input.action === 'confirm') {
            if (!task.artifacts.some(a => !a.superseded && a.jobIds?.includes(input.jobId)))
                throw new Error('复现计划不属于当前任务。');
            if (task.status === 'cancelled')
                throw new Error('已取消的任务不能执行计划。');
            if (process.env.REPOCARE_REPRO_ENABLED !== 'true' || !reproductionWorkerOnline())
                throw new Error('请先启用Docker隔离执行器并启动复现Worker。');
            const job = getReproductionJob(owner, input.jobId);
            if (job.commitSha !== task.commitSha || job.repoUrl !== task.repoUrl || job.sourceUpdatedAt !== task.sourceUpdatedAt)
                throw new Error('任务版本不一致，请新建调查。');
            if (job.plan.missingInformation.length)
                throw new Error('计划仍有缺失信息，请补充后新建方案。');
            const [head, item] = await Promise.all([getBranchCommit(owner, task.repoUrl, task.branch, request.signal), getItem(owner, task.repoUrl, 'issues', task.number!, request.signal)]);
            if (head.sha !== task.commitSha || item.updatedAt !== task.sourceUpdatedAt)
                throw new Error('分支或Issue已更新，请基于最新版本新建任务。');
            return jsonResponse({ job: queueReproductionJob(owner, input.jobId, project.repoUrl,()=>{
                const latest=ownedTask(owner,input.id,project);
                if(latest.status==='cancelled'||!latest.artifacts.some(a=>!a.superseded&&a.jobIds?.includes(input.jobId)))throw new Error('调查已停止或计划已有新版本，请刷新后审阅当前方案。');
            }) });
        }
        return jsonResponse({ task: mutateTask(owner, input.id, input.action, input.action === 'message' ? input.content : undefined) });
    }
    catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Agent操作未完成。');
    }
}
