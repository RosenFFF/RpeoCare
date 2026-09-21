import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getDraft, getProject, listDrafts, updateDraft, withOperation } from '@/server/workbench/store';
import { fileDraft, itemDraft } from '@/server/workbench/drafts';
import { publishDraft, PublishPreconditionError } from '@/server/github/api';
import { githubAccount } from '@/server/github/connection';

export async function GET(request: NextRequest) { const owner = session(request); return jsonResponse({ drafts: owner ? listDrafts(owner) : [] }); }
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request); const owner = session(request); if (!owner) return errorResponse('请先建立工作区会话。', 401);
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('file'), runId: z.string().uuid(), checkId: z.string().max(80) }),
      z.object({ action: z.literal('item'), kind: z.enum(['issue', 'review']), number: z.number().int().positive() }),
      z.object({ action: z.literal('edit'), id: z.string().uuid(), revision: z.number().int(), content: z.string().min(1).max(30000) }),
      z.object({ action: z.literal('publish'), id: z.string().uuid(), revision: z.number().int(), confirmed: z.literal(true) }),
    ]).parse(await smallJson(request, 150_000));
    if (input.action === 'edit') return jsonResponse({ draft: updateDraft(owner, input.id, input.revision, { content: input.content }) });
    return await withOperation(owner, input.action === 'publish' ? `publish:${input.id}` : 'draft', async () => {
      if (input.action === 'file') return jsonResponse({ draft: await fileDraft(owner, input.runId, input.checkId, request.signal) });
      if (input.action === 'item') {
        const project = getProject(owner); if (!project) throw new Error('请先连接项目。');
        return jsonResponse({ draft: await itemDraft(owner, project.repoUrl, input.kind, input.number, request.signal) });
      }
      const draft = getDraft(owner, input.id);
      if (!githubAccount(owner)?.canWrite) throw new Error('请先在设置中授权 GitHub 仓库访问与写入。');
      if (draft.status !== 'draft' || draft.revision !== input.revision) throw new Error('草稿状态已变化，请重新审阅。发布结果不确定时请先到 GitHub 核对，避免重复发布。');
      const pending = updateDraft(owner, draft.id, draft.revision, { status: 'publishing' });
      try {
        const url = await publishDraft(owner, pending);
        return jsonResponse({ draft: updateDraft(owner, pending.id, pending.revision, { status: 'published', publishedUrl: url }) });
      } catch (error) {
        if (error instanceof PublishPreconditionError) { updateDraft(owner, pending.id, pending.revision, { status: 'draft' }); throw error; }
        updateDraft(owner, pending.id, pending.revision, { status: 'uncertain' });
        throw new Error(`${error instanceof Error ? error.message : '发布未完成。'} 请到 GitHub 核对是否已创建内容，本草稿已停止重复发布。`);
      }
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '草稿操作未完成。'); }
}
