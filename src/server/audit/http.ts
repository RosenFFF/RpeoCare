import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRun } from './store';

const cookieName = 'repocare_audit_session';
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function session(request: NextRequest) {
  const value = request.cookies.get(cookieName)?.value;
  return value && uuidPattern.test(value) ? value : undefined;
}
export function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function jsonResponse(body: unknown, status = 200, owner?: string, request?: NextRequest) {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (owner) response.cookies.set(cookieName, owner, {
    httpOnly: true, sameSite: 'lax', secure: request?.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
export function ensureSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  // Next's internal URL can normalize 127.0.0.1 to localhost. The incoming Host
  // header preserves the browser-facing origin; never trust forwarded host here.
  const expected = `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`;
  if (site === 'cross-site' || (origin && origin !== expected)) throw new Error('请从当前站点发起操作。');
}
export async function smallJson(request: NextRequest) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('请求需要 JSON 格式。');
  if (Number(request.headers.get('content-length') || 0) > 4096) throw new Error('请求内容过长。');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('请求不能为空。');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new Error('请求内容过长。'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('请求内容不是有效 JSON。'); }
}
export function ownerOrNew(request: NextRequest) { return session(request) || randomUUID(); }
export function ownedRun(request: NextRequest, id: string) {
  const owner = session(request);
  return owner && uuidPattern.test(id) ? getRun(id, owner) : undefined;
}
