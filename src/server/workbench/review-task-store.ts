import { randomUUID } from 'node:crypto';
import type { GitItem, PullRequestReview } from '../../contracts/workbench';
import type { PullReviewTask, ReviewBlock } from '../../contracts/review-task';
import type { ProjectPolicy } from '../../contracts/policy';
import type { RuntimeConnection } from '../../contracts/models';
import { decryptSecret, encryptSecret } from '../models/crypto';
import { publicSelection } from '../models/run-config';
import { workbenchDb, getPullRequestReview } from './store';
import { planReview, type ReviewFile } from './review-plan';
import { reviewSourceFingerprint } from '../../shared/lib/pr-review-context';
import { assessPullPolicy } from '../../shared/lib/project-policy';
export interface ReviewInternal { item: GitItem; policy: ProjectPolicy | null; fingerprint: string; fragments: Record<string, ReviewFile>; results: Record<string, PullRequestReview> }
interface Row { id: string; owner: string; state: string; internal: string; connection: string; worker?: string; lease: number }
export interface ReviewClaim { owner: string; task: PullReviewTask; internal: ReviewInternal; connection: RuntimeConnection; worker: string; block: ReviewBlock }
function database() { const db = workbenchDb(); db.exec('CREATE TABLE IF NOT EXISTS pull_review_tasks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,repo TEXT NOT NULL,number INTEGER NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,internal TEXT NOT NULL,connection TEXT NOT NULL,worker TEXT,lease INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS pull_review_task_scope ON pull_review_tasks(owner,repo,number);'); return db; }
export function latestReviewTask(owner: string, repo: string, number: number): PullReviewTask | null { const row = database().prepare('SELECT state FROM pull_review_tasks WHERE owner=? AND repo=? AND number=? ORDER BY rowid DESC LIMIT 1').get(owner, repo, number) as { state: string } | undefined; return row ? JSON.parse(row.state) : null; }
export function recentReviewTasks(owner: string, repo: string): PullReviewTask[] {
  return (database().prepare('SELECT state FROM pull_review_tasks WHERE owner=? AND repo=? ORDER BY rowid DESC LIMIT 40').all(owner, repo) as { state: string }[]).map(row => JSON.parse(row.state));
}
function rowFor(owner: string, id: string) { return database().prepare('SELECT * FROM pull_review_tasks WHERE id=? AND owner=?').get(id, owner) as Row | undefined; }
export function createReviewTask(owner: string, repo: string, item: GitItem, policy: ProjectPolicy | null, connection: RuntimeConnection, force: boolean) {
  const db = database(), fingerprint = reviewSourceFingerprint(item), now = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
  try {
    const existing = latestReviewTask(owner, repo, item.number);
    if (existing) { const old = rowFor(owner, existing.id)!; const same = JSON.parse(old.internal).fingerprint === fingerprint && existing.policyRevision === policy?.revision;
      if (same && (['queued', 'running'].includes(existing.status) || !force && !['cancelled', 'stale'].includes(existing.status))) { db.exec('COMMIT'); return existing; }
      if (['queued', 'running'].includes(existing.status)) { existing.status = 'stale'; existing.notice = 'PR 或项目规则已变化，请使用新的审查任务。'; persist(existing, owner); }
    }
    const count = db.prepare("SELECT count(*) AS n FROM pull_review_tasks WHERE owner=? AND status IN ('queued','running')").get(owner) as { n: number }; if (count.n >= 3) throw new Error('最多同时排队或运行 3 个 PR 审查，请完成或停止现有任务。');
    const queued = db.prepare("SELECT count(*) AS n FROM pull_review_tasks WHERE status IN ('queued','running')").get() as { n: number }; if (queued.n >= 20) throw new Error('PR 审查队列已满，请稍后重试。');
    const recent = db.prepare("SELECT count(*) AS n FROM pull_review_tasks WHERE owner=? AND json_extract(state,'$.createdAt')>?").get(owner, new Date(Date.now() - 3600000).toISOString()) as { n: number }; if (recent.n >= 30) throw new Error('本小时已创建 30 个 PR 审查任务，请稍后再试。');
    const planned = planReview(item.files || []), id = randomUUID();
    const task: PullReviewTask = { id, repoUrl: repo, number: item.number, headSha: item.headSha!, baseSha: item.baseSha!, status: planned.blocks.some(b => b.status === 'pending') ? 'queued' : 'partial', blocks: planned.blocks, createdAt: now, updatedAt: now, model: publicSelection(connection), policyRevision: policy?.revision, filesRead: item.files?.length || 0, totalFiles: item.totalChangedFiles ?? item.files?.length ?? 0, filesComplete: !item.filesTruncated, revision: 1 };
    const internal: ReviewInternal = { item, policy, fingerprint, fragments: planned.fragments, results: {} };
    db.prepare('INSERT INTO pull_review_tasks(id,owner,repo,number,status,state,internal,connection) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, repo, item.number, task.status, JSON.stringify(task), JSON.stringify(internal), encryptSecret(JSON.stringify(connection), `pull-review:${id}`));
    writeAggregate(owner, task, internal);
    db.exec('COMMIT'); return task;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function persist(task: PullReviewTask, owner: string, internal?: ReviewInternal) { task.updatedAt = new Date().toISOString(); task.revision++; database().prepare(`UPDATE pull_review_tasks SET status=?,state=?,worker=NULL,lease=0${internal ? ',internal=?' : ''} WHERE id=? AND owner=?`).run(task.status, JSON.stringify(task), ...(internal ? [JSON.stringify(internal)] : []), task.id, owner); }
export function mutateReviewTask(owner: string, repo: string, id: string, action: 'cancel' | 'retry', fingerprint?: string, policyRevision?: number, blockId?: string) {
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try { const row = rowFor(owner, id); if (!row) throw new Error('审查任务不存在。'); const task: PullReviewTask = JSON.parse(row.state), internal: ReviewInternal = JSON.parse(row.internal); if (task.repoUrl !== repo) throw new Error('任务不属于当前项目。');
    if (action === 'cancel') { if (['queued', 'running'].includes(task.status)) { task.status = 'cancelled'; task.blocks.filter(b => b.status === 'running').forEach(b => { b.status = 'failed'; b.reason = '维护者停止了执行；已保存结果保留。'; }); } }
    else { if (['queued', 'running', 'stale'].includes(task.status)) throw new Error('请等待任务结束后重试失败块，版本过期须重新审查。'); if (internal.fingerprint !== fingerprint || task.policyRevision !== policyRevision) throw new Error('PR 或规则版本已变化，请重新审查。'); const failed = task.blocks.filter(b => b.status === 'failed' && b.attempts < 3 && (!blockId || b.id === blockId)); if (!failed.length) throw new Error('没有可重试的失败块，单块最多 3 次尝试。'); failed.forEach(b => { b.status = 'pending'; b.reason = undefined; }); task.status = 'queued'; task.notice = '仅重试所选失败块，已完成结果保留。'; }
    persist(task, owner); writeAggregate(owner, task, internal); db.exec('COMMIT'); return task;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function pulseReviewWorker(worker: string) { database().prepare("UPDATE pull_review_tasks SET lease=? WHERE worker=? AND status='running'").run(Date.now() + 30000, worker); }
export function releaseReviewWorker(worker: string) { database().prepare('UPDATE pull_review_tasks SET lease=0 WHERE worker=?').run(worker); }
export function claimReviewBlock(worker: string): ReviewClaim | null {
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of db.prepare("SELECT * FROM pull_review_tasks WHERE status='running' AND lease<?").all(Date.now()) as unknown as Row[]) { const task: PullReviewTask = JSON.parse(row.state), internal: ReviewInternal = JSON.parse(row.internal); task.blocks.filter(b => b.status === 'running').forEach(b => { b.status = 'failed'; b.reason = 'Worker 中断，此块未完成，可手动重试；不会自动重复模型调用。'; }); task.status = task.blocks.some(b => b.status === 'pending') ? 'queued' : 'partial'; persist(task, row.owner); writeAggregate(row.owner, task, internal); }
    const row = db.prepare("SELECT * FROM pull_review_tasks WHERE status='queued' ORDER BY rowid LIMIT 1").get() as Row | undefined;
    if (!row) { db.exec('COMMIT'); return null; }
    const task: PullReviewTask = JSON.parse(row.state), internal: ReviewInternal = JSON.parse(row.internal), block = task.blocks.find(b => b.status === 'pending');
    if (!block) { task.status = 'partial'; persist(task, row.owner); db.exec('COMMIT'); return null; }
    let connection: RuntimeConnection;
    try { connection = JSON.parse(decryptSecret(row.connection, `pull-review:${task.id}`)); } catch { task.blocks.filter(b => b.status === 'pending').forEach(b => { b.status = 'failed'; b.reason = '任务模型配置无法解密，请检查对应的本地主密钥。'; }); task.status = 'partial'; persist(task, row.owner); writeAggregate(row.owner, task, internal); db.exec('COMMIT'); return null; }
    block.status = 'running'; block.attempts++; task.status = 'running'; task.updatedAt = new Date().toISOString(); task.revision++;
    db.prepare('UPDATE pull_review_tasks SET status=?,state=?,worker=?,lease=? WHERE id=?').run(task.status, JSON.stringify(task), worker, Date.now() + 30000, task.id); db.exec('COMMIT');
    return { owner: row.owner, task, internal, block, connection, worker };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function activeReviewClaim(claim: ReviewClaim) { return !!database().prepare("SELECT id FROM pull_review_tasks WHERE id=? AND worker=? AND lease>? AND status='running'").get(claim.task.id, claim.worker, Date.now()); }
export function finishReviewBlock(claim: ReviewClaim, review?: PullRequestReview, error?: string, stale = false) {
  const db = database(); db.exec('BEGIN IMMEDIATE');
  try { if (!activeReviewClaim(claim)) { db.exec('COMMIT'); return; } const { task, internal, block, owner } = claim;
    block.status = review ? 'completed' : 'failed'; block.reason = error; block.summary = review?.summary; block.finishedAt = new Date().toISOString(); if (review) internal.results[block.id] = review;
    task.status = stale ? 'stale' : task.blocks.some(b => b.status === 'pending') ? 'queued' : task.blocks.some(b => b.status !== 'completed') || !task.filesComplete ? 'partial' : 'completed';
    task.notice = stale ? 'PR、项目上下文或规则版本已变化；已保存结果仅作历史参考，请重新审查。' : undefined;
    persist(task, owner, internal); writeAggregate(owner, task, internal); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function writeAggregate(owner: string, task: PullReviewTask, internal: ReviewInternal) {
  const old = getPullRequestReview(owner, task.repoUrl, task.number);
  // An older task may be cancelled after a newer report exists.
  if (latestReviewTask(owner, task.repoUrl, task.number)?.id !== task.id) return;
  const paths = (internal.item.files || []).map(f => f.path), completeFiles = paths.filter(p => task.blocks.filter(b => b.path === p).every(b => b.status === 'completed')), partialFiles = paths.filter(p => !completeFiles.includes(p) && task.blocks.some(b => b.path === p && b.status === 'completed')), unreviewedFiles = paths.filter(p => !completeFiles.includes(p) && !partialFiles.includes(p));
  const completed = task.blocks.filter(b => b.status === 'completed').length, total = task.blocks.filter(b => b.status !== 'skipped').length;
  const seen = new Set<string>(), findings = Object.values(internal.results).flatMap(r => r.findings).filter(f => { const key = JSON.stringify([f.path, f.line, f.side, f.evidence, f.title]); if (seen.has(key)) return false; seen.add(key); return true; }).map(f => { const previous = old?.coverage?.taskId === task.id ? old.findings.find(x => x.id === f.id) : undefined; return previous ? { ...f, status: previous.status, reviewerNote: previous.reviewerNote, reviewedAt: previous.reviewedAt } : f; });
  const report: PullRequestReview = { id: old?.coverage?.taskId === task.id ? old.id : task.id, revision: old?.coverage?.taskId === task.id ? old.revision + 1 : 1, repoUrl: task.repoUrl, number: task.number, title: internal.item.title, headSha: task.headSha, baseSha: task.baseSha, snapshotFingerprint: internal.fingerprint, summary: `已完成 ${completed}/${total} 个可审查块；${completeFiles.length} 个文件的可见 Diff 已全部处理，${partialFiles.length} 个部分处理，${unreviewedFiles.length} 个未审。${task.status === 'completed' ? '以下发现仍需维护者确认。' : '本报告包含未完成范围，不能视为完整审查。'}`, scope: { files: task.filesRead, totalFiles: task.totalFiles, filesComplete: task.filesComplete, additions: (internal.item.files || []).reduce((n, f) => n + f.additions, 0), deletions: (internal.item.files || []).reduce((n, f) => n + f.deletions, 0), truncatedFiles: task.filesRead - completeFiles.length, reviewedFiles: completeFiles, testFiles: paths.filter(p => /test|spec/i.test(p)), docsFiles: paths.filter(p => /\.(?:md|rst|adoc)$/i.test(p)) }, coverage: { taskId: task.id, status: task.status, completeFiles, partialFiles, unreviewedFiles, unreadFiles: Math.max(0, task.totalFiles - task.filesRead), completedBlocks: completed, totalBlocks: total }, policy: assessPullPolicy(internal.policy, internal.item), model: task.model, checks: internal.item.checks || [], checksAvailable: internal.item.checksAvailable, linkedIssues: internal.item.linkedIssues, findings, limitations: [...new Set(['未运行 PR 测试；模型只审查各块可见 Diff，跨块影响仍需人工或深入源码核对。', '单任务最多 32 个可执行块；每块一次调用及至多一次格式修复；失败需显式重试，最多 3 次尝试。', ...task.blocks.filter(b => b.reason).map(b => `${b.path} · 第 ${b.part} 段：${b.reason}`), ...(internal.item.snapshotWarnings || []), ...Object.values(internal.results).flatMap(r => r.limitations).filter(x => !x.includes('无完整 patch'))])].slice(0, 120), analyzedAt: new Date().toISOString(), promptVersion: 'pr-chunk-v1' };
  const db = database(); db.prepare('INSERT INTO pull_request_reviews VALUES(?,?,?,?,?) ON CONFLICT(owner,repo_url,number) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').run(owner, task.repoUrl, task.number, JSON.stringify(report), report.analyzedAt); db.prepare('INSERT INTO pull_review_events VALUES(?,?,?,?,?,?)').run(randomUUID(), owner, task.repoUrl, task.number, JSON.stringify(report), report.analyzedAt);
}
