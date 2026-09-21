import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, session, smallJson } from '@/lib/audit/http';
import { getRuntime, recordTest } from '@/lib/models/store';
import { testConnection } from '@/lib/models/adapter';
export const runtime = 'nodejs';
const running = new Set<string>();
export async function POST(request: NextRequest) {
  let owner: string | undefined;
  let locked = false;
  try {
    ensureSameOrigin(request);
    owner = session(request);
    if (!owner) return errorResponse('请先保存模型连接。', 401);
    const body = z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict().safeParse(await smallJson(request));
    if (!body.success) return errorResponse('连接测试请求不正确。');
    if (running.has(owner)) return errorResponse('已有连接测试正在进行，请稍候。', 429);
    const connection = getRuntime(owner, body.data.id);
    if (connection.revision !== body.data.revision) return errorResponse('模型配置已更新，请刷新后重试。', 409);
    running.add(owner); locked = true;
    const result = await testConnection(connection, request.signal);
    return jsonResponse({ connection: recordTest(owner, connection.id, connection.revision, result), result });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '连接测试失败。'); }
  finally { if (locked && owner) running.delete(owner); }
}
