import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@mariozechner/pi-ai';
import { createTwoFilesPatch } from 'diff';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getItem, getPullRequestChecks } from '../github/api';
import { createDraft, createReproductionJob, getDraft, getReproductionJob } from '../workbench/store';
import { reproductionPlanSchema, validateReproductionPlan } from '../reproduction/plan';
import { localProposal, memories, saveClaim } from './store';
import { RepositoryReader, repositoryPath } from './repository';
import type { AgentArtifact, AgentPatchFile } from '../../contracts/agent';
import type { ReproductionPlan, GitItem } from '../../contracts/workbench';
import { activePolicy } from '../workbench/policy';
import { prepareMaintenanceVerification, pullVerificationFiles } from '../workbench/maintenance-verification';
import { assessVerification } from '@/shared/lib/maintenance-verification';
const patchSchema = z.object({ title: z.string().min(1).max(180), evidenceIds: z.array(z.string()).min(1).max(12), edits: z.array(z.object({ path: z.string(), before: z.string().max(20000), after: z.string().max(20000) }).strict()).min(1).max(4) }).strict();
function defineTool<P extends TSchema>(tool: AgentTool<P>): AgentTool { return tool as AgentTool; }
export async function maintenanceTools(reader: RepositoryReader, readOnly=false): Promise<AgentTool[]> {
    const {Type}=await import('@mariozechner/pi-ai');
    const { claim, signal } = reader, { task } = claim;
    const result = (value: unknown) => {
        const item=value as Partial<AgentArtifact>;
        const data=item?.createdAt&&item?.kind&&item?.evidenceIds?{
            id:item.id,kind:item.kind,title:item.title,createdAt:item.createdAt,evidenceIds:item.evidenceIds,draftId:item.draftId,jobIds:item.jobIds,revision:item.revision,superseded:item.superseded,patchId:item.patchId,
            files:item.files?.map(file=>({path:file.path,beforeChars:file.before.length,afterChars:file.after.length})),
            diffPreview:item.diff?.slice(0,4000),diffTruncated:!!item.diff&&item.diff.length>4000,
        }:value;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ untrustedData: data }) }], details: {} };
    };
    const validEvidence = (ids: string[]) => { if (ids.some(id => !task.evidence.some(e => e.id === id)))
        throw new Error('引用了当前任务中不存在的证据。'); };
    const artifact = (value: Omit<AgentArtifact, 'id' | 'createdAt'>) => {
        validEvidence(value.evidenceIds);
        if (task.artifacts.length >= 12)
            throw new Error('任务最多保存 12 个交付物。');
        const versions=task.artifacts.filter(a=>a.kind===value.kind);
        if(versions.length>=3)throw new Error('此类交付物已达三版上限，请新建范围更小的任务。');
        versions.forEach(a=>{a.superseded=true;});
        if(value.kind==='patch')task.artifacts.filter(a=>a.kind==='verification').forEach(a=>{a.superseded=true;});
        const created = { ...value, revision:versions.length+1, id: randomUUID(), createdAt: new Date().toISOString() };
        task.artifacts.push(created);
        saveClaim(claim);
        return created;
    };
    const string = (maxLength = 400) => Type.String({ minLength: 1, maxLength });
    const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const tools:AgentTool[] = [
        defineTool({ name: 'read_draft', label: '读取当前文档改动', description: '读取当前任务绑定的已保存草稿及原文。草稿是未提交的方案，不是仓库事实；版本变化时需要重新发起核对。', parameters: Type.Object({}), async execute() {
            const match = task.anchor?.match(/^draft:([a-f0-9-]+):r(\d+)$/i);
            if (!match || task.kind !== 'docs') throw new Error('当前核对没有绑定文档草稿。');
            const draft = getDraft(claim.owner, match[1]);
            if (draft.repoUrl !== task.repoUrl || draft.baseSha !== task.commitSha || draft.revision !== Number(match[2])) throw new Error('草稿版本已经变化，请保存后重新核对。');
            return result({ title: draft.title, path: draft.path, revision: draft.revision, before: draft.before, proposed: draft.content, uncommitted: true });
        } }),
        defineTool({ name: 'set_plan', label: '更新任务步骤', description: '维护供用户查看的短步骤清单；只写行动与进度，不输出内部推理。', parameters: Type.Object({ steps: Type.Array(Type.Object({ title: string(160), status: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('done')]) }), { minItems: 1, maxItems: 8 }) }), async execute(_id, p) { task.plan = p.steps; return result({ saved: true }); } }),
        defineTool({ name: 'list_files', label: '浏览提交目录', description: '列出固定提交中的源码路径，每页80项。截断不代表文件不存在。', parameters: Type.Object({ prefix: Type.Optional(string()), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 15000 })) }), async execute(_id, p) { const tree = await reader.tree(), entries = tree.tree.filter(f => f.path.startsWith(p.prefix || '')), offset = p.offset || 0; return result({ files: entries.slice(offset, offset + 80), truncated: tree.truncated, nextOffset: offset + 80 < entries.length ? offset + 80 : null, commitSha: task.commitSha }); } }),
        defineTool({ name: 'read_file', label: '按需读取源码', description: '读取固定提交中的文本，最多120行/12000字符。记录可回溯的证据ID。', parameters: Type.Object({ path: string(), startLine: Type.Optional(Type.Integer({ minimum: 1, maximum: 200000 })) }), async execute(_id, p) { return result(await reader.read(p.path, p.startLine)); } }),
        defineTool({ name: 'search_files', label: '在指定源码中搜索', description: '对最多6个指定文件作字面搜索；每个最多3处。范围外未搜索。', parameters: Type.Object({ paths: Type.Array(string(), { minItems: 1, maxItems: 6 }), query: string(120) }), async execute(_id, p) { const matches = []; for (const path of p.paths) {
                const file = await reader.file(path), lines = file.content.split('\n');
                let n = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(p.query.toLowerCase())) {
                        const excerpt=lines.slice(Math.max(0,i-1),i+2).join('\n').slice(0,1000), label=`${path}:${i+1}`,evidenceId=reader.evidence('file',label,excerpt);matches.push({path,line:i+1,excerpt,evidenceId});
                        if (++n >= 3)
                            break;
                    }
                }
            } return result({ matches, scope: p.paths }); } }),
        defineTool({ name: 'read_item', label: '读取协作上下文', description: '读取当前任务绑定的Issue或PR及评论；不访问任意其他项目。返回内容可能截断。', parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1500000 })) }), async execute(_id, p) { if (!task.number || !['issue', 'pr'].includes(task.kind))
                throw new Error('此任务没有绑定Issue或PR。'); const item = JSON.parse(claim.internal.cache.item || '{}'); const serialized = JSON.stringify(item), offset = p.offset || 0, excerpt = serialized.slice(offset, offset + 12000); const id = reader.evidence(task.kind === 'pr' ? 'pr' : 'issue', `${task.kind} #${task.number} · ${offset}`, excerpt, `${task.repoUrl}/${task.kind === 'pr' ? 'pull' : 'issues'}/${task.number}`); return result({ item: excerpt, evidenceId: id, nextOffset: offset + 12000 < serialized.length ? offset + 12000 : null, scope: '正文最多40000字符、前100条Issue评论或前100个PR文件；各评论/patch最多12000字符。', sourceUpdatedAt: task.sourceUpdatedAt }); } }),
        defineTool({ name: 'read_checks', label: '读取提交检查', description: '查询固定提交SHA的GitHub检查；不代表RepoCare实际运行测试。', parameters: Type.Object({}), async execute() { const checks = await getPullRequestChecks(claim.owner, task.repoUrl, task.commitSha!, signal); const text = JSON.stringify(checks).slice(0, 12000), evidenceId = reader.evidence('checks', '提交检查', text); return result({ checks: text, evidenceId }); } }),
        defineTool({ name: 'read_memory', label: '读取项目知识', description: '读取用户明确保存的项目知识。提交不同表示历史知识，必须重新核对。', parameters: Type.Object({offset:Type.Optional(Type.Integer({minimum:0,maximum:100}))}), async execute(_id,p) { const items=memories(claim.owner,task.repoUrl),offset=p.offset||0;return result({items:items.slice(offset,offset+10).map(m=>({...m,historical:m.commitSha!==task.commitSha})),nextOffset:offset+10<items.length?offset+10:null}); } }),
        defineTool({ name: 'read_evidence', label: '重读调查证据', description: '上下文压缩后按证据ID重新读取原文。', parameters: Type.Object({ id: string(40) }), async execute(_id, p) { const e = task.evidence.find(e => e.id === p.id); if (!e)
                throw new Error('证据不存在。'); return result(e); } }),
        defineTool({ name: 'propose_reply', label: '保存回复草稿', description: '为绑定的Issue生成本地回复草稿；不会发布。相同内容重试不会重复创建。PR审阅请使用原有PR检查工作台。', parameters: Type.Object({ content: string(18000), evidenceIds: Type.Array(string(40), { minItems: 1, maxItems: 12 }) }), async execute(_id, p) { if (task.kind !== 'issue' || !task.number)
                throw new Error('仅Issue任务支持回复草稿。'); validEvidence(p.evidenceIds); const policy = activePolicy(claim.owner, task.repoUrl); if (policy && [...task.evidence].reverse().find(e => e.kind === 'policy')?.policyRevision !== policy.revision) throw new Error('请先read_project_rules读取当前已确认规则，再准备回复。'); const key=fingerprint(policy ? {content:p.content,policy:policy.revision} : p.content),existing = task.artifacts.find(a => a.kind === 'reply'&&a.fingerprint===key); if (existing)
                return result(existing); const current = await getItem(claim.owner, task.repoUrl, 'issues', task.number, signal); if (current.updatedAt !== task.sourceUpdatedAt)
                throw new Error('Issue已更新，请新建任务读取最新反馈后生成回复。'); if (activePolicy(claim.owner, task.repoUrl)?.revision !== policy?.revision) throw new Error('项目规则已变化，请重新读取后生成回复。'); return result(localProposal(claim, () => { const draft = createDraft(claim.owner, { kind: 'issue', policyRevision: policy?.revision, repoUrl: task.repoUrl, number: task.number!, baseSha: '', before: '', content: p.content, title: `Issue 回复 #${task.number} · 修订第${task.artifacts.filter(a=>a.kind==='reply').length+1}版`,previousDraftId:task.artifacts.filter(a=>a.kind==='reply').at(-1)?.draftId, source: { type: 'github-item', kind: 'issue', number: task.number! } }); return artifact({ kind: 'reply', fingerprint:key, title: draft.title, draftId: draft.id, evidenceIds: p.evidenceIds }); })); } }),
        defineTool({ name: 'prepare_reproduction', label: '准备复现计划', description: '保存待用户确认的隔离复现计划，不执行。planJson需符合现有复现计划结构，缺信息必须注明。', parameters: Type.Object({ planJson: string(40000), evidenceIds: Type.Array(string(40), { minItems: 1, maxItems: 12 }) }), async execute(_id, p) { if (task.kind !== 'issue' || !task.number)
                throw new Error('仅Issue任务支持复现。'); if (claim.internal.cache.visibility === 'private')
                throw new Error('当前隔离执行器仅支持公开仓库。'); validEvidence(p.evidenceIds); const plan=validateReproductionPlan(JSON.parse(p.planJson)),key=fingerprint(plan),existing = task.artifacts.find(a => a.kind === 'reproduction'&&a.fingerprint===key); if (existing)
                return result(existing); return result(localProposal(claim, () => { const job = createReproductionJob(claim.owner, { repoUrl: task.repoUrl, branch: task.branch, commitSha: task.commitSha!, issueNumber: task.number!, agentTaskId:task.id, sourceUpdatedAt: task.sourceUpdatedAt!, plan }); return artifact({ kind: 'reproduction', fingerprint:key, title: '隔离复现计划', jobIds: [job.id], evidenceIds: p.evidenceIds }); })); } }),
        defineTool({ name: 'propose_patch', label: '生成可审阅补丁', description: '提交最多4个文件的精确文本替换；before必须是已读取文件中的唯一原文；完整目录中不存在的新文件可用空before。只生成本地差异，不改宿主或GitHub。每任务最多三版补丁，修订仍针对原始提交。', parameters: Type.Object({title:string(180),evidenceIds:Type.Array(string(40),{minItems:1,maxItems:12}),edits:Type.Array(Type.Object({path:string(),before:Type.String({maxLength:20000}),after:Type.String({maxLength:20000})}),{minItems:1,maxItems:4})}), async execute(_id, p) { const patch = patchSchema.parse(p); validEvidence(patch.evidenceIds); const files: AgentPatchFile[] = []; for (const edit of patch.edits) {
                repositoryPath(edit.path);
                if (files.some(f => f.path === edit.path))
                    throw new Error('一个文件请合并为一次替换。');
                if (!edit.before) {
                    const tree = await reader.tree();
                    if (!edit.after.trim()) throw new Error('空原文替换的文件内容不能为空。');
                    const existing=tree.tree.find(file=>file.path===edit.path);
                    if(existing){
                        const source=await reader.file(edit.path);
                        if(source.content!==''||!task.evidence.some(e=>e.kind==='file'&&e.label.startsWith(`${edit.path}:`)))throw new Error('请先读取目标文件，并使用唯一原文作为before。');
                        files.push({path:edit.path,before:'',after:edit.after,created:false});
                    }else{
                        if(tree.truncated||tree.occupied?.includes(edit.path)||tree.blockedParents?.some(parent=>edit.path.startsWith(parent+'/')))throw new Error('新文件必须位于完整目录且路径尚不存在，不得穿过符号链接或子模块。');
                        files.push({path:edit.path,before:'',after:edit.after,created:true});
                    }
                    continue;
                }
                const source = await reader.file(edit.path);
                if (!task.evidence.some(e => e.kind === 'file' && e.label.startsWith(`${edit.path}:`)))
                    throw new Error('请先read_file读取目标文件。');
                if (source.content.length > 20000 || source.content.split(edit.before).length !== 2)
                    throw new Error('文件超过补丁边界，或替换原文不是唯一匹配。');
                const after = source.content.replace(edit.before, () => edit.after);
                if (after === source.content || after.length > 20000)
                    throw new Error('补丁无变化或替换文件过长。');
                files.push({ path: edit.path, before: source.content, after });
            } files.sort((a,b)=>a.path.localeCompare(b.path));const key=fingerprint(files),existing=task.artifacts.find(a=>a.kind==='patch'&&a.fingerprint===key);if(existing)return result(existing); const diff = files.map(f => createTwoFilesPatch(f.created ? '/dev/null' : `a/${f.path}`, `b/${f.path}`, f.before, f.after)).join('\n'); return result(localProposal(claim,()=>artifact({ kind: 'patch', fingerprint:key, title: patch.title, files, diff, evidenceIds: patch.evidenceIds }))); } }),
        defineTool({ name: 'prepare_verification', label: '准备需求与改动对照', description: '为Issue补丁或当前PR生成共享测试的双版本计划。要求来自正文/评论/关联Issue原文。每项需求提供完整pytest命令、预期断言输出片段和生产改动路径。PR最多4个完整可读文件；不支持依赖变更。用户逐条核对后才执行。planJson必须test/all-steps-pass，steps均为run-test，不含create-file或后台。', parameters: Type.Object({
            planJson: string(30000), requirements: Type.Array(Type.Object({ text: string(500), quote: string(1200), command: string(500), failureSignal: string(200), changedPaths: Type.Array(string(400), { minItems: 1, maxItems: 4 }) }), { minItems: 1, maxItems: 8 }),
        }), async execute(_id, p) {
            if (!['issue', 'pr'].includes(task.kind) || !task.number) throw new Error('需求对照需要绑定 Issue 或 PR。');
            if (claim.internal.cache.visibility === 'private') throw new Error('当前隔离执行器仅支持公开仓库。');
            const item: GitItem = JSON.parse(claim.internal.cache.item || '{}');
            let patch = task.artifacts.find(a => a.kind === 'patch' && !a.superseded);
            let proposed: AgentArtifact | undefined;
            if (task.kind === 'pr') {
                const files = await pullVerificationFiles(claim.owner, task.repoUrl, item, signal);
                const key = fingerprint(files);
                if (!patch || patch.fingerprint !== key) {
                    const evidenceId = reader.evidence('pr', `PR #${task.number} 固定 head/base 文件`, JSON.stringify({ head: item.headSha, base: item.baseSha, paths: files.map(file => file.path) }));
                    proposed = { id: randomUUID(), kind: 'patch', title: `PR #${task.number} 原始改动`, baseSha: item.baseSha, files, diff: files.map(file => createTwoFilesPatch(file.created ? '/dev/null' : `a/${file.path}`, `b/${file.path}`, file.before, file.after)).join('\n'), fingerprint: key, evidenceIds: [evidenceId], createdAt: new Date().toISOString() };
                    patch = proposed;
                }
            }
            if (!patch?.files?.length) throw new Error('请先读取源码并提出补丁。');
            const policyRevision = activePolicy(claim.owner, task.repoUrl)?.revision || 0;
            if (policyRevision && [...task.evidence].reverse().find(evidence => evidence.kind === 'policy')?.policyRevision !== policyRevision) throw new Error('请先 read_project_rules 读取当前有效规则，再准备需求对照。');
            let requestKey = fingerprint({ patchId: patch.id, plan: JSON.parse(p.planJson), requirements: p.requirements, policyRevision });
            const existing = task.artifacts.find(a => a.kind === 'verification' && !a.superseded && a.fingerprint === requestKey);
            if (existing) return result(existing);
            let prepared = prepareMaintenanceVerification({ task, patch, item, plan: JSON.parse(p.planJson), requirements: p.requirements, policyRevision });
            return result(localProposal(claim, () => {
                if (proposed) {
                    patch = artifact({ kind: proposed.kind, title: proposed.title, baseSha: proposed.baseSha, files: proposed.files, diff: proposed.diff, fingerprint: proposed.fingerprint, evidenceIds: proposed.evidenceIds });
                    prepared = prepareMaintenanceVerification({ task, patch, item, plan: JSON.parse(p.planJson), requirements: p.requirements, policyRevision });
                    requestKey = fingerprint({ patchId: patch.id, plan: JSON.parse(p.planJson), requirements: p.requirements, policyRevision });
                }
                const jobs = [prepared.baseline, prepared.patched].map((plan, index) => createReproductionJob(claim.owner, { verificationRole: index === 0 ? 'baseline' : 'patched', repoUrl: task.repoUrl, branch: task.kind === 'pr' ? item.baseRef : task.branch, commitSha: prepared.verification.baseSha, issueNumber: task.number!, agentTaskId: task.id, sourceUpdatedAt: task.sourceUpdatedAt!, plan, verification: prepared.verification }));
                return artifact({ kind: 'verification', fingerprint: requestKey, patchId: patch!.id, title: '需求 · 改动 · 同测试对照', verification: prepared.verification, jobIds: jobs.map(job => job.id), evidenceIds: patch!.evidenceIds });
            }));
        } }),
        defineTool({ name: 'read_execution', label: '读取隔离执行证据', description: '读取此任务已有复现/验证结果。reproduced表示命中了计划判据；all-steps-pass只表示这些命令通过，不证明全部问题解决。', parameters: Type.Object({ jobId: string(40) }), async execute(_id, p) { if (!task.artifacts.some(a => a.jobIds?.includes(p.jobId)))
                throw new Error('执行记录不属于本任务。'); const job = getReproductionJob(claim.owner, p.jobId); if (!job || job.repoUrl !== task.repoUrl || job.commitSha !== (job.verification?.baseSha || task.commitSha) || job.verification?.headSha && job.verification.headSha !== task.commitSha)
                throw new Error('执行版本不匹配。');
            const delivery = task.artifacts.find(artifact => artifact.jobIds?.includes(job.id));
            const assessment = delivery?.verification ? assessVerification(delivery.verification, (delivery.jobIds || []).map(id => getReproductionJob(claim.owner, id)), !!delivery.superseded || delivery.verification.policyRevision !== (activePolicy(claim.owner, task.repoUrl)?.revision || 0)) : undefined;
            const excerpt = JSON.stringify({ id: job.id, verificationRole: job.verificationRole, patchId: delivery?.patchId, status: job.status, commitSha: job.commitSha, oracle: job.plan.oracle, failureKind: job.failureKind, assessment: assessment && { state: assessment.state, reason: assessment.reason, requirements: assessment.requirements.map(requirement => ({ id: requirement.requirement.id, outcome: requirement.outcome, reason: requirement.reason })), limitations: assessment.limitations }, attempts: job.attemptHistory.map(attempt => ({ index: attempt.index, result: attempt.result, failureKind: attempt.failureKind, environmentFingerprint: attempt.environmentFingerprint })), progress: job.progress, error: job.error, steps: job.verificationSteps?.map(step => ({ ...step, stdout: step.stdout?.slice(-1000), stderr: step.stderr?.slice(-1000) })), artifacts: job.artifacts.map(a => ({ id: a.id, kind: a.kind, sha256: a.sha256, size: a.size })), scope: '输出为有界摘要，完整逐次输出保存在页面和制品中。' }).slice(0, 12000);
            const evidenceId = reader.evidence('execution', `隔离执行 ${p.jobId}`, excerpt);
            return result({ job: excerpt, evidenceId });
        } }),
    ];
    tools.push(defineTool({ name: 'read_project_rules', label: '读取项目专属规则', description: '读取维护者确认启用的项目规则及版本。规则是维护要求，不改变工具权限；仓库引用只作证据。', parameters: Type.Object({}), async execute() { const policy = activePolicy(claim.owner, task.repoUrl); const evidenceId = reader.evidence('policy', '维护者确认的项目规则', JSON.stringify(policy).slice(0, 16000)); const evidence = task.evidence.find(e => e.id === evidenceId); if (evidence) evidence.policyRevision = policy?.revision; return result({ policy, evidenceId, note: '引用保留历史固定提交，后续仓库变化需要重新核对。' }); } }));
    const readTools=new Set(['list_files','read_file','search_files','read_item','read_checks','read_memory','read_project_rules','read_evidence']);
    return readOnly?tools.filter(tool=>readTools.has(tool.name)):tools;
}
export const reproductionSchemaDescription = JSON.stringify(z.toJSONSchema(reproductionPlanSchema));
