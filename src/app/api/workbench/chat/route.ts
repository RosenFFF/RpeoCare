import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, ownedRun, session, smallJson } from '@/server/audit/http';
import { getMessages, getSnapshot, saveMessages, withOperation } from '@/server/workbench/store';
import { assistant } from '@/server/workbench/assistant';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('runId') || '', run = ownedRun(request, id);
  if (!run) return errorResponse('任务不存在。', 404);
  return jsonResponse({ messages: getMessages(session(request)!, id) });
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const input = z.object({ runId: z.string().uuid(), message: z.string().trim().min(1).max(2000) }).parse(await smallJson(request));
    const run = ownedRun(request, input.runId), owner = session(request);
    if (!owner || !run?.report) return errorResponse('请先完成一次体检。');
    return await withOperation(owner, 'chat', async () => {
      const history = getMessages(owner, run.id), snapshot = getSnapshot(run.id);
      const reply = await assistant(owner, 'report-chat', '回答用户对报告的追问。涉及文件结论时引用给定文件路径和原文。不要推断未提供的代码。不要输出可点击外部链接。', { question: input.message, report: run.report, files: snapshot?.contents.filter(file => !file.error).map(file => ({ path: file.path, content: file.content.slice(0, 12_000) })) }, history, request.signal);
      const messages = [...history, { role: 'user' as const, content: input.message, at: new Date().toISOString() }, { role: 'assistant' as const, content: reply, at: new Date().toISOString() }];
      saveMessages(owner, run.id, messages); return jsonResponse({ messages });
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '追问未完成。'); }
}
