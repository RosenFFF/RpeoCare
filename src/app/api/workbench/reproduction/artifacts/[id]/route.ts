import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { NextRequest } from 'next/server';
import { errorResponse, session } from '@/server/audit/http';
import { getReproductionJob } from '@/server/workbench/store';

export async function GET(request: NextRequest, context: RouteContext<'/api/workbench/reproduction/artifacts/[id]'>) {
  try {
    const owner = session(request);
    if (!owner) return errorResponse('请先登录。', 401);
    const { id } = await context.params;
    const jobId = request.nextUrl.searchParams.get('job');
    if (!jobId) return errorResponse('缺少复现任务。', 400);
    const job = getReproductionJob(owner, jobId);
    const artifact = job.artifacts.find(item => item.id === id);
    if (!artifact) return errorResponse('证据不存在。', 404);
    const base = resolve(/* turbopackIgnore: true */ process.env.REPOCARE_REPRO_ARTIFACTS || 'data/reproduction');
    const path = resolve(base, artifact.path);
    const containment = relative(base, path);
    if (!containment || containment.startsWith('..') || isAbsolute(containment)) return errorResponse('证据路径无效。', 400);
    const info = await stat(/* turbopackIgnore: true */ path);
    if (info.size !== artifact.size || info.size > 100_000_000) return errorResponse('证据文件校验失败。', 409);
    const data = await readFile(/* turbopackIgnore: true */ path);
    if (createHash('sha256').update(data).digest('hex') !== artifact.sha256) return errorResponse('证据文件完整性校验失败。', 409);
    const fileName = `${artifact.kind}-${artifact.id}-${basename(artifact.path)}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160);
    return new Response(data, { headers: { 'Content-Type': artifact.contentType, 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : '证据读取失败。'); }
}
