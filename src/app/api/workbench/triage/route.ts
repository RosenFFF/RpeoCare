import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/server/audit/http';
import { getProject, updateIssueWorkflowStatus } from '@/server/workbench/store';
import { getItem } from '@/server/github/api';
import { analyzeIssue } from '@/server/workbench/triage';
import { withOperation } from '@/server/workbench/store';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('analyze'), number: z.number().int().positive(), force: z.boolean().optional() }),
  z.object({ action: z.literal('batch'), numbers: z.array(z.number().int().positive()).min(1).max(12), force: z.boolean().optional() }),
  z.object({ action: z.literal('status'), number: z.number().int().positive(), status: z.enum(['untriaged', 'needs-info', 'ready-to-reply', 'investigate', 'replied', 'manual-review']) }),
]);

export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const owner = session(request);
    if (!owner) return errorResponse('请先建立工作区会话。', 401);
    const project = getProject(owner);
    if (!project) return errorResponse('请先连接项目。', 404);
    const input = inputSchema.parse(await smallJson(request, 40_000));
    return await withOperation(owner, input.action === 'batch' ? 'issue-triage-batch' : input.action === 'status' ? `issue-triage-status:${input.number}` : `issue-triage:${input.number}`, async () => {
      if (input.action === 'status') return jsonResponse({ triage: updateIssueWorkflowStatus(owner, project.repoUrl, input.number, input.status) });
      if (input.action === 'analyze') {
        const item = await getItem(owner, project.repoUrl, 'issues', input.number, request.signal);
        return jsonResponse({ triage: await analyzeIssue(owner, project.repoUrl, item, request.signal, input.force === true) });
      }
      const numbers = [...new Set(input.numbers)];
      const triages = [];
      const errors: { number: number; message: string }[] = [];
      for (const number of numbers) {
        try {
          const item = await getItem(owner, project.repoUrl, 'issues', number, request.signal);
          triages.push(await analyzeIssue(owner, project.repoUrl, item, request.signal, input.force === true));
        } catch (error) {
          errors.push({ number, message: error instanceof Error ? error.message : '分诊失败。' });
        }
      }
      return jsonResponse({ triages, errors });
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Issue 分诊未完成。');
  }
}
