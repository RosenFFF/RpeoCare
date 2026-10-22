import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getDraft, getProject, updateDraft, withOperation, draftVersions, updateDraftBatch } from '@/server/workbench/store';
import { queryDrafts } from '@/server/workbench/draft-list';
import { fileDraft, itemDraft } from '@/server/workbench/drafts';
import { publishDraft, publishFileDrafts, PublishPreconditionError } from '@/server/github/api';
import { githubAccount } from '@/server/github/connection';
import { qualityContext, assertDraftQuality } from '@/server/workbench/draft-quality';
import { checkPublication } from '@/server/workbench/draft-publication';
import { getOverview } from '@/server/workbench/overview';

export async function GET(request: NextRequest) {
  try {
    const empty = { drafts: [], report: null, offset: 0, pageSize: 100, total: 0, projectTotal: 0, hasNext: false, siblingCounts: {} };
    const sessionOwner = session(request); if (!sessionOwner) return jsonResponse(empty); const owner: string = sessionOwner;
    const project = getProject(owner), id = request.nextUrl.searchParams.get('id');
    if (id) {
      const draft = getDraft(owner, z.string().uuid().parse(id));
      if (draft.repoUrl !== project?.repoUrl) return errorResponse('草稿不属于当前项目。');
      return jsonResponse({ draft, versions: draftVersions(owner, id), qualityContext: qualityContext(owner, draft) });
    }
    const offset = z.coerce.number().int().min(0).max(10000).parse(request.nextUrl.searchParams.get('offset') || 0);
    const category = z.enum(['all','file','issue','review']).parse(request.nextUrl.searchParams.get('category') || 'all');
    const status = z.enum(['all','active','draft','publishing','uncertain','published','archived']).parse(request.nextUrl.searchParams.get('status') || 'all');
    const query = z.string().max(200).parse(request.nextUrl.searchParams.get('q') || '').trim();
    const grouped = request.nextUrl.searchParams.get('grouped') === '1';
    return jsonResponse(project ? { ...queryDrafts(owner, project.repoUrl, { offset, category, status, query, grouped }), report: getOverview(owner).report } : empty);
  } catch { return errorResponse('无法读取草稿，请检查当前项目并重试。'); }
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request); const sessionOwner = session(request); if (!sessionOwner) return errorResponse('请先建立工作区会话。', 401); const owner: string = sessionOwner;
    const ref = z.object({ id: z.string().uuid(), revision: z.number().int().positive() });
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('file'), runId: z.string().uuid(), checkId: z.string().max(80) }),
      z.object({ action: z.literal('item'), kind: z.enum(['issue', 'review']), number: z.number().int().positive() }),
      ref.extend({ action: z.literal('edit'), content: z.string().min(1).max(30000) }),
      ref.extend({ action: z.literal('archive'), archived: z.boolean() }),
      ref.extend({ action: z.literal('restore'), version: z.number().int().positive() }),
      ref.extend({ action: z.literal('check-publication') }),
      ref.extend({ action: z.literal('publish'), confirmed: z.literal(true) }),
      z.object({ action: z.literal('publish-batch'), drafts: z.array(ref).min(2).max(4), confirmed: z.literal(true) }),
    ]).parse(await smallJson(request, 150_000));
    const project = getProject(owner); if (!project) throw new Error('请先连接项目。');
    if ('id' in input) { const draft = getDraft(owner, input.id); if (draft.repoUrl !== project.repoUrl) throw new Error('草稿不属于当前项目。'); if (draft.revision !== input.revision) throw new Error('草稿版本已变化，请重新审阅。'); }
    if (input.action === 'edit') return jsonResponse({ draft: updateDraft(owner, input.id, input.revision, { content: input.content }) });
    if (input.action === 'archive') { const draft = getDraft(owner, input.id); if (draft.status === 'publishing') throw new Error('发布中不能归档。'); return jsonResponse({ draft: updateDraft(owner, input.id, input.revision, { archived: input.archived }) }); }
    if (input.action === 'restore') { const version = draftVersions(owner, input.id).find(row => row.revision === input.version); if (!version) throw new Error('历史版本不可用。'); return jsonResponse({ draft: updateDraft(owner, input.id, input.revision, { content: version.content }) }); }
    return await withOperation(owner, 'draft', async () => {
      if (input.action === 'file') return jsonResponse({ draft: await fileDraft(owner, input.runId, input.checkId, request.signal) });
      if (input.action === 'item') return withOperation(owner, input.kind === 'review' ? `pull-review:${input.number}` : `issue-draft:${input.number}`, async () => jsonResponse({ draft: await itemDraft(owner, project.repoUrl, input.kind, input.number, request.signal) }));
      if (input.action === 'check-publication') {
        const draft = getDraft(owner, input.id); if (!['published', 'uncertain'].includes(draft.status)) throw new Error('仅已发布或待核对草稿可检查。');
        const publication = await checkPublication(owner, draft);
        // An uncertain result is never converted to published from metadata alone.
        return jsonResponse({ draft: updateDraft(owner, draft.id, draft.revision, { publication }) });
      }
      const refs = input.action === 'publish-batch' ? input.drafts : [input];
      if (new Set(refs.map(row => row.id)).size !== refs.length) throw new Error('不能重复选择同一草稿。');
      const drafts = refs.map(row => { const draft = getDraft(owner, row.id); if (draft.repoUrl !== project.repoUrl || draft.archived || draft.status !== 'draft' || draft.revision !== row.revision) throw new Error('草稿状态或版本已变化，请重新审阅。'); assertDraftQuality(owner, draft); return draft; });
      if (input.action === 'publish-batch' && (drafts.some(draft => draft.kind !== 'file' || draft.baseSha !== drafts[0].baseSha || draft.branch !== drafts[0].branch) || new Set(drafts.map(draft => draft.path)).size !== drafts.length)) throw new Error('批次必须是同分支、同基准的不同文件。');
      if (!githubAccount(owner)?.canWrite) throw new Error('请先授权 GitHub 仓库写入权限。');
      async function locked(index: number): Promise<Response> {
        if (index < drafts.length) return withOperation(owner, `publish:${drafts[index].id}`, () => locked(index + 1), false);
        // All revisions are transitioned atomically under publication locks.
        const pending = updateDraftBatch(owner, drafts.map(row => ({ id: row.id, revision: row.revision, change: { status: 'publishing', publication: { branch: row.kind === 'file' ? `repocare/${drafts[0].id}` : undefined, batchId: drafts[0].id, verification: 'not-verified' } } })));
        try {
          const url = input.action === 'publish-batch' ? await publishFileDrafts(owner, pending) : await publishDraft(owner, pending[0]);
          const completed = updateDraftBatch(owner, pending.map(row => ({ id: row.id, revision: row.revision, change: { status: 'published', publishedUrl: url, publication: { ...row.publication, state: row.kind === 'file' ? 'open' : 'comment' } } })));
          return jsonResponse({ draft: completed[0], drafts: completed });
        } catch (error) {
          updateDraftBatch(owner, pending.map(row => ({ id: row.id, revision: row.revision, change: { status: error instanceof PublishPreconditionError ? 'draft' : 'uncertain' } })));
          throw error instanceof PublishPreconditionError ? error : new Error('发布结果待核对。请到 GitHub 检查，本批次已停止重复发布。');
        }
      }
      return locked(0);
    }, input.action === 'file' || input.action === 'item');
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '草稿操作未完成。'); }
}
