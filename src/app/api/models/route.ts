import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSameOrigin, errorResponse, jsonResponse, ownerOrNew, smallJson } from '@/server/audit/http';
import { deleteConnection, listSettings, saveConnection, setDefault } from '@/server/models/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), input: z.unknown(), id: z.string().uuid().optional(), revision: z.number().int().positive().optional(), allowDuplicate: z.boolean().optional(), makeDefault: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('default'), id: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().uuid(), revision: z.number().int().positive() }).strict(),
]);
export async function GET(request: NextRequest) {
  const owner = ownerOrNew(request);
  return jsonResponse(listSettings(owner), 200, owner, request);
}
export async function POST(request: NextRequest) {
  try {
    ensureSameOrigin(request);
    const parsed = command.safeParse(await smallJson(request));
    if (!parsed.success) return errorResponse('模型设置请求不正确。');
    const owner = ownerOrNew(request);
    const body = parsed.data;
    let savedId: string | undefined;
    if (body.action === 'save') savedId = saveConnection(owner, body.input, body.id, body.revision, { allowDuplicate: body.allowDuplicate, makeDefault: body.makeDefault }).id;
    else if (body.action === 'default') setDefault(owner, body.id);
    else deleteConnection(owner, body.id, body.revision);
    return jsonResponse({ ...listSettings(owner), ...(savedId ? { savedId } : {}) }, 200, owner, request);
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '模型设置保存失败。'); }
}
