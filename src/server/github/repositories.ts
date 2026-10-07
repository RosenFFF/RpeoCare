import { z } from 'zod';
import type { GithubRepositoryPage } from '../../contracts/repositories';
import { githubAccount } from './connection';
import { githubApi } from './api';

export const repositoryQuery = z.object({
  page: z.string().regex(/^[1-9]\d{0,3}$/).default('1').transform(Number).pipe(z.number().max(1000)),
  affiliation: z.enum(['owner', 'all']).default('owner'),
}).strict();
const rowSchema = z.object({
  id: z.number().int().positive(), full_name: z.string().max(250).regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/).refine(value => ![".", ".."].includes(value.split("/")[1])),
  description: z.string().nullable().optional(), private: z.boolean(), fork: z.boolean(), archived: z.boolean(),
  owner: z.object({ login: z.string() }),
  permissions: z.object({ admin: z.boolean().optional(), maintain: z.boolean().optional(), push: z.boolean().optional(), pull: z.boolean().optional() }).optional(),
});
export async function listRepositories(owner: string, query: z.output<typeof repositoryQuery>, signal?: AbortSignal): Promise<GithubRepositoryPage> {
  const account = githubAccount(owner);
  if (!account) throw new Error('请先使用 GitHub 登录，再选择账户仓库。');
  const params = new URLSearchParams({ per_page: '30', page: String(query.page), sort: 'updated', direction: 'desc', affiliation: query.affiliation === 'owner' ? 'owner' : 'owner,collaborator,organization_member' });
  let hasMore = false;
  const result = await githubApi(owner, `/user/repos?${params}`, { signal, onHeaders: headers => { hasMore = /;\s*rel="next"/.test(headers.get('link') || ''); } });
  const rows = z.array(rowSchema).max(30).parse(result);
  return {
    repositories: rows.map(row => ({
      id: row.id, fullName: row.full_name, url: `https://github.com/${row.full_name}`, description: (row.description || '').slice(0, 500),
      private: row.private, fork: row.fork, archived: row.archived, owned: row.owner.login.toLowerCase() === account.login.toLowerCase(),
      permission: row.permissions?.admin ? 'admin' : row.permissions?.maintain ? 'maintain' : row.permissions?.push ? 'write' : row.permissions?.pull ? 'read' : 'unknown',
    })),
    page: query.page, hasMore: hasMore && query.page < 1000, login: account.login, privateAccessAuthorized: account.canWrite,
  };
}
