import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { cancelReproductionJob, createReproductionJob, getProject, listReproductionJobs, queueReproductionJob, withOperation } from '@/server/workbench/store';
import { getBranchCommit, getItem } from '@/server/github/api';
import { assistant } from '@/server/workbench/assistant';
import { analyzeIssue } from '@/server/workbench/triage';
import { reproductionWorkerOnline } from '@/server/reproduction/queue';
import { validateReproductionPlan } from '@/server/reproduction/plan';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('plan'), number: z.number().int().positive(), force: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('confirm'), id: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('cancel'), id: z.string().uuid() }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const number = Number(request.nextUrl.searchParams.get('number'));
    return jsonResponse({
      jobs: listReproductionJobs(owner, project.repoUrl, Number.isSafeInteger(number) && number > 0 ? number : undefined),
      workerOnline: reproductionWorkerOnline(),
      sandboxConfigured: process.env.REPOCARE_REPRO_ENABLED === 'true',
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '复现任务读取失败。'); }
}

export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const owner = session(request);
    const project = owner ? getProject(owner) : null;
    if (!owner || !project) return errorResponse('请先连接项目。', 404);
    const input = actionSchema.parse(await smallJson(request, 20_000));
    if (input.action === 'cancel') return jsonResponse({ job: cancelReproductionJob(owner, input.id, project.repoUrl) });
    if (input.action === 'confirm') return jsonResponse({ job: queueReproductionJob(owner, input.id, project.repoUrl), workerOnline: reproductionWorkerOnline() });
    return await withOperation(owner, `reproduction-plan:${input.number}`, async () => {
      const [{ branch, sha }, item] = await Promise.all([getBranchCommit(owner, project.repoUrl, project.branch, request.signal), getItem(owner, project.repoUrl, 'issues', input.number, request.signal)]);
      const triage = await analyzeIssue(owner, project.repoUrl, item, request.signal, input.force === true);
      const text = await assistant(owner, 'reproduction-plan', `只输出一个 JSON 对象，不要 Markdown。根据 Issue 和分诊结果生成可审阅、可验证的复现计划。
严格结构：{"mode":"command|browser|http|test","confidence":"high|medium|low","summary":"...","environment":{"language":"可选","version":"可选","os":"可选","dependencies":[]},"setup":[],"steps":[],"oracle":{"type":"exit-code|stdout-contains|stderr-contains|selector-visible|url-contains|http-status","value":"..."},"expected":"...","evidence":[],"risks":[],"missingInformation":[],"requiresHumanApproval":true}。
每个步骤只能包含 type,target,value,command,path,content,expected,method,body,background；type 只能是 goto/click/fill/expect/run-test/run-command/create-file/request。
规则：
1. 优先复用项目已有测试；浏览器问题使用 browser，API 使用 http。
2. 命令只能使用 npm ci/install/test、npm run test:*/lint/typecheck/check/dev/start/serve、pytest、python -m pytest/unittest、go test 或 npx playwright test；不要 shell 运算符、下载脚本、sudo、Docker socket、宿主路径、网络扫描或密钥。
3. 浏览器与 HTTP 运行期只能访问 localhost；启动服务使用 background=true。
4. oracle 必须给出单一、机器可判定的故障信号，不能只写自然语言判断。
5. requiresHumanApproval 必须为 true。
6. 信息不足时写入 missingInformation，不要编造版本、选择器、路径或命令。`, { issue: item, triage, reproductionSource: { branch, commitSha: sha } }, [], request.signal);
      let raw: unknown;
      try { raw = JSON.parse(text.replace(/^```json\s*|\s*```$/gi, '')); }
      catch { throw new Error('模型返回的复现计划不是有效 JSON。'); }
      const plan = validateReproductionPlan(raw);
      return jsonResponse({ job: createReproductionJob(owner, { repoUrl: project.repoUrl, branch, commitSha: sha, issueNumber: item.number, sourceUpdatedAt: item.updatedAt, plan }) });
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '复现方案生成失败。'); }
}
