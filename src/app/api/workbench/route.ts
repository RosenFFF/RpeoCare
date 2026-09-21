import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, ownerOrNew, session, smallJson } from '@/server/audit/http';
import { listRuns } from '@/server/audit/store';
import { getProject, listDrafts, saveProject, usage } from '@/server/workbench/store';
import { getRepository, parseRepositoryUrl } from '@/server/audit/github';
import { githubAccount, withGithubOwner } from '@/server/github/connection';

export async function GET(request: NextRequest) {
  try {
    const owner = session(request);
    if (!owner) return jsonResponse({ project: null, runs: [], drafts: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 }, github: null });
    const account = githubAccount(owner);
    return jsonResponse({ project: getProject(owner), runs: listRuns(owner, 20), drafts: listDrafts(owner), usage: usage(owner), github: account ? { login: account.login, canWrite: account.canWrite } : null });
  } catch { return errorResponse('无法读取工作区。', 500); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const input = z.object({ repoUrl: z.string().max(300), branch: z.string().max(200).optional() }).parse(await smallJson(request));
    const owner = ownerOrNew(request), repo = parseRepositoryUrl(input.repoUrl);
    const repository = await withGithubOwner(owner, () => getRepository(repo.url, request.signal, input.branch));
    return jsonResponse(saveProject(owner, { repoUrl: repo.url, fullName: repository.fullName, branch: input.branch || undefined }), 200, owner, request);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '无法连接仓库。'); }
}
