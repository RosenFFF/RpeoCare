import { createHash } from 'node:crypto';
import { z } from 'zod';
import { repositoryPath, assertReadableSource } from '../../src/server/agent/repository';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const snapshotSchema = z.object({
  kind: z.enum(['issue', 'pr']).optional(),
  pullRequest: z.object({ baseSha: sha, headSha: sha, baseRef: z.string(), headRef: z.string(), headRepository: z.string(), totalChangedFiles: z.number().int().positive(), filesTruncated: z.literal(false), files: z.array(z.object({ path: z.string(), status: z.string(), additions: z.number(), deletions: z.number(), patch: z.string(), patchTruncated: z.literal(false) })), linkedIssues: z.array(z.object({ number: z.number(), title: z.string(), body: z.string(), url: z.string().url() })).optional() }).optional(),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), commit: sha, ref: z.string().min(1).max(200), issueNumber: z.number().int().positive(),
  issue: z.object({ number: z.number().int().positive(), title: z.string(), body: z.string(), updated_at: z.string(), state: z.enum(['open', 'closed']), html_url: z.string().url(), user: z.object({ login: z.string() }) }),
  tree: z.object({ truncated: z.literal(false), tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string(), sha, size: z.number().int().nonnegative().optional() })) }),
  blobs: z.record(z.string(), z.string()),
});

/** Canonical Git blobs only. This reads data, never imports or executes target code. */
export function maintenancePilotSource(input: unknown) {
  const snapshot = snapshotSchema.parse(input);
  const kind = snapshot.kind || 'issue';
  if (snapshot.issue.number !== snapshot.issueNumber || snapshot.issue.html_url !== `https://github.com/${snapshot.repo}/${kind === 'pr' ? 'pull' : 'issues'}/${snapshot.issueNumber}`) throw new Error('Snapshot issue does not match repository.');
  if (kind === 'pr' && (!snapshot.pullRequest || snapshot.pullRequest.headSha !== snapshot.commit || snapshot.pullRequest.files.length !== snapshot.pullRequest.totalChangedFiles)) throw new Error('Snapshot PR is incomplete or has a different head.');
  if (kind !== 'pr' && snapshot.pullRequest) throw new Error('Issue snapshot cannot contain a PR.');
  const item = { number: snapshot.issue.number, title: snapshot.issue.title, body: snapshot.issue.body, updatedAt: snapshot.issue.updated_at, author: snapshot.issue.user.login, state: snapshot.issue.state, labels: [], url: snapshot.issue.html_url, comments: [], ...(snapshot.pullRequest || {}) };
  const entries = snapshot.tree.tree;
  const tree = entries.filter(entry => {
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) return false;
    try { repositoryPath(entry.path); return true; } catch { return false; }
  });
  const cache: Record<string, string> = { tree: JSON.stringify({ tree, truncated: false, occupied: entries.map(entry => entry.path), blockedParents: entries.filter(entry => entry.mode === '120000' || entry.type === 'commit').map(entry => entry.path) }), item: JSON.stringify(item), visibility: 'public' };
  let total = 0;
  for (const [blobSha, text] of Object.entries(snapshot.blobs)) {
    const entry = tree.find(entry => entry.sha === blobSha);
    if (!entry) throw new Error('Snapshot contains a blob outside the readable tree.');
    const bytes = Buffer.byteLength(text);
    if (entry.size !== bytes || bytes > 120000 || createHash('sha1').update(`blob ${bytes}\0`).update(text).digest('hex') !== blobSha) throw new Error('Snapshot blob hash or size mismatch.');
    assertReadableSource(text);
    total += text.length;
    if (total > 600000) throw new Error('Snapshot exceeds source cache budget.');
    cache[`blob:${blobSha}`] = text;
  }
  return { kind, repoUrl: `https://github.com/${snapshot.repo}`, branch: snapshot.ref, number: snapshot.issueNumber, revision: snapshot.commit, item, tree, cache };
}

/** Replay validated blobs on demand without pre-spending the product read budget. */
export function pilotBlobReplay(source: ReturnType<typeof maintenancePilotSource>, upstream: typeof fetch = globalThis.fetch) {
  const blobs = new Map(Object.entries(source.cache).filter(([key]) => key.startsWith('blob:')));
  const cache = Object.fromEntries(Object.entries(source.cache).filter(([key]) => !key.startsWith('blob:')));
  const prefix = '/repos/' + source.repoUrl.slice('https://github.com/'.length) + '/git/blobs/';
  const replay: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    if (url.origin === 'https://api.github.com' && url.pathname.startsWith(prefix) && /^[a-f0-9]{40}$/.test(url.pathname.slice(prefix.length)) && method === 'GET') {
      const sha = url.pathname.slice(prefix.length), content = blobs.get('blob:' + sha);
      if (content !== undefined) {
        init?.signal?.throwIfAborted();
        return Response.json({ sha, encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
      }
    }
    return upstream(input, init);
  };
  return { cache, fetch: replay };
}
