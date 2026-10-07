import { NextRequest } from 'next/server';
import { errorResponse, jsonResponse } from '@/server/audit/http';
import { accountSession, githubAccount } from '@/server/github/connection';
import { listRepositories, repositoryQuery } from '@/server/github/repositories';

export async function GET(request: NextRequest) {
  const owner = accountSession(request.cookies.get('repocare_login')?.value);
  if (!owner || !githubAccount(owner)) return errorResponse('请先使用 GitHub 登录，再选择账户仓库。', 401);
  const parsed = repositoryQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return errorResponse('仓库分页或分类参数无效。');
  try { return jsonResponse(await listRepositories(owner, parsed.data, request.signal)); }
  catch { return errorResponse('无法读取 GitHub 仓库列表，请重试；也可以手动输入仓库地址。请检查账户授权、组织访问限制和 API 额度。', 502); }
}
