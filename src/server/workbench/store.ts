import { randomUUID } from 'node:crypto';
import { db } from '../audit/store';
import type { RepoSnapshot } from '../../contracts/audit';
import type { Draft, IssueTriage, IssueWorkflowStatus, Project, ReproductionJob, ReproductionPlan, Usage } from '../../contracts/workbench';

export function workbenchDb() {
  const database = db();
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (owner TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (run_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS issue_triage (owner TEXT NOT NULL, repo_url TEXT NOT NULL, number INTEGER NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, repo_url, number));
    CREATE TABLE IF NOT EXISTS reproduction_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo_url TEXT NOT NULL, issue_number INTEGER NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reproduction_owner_repo ON reproduction_jobs(owner, repo_url, issue_number);
    CREATE TABLE IF NOT EXISTS reproduction_leases (job_id TEXT PRIMARY KEY, worker TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reproduction_workers (id TEXT PRIMARY KEY, heartbeat INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS issue_triage_owner_repo ON issue_triage(owner, repo_url);
    CREATE INDEX IF NOT EXISTS drafts_owner ON drafts(owner);
    CREATE TABLE IF NOT EXISTS model_usage (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL, purpose TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, failed INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operation_locks (key TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  `);
  return database;
}
export function getProject(owner: string): Project | null {
  const row = workbenchDb().prepare('SELECT state FROM projects WHERE owner = ?').get(owner) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}
export function saveProject(owner: string, project: Omit<Project, 'updatedAt'>) {
  const value = { ...project, updatedAt: new Date().toISOString() };
  workbenchDb().prepare('INSERT INTO projects VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state').run(owner, JSON.stringify(value));
  return value;
}
export function saveSnapshot(runId: string, snapshot: RepoSnapshot) {
  workbenchDb().prepare('INSERT INTO snapshots VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET state=excluded.state').run(runId, JSON.stringify(snapshot));
}
export function getSnapshot(runId: string): RepoSnapshot | null {
  const row = workbenchDb().prepare('SELECT state FROM snapshots WHERE run_id=?').get(runId) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}
export function getDraft(owner: string, id: string): Draft {
  const row = workbenchDb().prepare('SELECT state FROM drafts WHERE owner=? AND id=?').get(owner, id) as { state: string } | undefined;
  if (!row) throw new Error('草稿不存在或不属于当前账户。');
  const draft: Draft = JSON.parse(row.state);
  if (draft.status === 'publishing' && !workbenchDb().prepare('SELECT key FROM operation_locks WHERE key=? AND expires>?').get(`${owner}:publish:${id}`, Date.now())) return { ...draft, status: 'uncertain' };
  return draft;
}
export function listDrafts(owner: string): Draft[] {
  return (workbenchDb().prepare('SELECT id FROM drafts WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner) as { id: string }[]).map(row => getDraft(owner, row.id));
}
export function getIssueTriage(owner: string, repoUrl: string, number: number): IssueTriage | null {
  const row = workbenchDb().prepare('SELECT state FROM issue_triage WHERE owner=? AND repo_url=? AND number=?').get(owner, repoUrl, number) as { state: string } | undefined;
  return row ? JSON.parse(row.state) as IssueTriage : null;
}
export function listIssueTriages(owner: string, repoUrl: string, numbers?: number[]): IssueTriage[] {
  if (!numbers?.length) return (workbenchDb().prepare('SELECT state FROM issue_triage WHERE owner=? AND repo_url=? ORDER BY number').all(owner, repoUrl) as { state: string }[]).map(row => JSON.parse(row.state) as IssueTriage);
  const placeholders = numbers.map(() => '?').join(',');
  return (workbenchDb().prepare(`SELECT state FROM issue_triage WHERE owner=? AND repo_url=? AND number IN (${placeholders})`).all(owner, repoUrl, ...numbers) as { state: string }[]).map(row => JSON.parse(row.state) as IssueTriage);
}
export function saveIssueTriage(owner: string, repoUrl: string, triage: IssueTriage): IssueTriage {
  workbenchDb().prepare('INSERT INTO issue_triage (owner, repo_url, number, state, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, repo_url, number) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at').run(owner, repoUrl, triage.number, JSON.stringify(triage), triage.analyzedAt);
  return triage;
}
export function updateIssueWorkflowStatus(owner: string, repoUrl: string, number: number, status: IssueWorkflowStatus): IssueTriage {
  const current = getIssueTriage(owner, repoUrl, number);
  if (!current) throw new Error('请先完成一次 Issue 分析，再更新处理状态。');
  const next = { ...current, workflowStatus: status };
  return saveIssueTriage(owner, repoUrl, next);
}
export function createReproductionJob(owner: string, input: { repoUrl: string; branch?: string; commitSha: string; issueNumber: number; sourceUpdatedAt: string; plan: ReproductionPlan }): ReproductionJob {
  const now = new Date().toISOString();
  const job: ReproductionJob = { id: randomUUID(), repoUrl: input.repoUrl, branch: input.branch, commitSha: input.commitSha, issueNumber: input.issueNumber, sourceUpdatedAt: input.sourceUpdatedAt, plan: input.plan, status: 'awaiting-confirmation', attempts: 0, successfulAttempts: 0, attemptHistory: [], artifacts: [], createdAt: now, updatedAt: now };
  workbenchDb().prepare('INSERT INTO reproduction_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, owner, job.repoUrl, job.issueNumber, job.status, JSON.stringify(job), now, now);
  return job;
}
export function getReproductionJob(owner: string, id: string): ReproductionJob {
  const row = workbenchDb().prepare('SELECT state FROM reproduction_jobs WHERE owner=? AND id=?').get(owner, id) as { state: string } | undefined;
  if (!row) throw new Error('复现任务不存在或不属于当前会话。');
  return JSON.parse(row.state) as ReproductionJob;
}
export function listReproductionJobs(owner: string, repoUrl: string, issueNumber?: number): ReproductionJob[] {
  const rows = issueNumber ? workbenchDb().prepare('SELECT state FROM reproduction_jobs WHERE owner=? AND repo_url=? AND issue_number=? ORDER BY created_at DESC LIMIT 20').all(owner, repoUrl, issueNumber) : workbenchDb().prepare('SELECT state FROM reproduction_jobs WHERE owner=? AND repo_url=? ORDER BY created_at DESC LIMIT 50').all(owner, repoUrl);
  return (rows as { state: string }[]).map(row => JSON.parse(row.state) as ReproductionJob);
}
export function updateReproductionJob(owner: string, id: string, change: Partial<ReproductionJob>): ReproductionJob {
  const current = getReproductionJob(owner, id); const next = { ...current, ...change, updatedAt: new Date().toISOString() };
  workbenchDb().prepare('UPDATE reproduction_jobs SET status=?, state=?, updated_at=? WHERE owner=? AND id=?').run(next.status, JSON.stringify(next), next.updatedAt, owner, id);
  return next;
}
export function queueReproductionJob(owner: string, id: string, repoUrl: string): ReproductionJob {
  const database = workbenchDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare('SELECT state FROM reproduction_jobs WHERE owner=? AND id=?').get(owner, id) as { state: string } | undefined;
    if (!row) throw new Error('复现任务不存在或不属于当前账户。');
    const job = JSON.parse(row.state) as ReproductionJob;
    if (job.repoUrl !== repoUrl) throw new Error('复现任务不属于当前项目。');
    if (job.status !== 'awaiting-confirmation') throw new Error('复现任务不在等待确认状态。');
    const active = database.prepare("SELECT COUNT(*) AS n FROM reproduction_jobs WHERE owner=? AND repo_url=? AND status IN ('queued','running')").get(owner, repoUrl) as { n: number };
    if (active.n >= 2) throw new Error('每个项目最多同时排队或执行 2 个复现任务。');
    const next: ReproductionJob = { ...job, status: 'queued', phase: 'source', progress: '已确认，等待隔离执行服务', updatedAt: new Date().toISOString() };
    database.prepare('UPDATE reproduction_jobs SET status=?, state=?, updated_at=? WHERE owner=? AND id=?').run(next.status, JSON.stringify(next), next.updatedAt, owner, id);
    database.exec('COMMIT');
    return next;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
export function cancelReproductionJob(owner: string, id: string, repoUrl: string): ReproductionJob {
  const database = workbenchDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare('SELECT state FROM reproduction_jobs WHERE owner=? AND id=?').get(owner, id) as { state: string } | undefined;
    if (!row) throw new Error('复现任务不存在或不属于当前账户。');
    const job = JSON.parse(row.state) as ReproductionJob;
    if (job.repoUrl !== repoUrl) throw new Error('复现任务不属于当前项目。');
    if (!['awaiting-confirmation', 'queued'].includes(job.status)) throw new Error('当前任务不能取消。');
    const next: ReproductionJob = { ...job, status: 'cancelled', error: '已由维护者取消', progress: '任务已取消，未执行仓库代码', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    database.prepare('UPDATE reproduction_jobs SET status=?, state=?, updated_at=? WHERE owner=? AND id=?').run(next.status, JSON.stringify(next), next.updatedAt, owner, id);
    database.prepare('DELETE FROM reproduction_leases WHERE job_id=?').run(id);
    database.exec('COMMIT');
    return next;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function createDraft(owner: string, input: Omit<Draft, 'id' | 'revision' | 'status' | 'createdAt'>): Draft {
  const draft: Draft = { ...input, id: randomUUID(), revision: 1, status: 'draft', createdAt: new Date().toISOString() };
  workbenchDb().prepare('INSERT INTO drafts VALUES (?, ?, ?)').run(draft.id, owner, JSON.stringify(draft));
  return draft;
}
export function updateDraft(owner: string, id: string, revision: number, change: Partial<Pick<Draft, 'content' | 'status' | 'publishedUrl'>>): Draft {
  const database = workbenchDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const draft = getDraft(owner, id);
    if (draft.revision !== revision) throw new Error('草稿已变化，请刷新后重新审阅。');
    if (change.content !== undefined && draft.status !== 'draft') throw new Error('发布中或已发布的草稿不能编辑。');
    const next = { ...draft, ...change, revision: draft.revision + 1 };
    database.prepare('UPDATE drafts SET state=? WHERE id=? AND owner=?').run(JSON.stringify(next), id, owner);
    database.exec('COMMIT'); return next;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
export function recordUsage(owner: string, purpose: string, input = 0, output = 0, failed = false) {
  workbenchDb().prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), owner, Date.now(), purpose, input, output, Number(failed));
}
export function usage(owner: string): Usage {
  const row = workbenchDb().prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(failed),0) AS failures FROM model_usage WHERE owner=?').get(owner);
  return row as unknown as Usage;
}
export async function withOperation<T>(owner: string, purpose: string, operation: () => Promise<T>): Promise<T> {
  const database = workbenchDb(), key = `${owner}:${purpose}`, now = Date.now();
  database.prepare('DELETE FROM operation_locks WHERE expires < ?').run(now);
  if (!database.prepare('INSERT OR IGNORE INTO operation_locks VALUES (?, ?)').run(key, now + 180_000).changes) throw new Error('当前操作正在执行，请勿重复提交。');
  try {
    const recent = database.prepare('SELECT COUNT(*) AS n FROM model_usage WHERE owner=? AND at>?').get(owner, now - 3600_000) as { n: number };
    if (recent.n >= 60) throw new Error('本小时模型请求已达 60 次，请稍后再试。');
    return await operation();
  } finally { database.prepare('DELETE FROM operation_locks WHERE key=?').run(key); }
}
