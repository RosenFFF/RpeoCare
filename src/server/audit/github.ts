import type { FileContent, RepoFile, Repository, RepoSnapshot } from '../../contracts/audit';

const API_ORIGIN = 'https://api.github.com';
const MAX_FILE_BYTES = 100_000;
const MAX_CONTENT_BYTES = 300_000;
const MAX_FILE_REQUESTS = 11;
const REQUEST_TIMEOUT_MS = 12_000;

export function parseRepositoryUrl(input: string): { owner: string; name: string; url: string } {
  const value = input.trim();
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/?$/i.exec(value);
  if (!match) throw new Error('请输入公开 GitHub 仓库地址，例如 https://github.com/owner/repo，不含分支、查询参数或登录信息。');
  const owner = match[1];
  const name = match[2].replace(/\.git$/i, '');
  if (!name || name === '.' || name === '..') throw new Error('GitHub 仓库名称无效。');
  return { owner, name, url: `https://github.com/${owner}/${name}` };
}

class GitHubRequestError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new GitHubRequestError('GitHub 返回了空响应。');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body.cancel();
    throw new GitHubRequestError('GitHub 响应超过本次检查的大小限制。');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new GitHubRequestError('GitHub 响应超过本次检查的大小限制。');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GitHubRequestError('GitHub 返回的数据无法解析。'); }
}

async function request(path: string, signal: AbortSignal, maxBytes = 256_000): Promise<unknown> {
  // Only this fixed origin receives the optional token. Never follow redirects.
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error('无效的 GitHub API 地址。');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'RepoCare-Audit',
    };
    const token = process.env.REPOCARE_GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.any([signal, timeout]), redirect: 'error', cache: 'no-store' });
      if (!response.ok) {
        const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
        await response.body?.cancel();
        if (limited) throw new GitHubRequestError('GitHub API 请求额度已用完，请稍后重试，或在服务端配置 GitHub Token。');
        if (response.status === 404) throw new GitHubRequestError('未找到公开仓库或文件，请检查仓库地址与访问权限。');
        if (response.status === 401 || response.status === 403) throw new GitHubRequestError('GitHub 拒绝访问，请检查服务端 Token 是否有效及其访问权限。');
        if (response.status === 409) throw new GitHubRequestError('仓库没有可读取的提交，请先推送代码。');
        throw new GitHubRequestError(`GitHub 请求失败（HTTP ${response.status}），请稍后重试。`, response.status >= 500);
      }
      return await readJson(response, maxBytes);
    } catch (error) {
      signal.throwIfAborted();
      const safeError = error instanceof GitHubRequestError ? error : new GitHubRequestError(timeout.aborted ? '读取 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络后重试。', true);
      if (attempt === 1 || !safeError.retryable) throw safeError;
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 500);
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
      });
    }
  }
  throw new GitHubRequestError('GitHub 请求未完成。');
}

export async function getRepository(input: string, signal: AbortSignal): Promise<Repository> {
  const parsed = parseRepositoryUrl(input);
  const prefix = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`;
  const metadata = object(await request(prefix, signal));
  if (metadata.private !== false) throw new Error('当前体检仅支持公开 GitHub 仓库。');
  const branch = typeof metadata.default_branch === 'string' ? metadata.default_branch : '';
  if (!branch) throw new Error('仓库没有默认分支，请先推送代码。');
  const commits = await request(`${prefix}/commits?sha=${encodeURIComponent(branch)}&per_page=1`, signal);
  const commit = object(Array.isArray(commits) ? commits[0] : undefined);
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('无法确定仓库提交版本。');
  return {
    ...parsed,
    fullName: `${parsed.owner}/${parsed.name}`,
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 500) : '',
    branch,
    sha: commit.sha,
    language: typeof metadata.language === 'string' ? metadata.language : null,
  };
}

function priority(path: string): number {
  const lower = path.toLowerCase();
  if (lower === 'package.json') return 0;
  if (/^(?:\.github\/|docs\/)?readme(?:\.(?:md|markdown|rst|txt|adoc))?$/.test(lower)) return 1;
  if (/^(?:\.github\/|docs\/)?contributing(?:\.(?:md|markdown|rst|txt|adoc))?$/.test(lower)) return 2;
  if (/^(?:license|licence|copying)(?:\.[a-z0-9_-]+)?$/.test(lower)) return 3;
  if (lower === 'pyproject.toml') return 4;
  if (/^\.github\/issue_template(?:\.(?:md|yml|yaml)|\/.*\.(?:md|yml|yaml))$/.test(lower)) return 5;
  if (/^(?:\.github\/|docs\/)?pull_request_template(?:\.md|\/.*\.md)$/.test(lower)) return 6;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower)) return 7;
  if (/^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?|biome\.jsonc?|\.prettierrc(?:\.[a-z]+)?|prettier\.config\.[cm]?[jt]s)$/.test(lower)) return 8;
  return 100;
}

export async function collectRepository(
  repository: Repository,
  signal: AbortSignal,
  onProgress?: (message: string, completed: number, total: number) => void,
): Promise<RepoSnapshot> {
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const tree = object(await request(`${prefix}/git/trees/${encodeURIComponent(repository.sha)}?recursive=1`, signal, 12_000_000));
  if (!Array.isArray(tree.tree) || typeof tree.truncated !== 'boolean') throw new Error('GitHub 文件目录格式异常，无法继续检查。');
  const files: RepoFile[] = [];
  let invalidEntries = false;
  for (const raw of tree.tree) {
    const item = object(raw);
    if (item.type !== 'blob') continue;
    if (typeof item.path !== 'string' || typeof item.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(item.sha)) { invalidEntries = true; continue; }
    // Git symlinks are content pointing elsewhere; do not treat them as verified document/config content.
    if (item.mode === '120000') { invalidEntries = true; continue; }
    files.push({ path: item.path, sha: item.sha, size: typeof item.size === 'number' ? item.size : undefined });
  }
  const treeTruncated = tree.truncated || invalidEntries;
  const warnings: string[] = [];
  if (tree.truncated) warnings.push('GitHub 返回的目录被截断；未找到的文件只能标记为无法判断。');
  if (invalidEntries) warnings.push('部分目录项或符号链接未纳入检查；缺失结论将标记为无法判断。');
  const candidates = files.filter(file => priority(file.path) < 100).sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
  const selected = candidates.slice(0, MAX_FILE_REQUESTS);
  if (candidates.length > selected.length) warnings.push(`本次仅读取优先级最高的 ${MAX_FILE_REQUESTS} 个文件内容；其余文件只检查目录存在性。`);
  const contents: FileContent[] = [];
  let totalBytes = 0;
  onProgress?.('已获取固定提交的文件目录，开始读取文档与配置。', 0, selected.length);
  for (const [index, file] of selected.entries()) {
    signal.throwIfAborted();
    try {
      if (file.size !== undefined && file.size > MAX_FILE_BYTES) throw new Error('文件超过 100 KB 的读取限制。');
      if (totalBytes + (file.size ?? 0) > MAX_CONTENT_BYTES || totalBytes >= MAX_CONTENT_BYTES) throw new Error('已达到本次文件内容总量限制。');
      const blob = object(await request(`${prefix}/git/blobs/${encodeURIComponent(file.sha)}`, signal, 160_000));
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('文件内容格式不受支持。');
      const bytes = Buffer.from(blob.content, 'base64');
      if (bytes.length > MAX_FILE_BYTES || totalBytes + bytes.length > MAX_CONTENT_BYTES) throw new Error('文件内容超过本次读取限制。');
      if (bytes.includes(0)) throw new Error('文件疑似二进制内容，未纳入文本分析。');
      totalBytes += bytes.length;
      contents.push({ path: file.path, content: bytes.toString('utf8'), truncated: false });
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : '文件读取失败。';
      contents.push({ path: file.path, content: '', truncated: false, error: message });
      warnings.push(`${file.path}：${message}`);
    }
    onProgress?.(`已处理 ${file.path}`, index + 1, selected.length);
  }
  return { repository, files, treeTruncated, contents, warnings };
}
