import { randomUUID } from 'node:crypto';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { MaintenanceTask, RepositoryMemory } from '../../contracts/agent';
import type { RuntimeConnection } from '../../contracts/models';
import { workbenchDb } from '../workbench/store';
import { encryptSecret, decryptSecret } from '../models/crypto';
import { publicSelection, selectedConnection } from '../models/run-config';
interface InternalState {
    messages: AgentMessage[];
    consumed: string[];
    cache: Record<string, string>;
    attempts: number;
}
interface Row {
    id: string;
    owner: string;
    state: string;
    internal: string;
    connection: string;
    worker: string | null;
    lease: number;
}
export interface ClaimedTask {
    task: MaintenanceTask;
    owner: string;
    internal: InternalState;
    connection: RuntimeConnection;
    worker: string;
}
function database() {
    const db = workbenchDb();
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, internal TEXT NOT NULL, connection TEXT NOT NULL, worker TEXT, lease INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS maintenance_owner ON maintenance_tasks(owner,repo,branch);
    CREATE TABLE IF NOT EXISTS maintenance_workers(id TEXT PRIMARY KEY, pulse INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance_messages(id TEXT PRIMARY KEY, task TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance_memory(id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, state TEXT NOT NULL);`);
    db.exec('CREATE INDEX IF NOT EXISTS maintenance_queue ON maintenance_tasks(status,lease); CREATE INDEX IF NOT EXISTS maintenance_message_task ON maintenance_messages(task); CREATE INDEX IF NOT EXISTS maintenance_memory_repo ON maintenance_memory(owner,repo);');
    return db;
}
function row(id: string, owner?: string) { return database().prepare(`SELECT * FROM maintenance_tasks WHERE id=?${owner ? ' AND owner=?' : ''}`).get(...(owner ? [id, owner] : [id])) as unknown as Row | undefined; }
export function getTask(owner: string, id: string): MaintenanceTask | null {
    const found = row(id, owner);
    if (!found)
        return null;
    const task: MaintenanceTask = JSON.parse(found.state), known = new Set(task.dialogue.map(m => m.id));
    const added = (database().prepare('SELECT state FROM maintenance_messages WHERE task=? ORDER BY rowid').all(id) as {
        state: string;
    }[]).map(m => JSON.parse(m.state));
    task.dialogue.push(...added.filter(m => !known.has(m.id)));
    return task;
}
export function listTasks(owner: string, repo: string, branch?: string): MaintenanceTask[] {
    return (database().prepare('SELECT state FROM maintenance_tasks WHERE owner=? AND repo=? AND branch=? ORDER BY rowid DESC LIMIT 40').all(owner, repo, branch || '') as {
        state: string;
    }[]).map(item => JSON.parse(item.state));
}
export function createTask(owner: string, project: {
    repoUrl: string;
    branch?: string;
}, input: Pick<MaintenanceTask, 'kind' | 'number' | 'goal'>) {
    const connection = selectedConnection(owner);
    if (!connection)
        throw new Error('请先在设置中配置模型连接。');
    const db = database(), id = randomUUID(), now = new Date().toISOString();
    const task: MaintenanceTask = { id, ...project, requestedBranch: project.branch, ...input, model: publicSelection(connection), status: 'queued', createdAt: now, updatedAt: now,
        plan: [], events: [], dialogue: [{ id: randomUUID(), role: 'user', content: input.goal, at: now }], evidence: [], artifacts: [],
        budget: { turns: 0, tools: 0, maxTurns: 24, maxTools: 48, inputTokens: 0, outputTokens: 0, compactions: 0 } };
    const encrypted = encryptSecret(JSON.stringify(connection), `maintenance:${id}`);
    db.exec('BEGIN IMMEDIATE');
    try {
        const count = db.prepare("SELECT count(*) AS n FROM maintenance_tasks WHERE owner=? AND status IN ('queued','running')").get(owner) as {
            n: number;
        };
        if (count.n >= 3)
            throw new Error('最多同时保留 3 个排队或运行中的 Agent 任务。');
        db.prepare('INSERT INTO maintenance_tasks(id,owner,repo,branch,status,state,internal,connection) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, project.repoUrl, project.branch || '', task.status, JSON.stringify(task), JSON.stringify({ messages: [], consumed: [], cache: {}, attempts: 0 }), encrypted);
        db.exec('COMMIT');
        return task;
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
/** All worker writes are fenced; a cancelled/reclaimed task cannot be revived. */
export function saveClaim(claim: ClaimedTask) {
    claim.task.updatedAt = new Date().toISOString();
    const result = database().prepare("UPDATE maintenance_tasks SET state=?,internal=?,status=? WHERE id=? AND worker=? AND lease>? AND status='running'").run(JSON.stringify(claim.task), JSON.stringify(claim.internal), claim.task.status, claim.task.id, claim.worker, Date.now());
    if (!result.changes)
        throw new Error('任务已停止或执行租约已失效。');
}
export function localProposal<T>(claim: ClaimedTask, create: () => T): T {
    const db = database(), previous = structuredClone(claim.task.artifacts);
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = create();
        db.exec('COMMIT');
        return result;
    }
    catch (error) {
        db.exec('ROLLBACK');
        claim.task.artifacts = previous;
        throw error;
    }
}
export function mutateTask(owner: string, id: string, action: 'message' | 'resume' | 'cancel', content?: string) {
    const db = database();
    db.exec('BEGIN IMMEDIATE');
    try {
        const found = row(id, owner);
        if (!found)
            throw new Error('任务不存在。');
        const task = getTask(owner, id)!;
        if (action === 'message' && content) {
            const message = { id: randomUUID(), role: 'user' as const, content, at: new Date().toISOString() };
            task.dialogue.push(message);
            if (task.dialogue.length > 80)
                throw new Error('此任务对话已达到 80 条，请新建任务。');
            db.prepare('INSERT INTO maintenance_messages(id,task,state) VALUES(?,?,?)').run(message.id, id, JSON.stringify(message));
        }
        if (action === 'cancel')
            { task.status = 'cancelled'; task.notice='Agent调查已停止，已有交付物保留。此前已确认的隔离执行任务独立运行。'; }
        else if (task.status !== 'running' && task.status !== 'queued') {
            const count = db.prepare("SELECT count(*) AS n FROM maintenance_tasks WHERE owner=? AND status IN ('queued','running')").get(owner) as {
                n: number;
            };
            if (count.n >= 3)
                throw new Error('当前已有 3 个活动任务，请稍后继续。');
            task.status = 'queued';
            task.notice = undefined;
            task.budget.maxTurns = Math.min(96, Math.max(task.budget.maxTurns, task.budget.turns + 16));
            task.budget.maxTools = Math.min(192, Math.max(task.budget.maxTools, task.budget.tools + 32));
            if (task.budget.turns >= 96 || task.budget.tools >= 192)
                throw new Error('任务已达累计预算，请新建范围更小的任务。');
        }
        task.updatedAt = new Date().toISOString();
        db.prepare('UPDATE maintenance_tasks SET state=?,status=?,worker=?,lease=? WHERE id=?').run(JSON.stringify(task), task.status, task.status === 'running' ? found.worker : null, task.status === 'running' ? found.lease : 0, id);
        db.exec('COMMIT');
        return task;
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
export function pulseWorker(worker: string) {
    const db = database(), now = Date.now();
    db.prepare('INSERT INTO maintenance_workers(id,pulse) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET pulse=excluded.pulse').run(worker, now);
    db.prepare("UPDATE maintenance_tasks SET lease=? WHERE worker=? AND status='running'").run(now + 30000, worker);
}
export function agentWorkerOnline() { return Boolean(database().prepare('SELECT id FROM maintenance_workers WHERE pulse>? LIMIT 1').get(Date.now() - 20000)); }
export function claimActive(claim: ClaimedTask) { return Boolean(database().prepare("SELECT id FROM maintenance_tasks WHERE id=? AND worker=? AND status='running' AND lease>?").get(claim.task.id, claim.worker, Date.now())); }
export function stopWorker(worker: string) { database().prepare('DELETE FROM maintenance_workers WHERE id=?').run(worker); database().prepare('UPDATE maintenance_tasks SET lease=0 WHERE worker=?').run(worker); }
export function claimTask(worker: string): ClaimedTask | null {
    const db = database();
    db.exec('BEGIN IMMEDIATE');
    try {
        const expired = db.prepare("SELECT * FROM maintenance_tasks WHERE status='running' AND lease<?").all(Date.now()) as unknown as Row[];
        for (const old of expired) {
            const task: MaintenanceTask = JSON.parse(old.state), internal: InternalState = JSON.parse(old.internal);
            task.status = internal.attempts >= 3 ? 'paused' : 'queued';
            task.notice = '上次 Worker 中断；从最近一轮已保存的检查点继续。';
            db.prepare('UPDATE maintenance_tasks SET status=?,state=?,worker=NULL,lease=0 WHERE id=?').run(task.status, JSON.stringify(task), old.id);
        }
        const found = db.prepare("SELECT * FROM maintenance_tasks WHERE status='queued' ORDER BY rowid LIMIT 1").get() as unknown as Row | undefined;
        if (!found) {
            db.exec('COMMIT');
            return null;
        }
        const task: MaintenanceTask = JSON.parse(found.state), internal: InternalState = JSON.parse(found.internal);
        let connection: RuntimeConnection;
        try {
            connection = JSON.parse(decryptSecret(found.connection, `maintenance:${task.id}`));
        }
        catch {
            task.status = 'failed';
            task.notice = '无法解密此任务的模型配置，请恢复数据库对应的本地主密钥或重新创建任务。';
            db.prepare('UPDATE maintenance_tasks SET status=?,state=? WHERE id=?').run(task.status, JSON.stringify(task), task.id);
            db.exec('COMMIT');
            return null;
        }
        internal.attempts++;
        task.status = 'running';
        task.notice = undefined;
        db.prepare('UPDATE maintenance_tasks SET status=?,state=?,internal=?,worker=?,lease=? WHERE id=?').run(task.status, JSON.stringify(task), JSON.stringify(internal), worker, Date.now() + 30000, task.id);
        db.exec('COMMIT');
        return { task, owner: found.owner, internal, connection, worker };
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
/** Merge supplemental user messages without overwriting them with worker snapshots. */
export function syncDialogue(claim: ClaimedTask) {
    const latest = getTask(claim.owner, claim.task.id);
    if (!latest || latest.status !== 'running')
        throw new Error('任务已停止。');
    const known = new Set(claim.task.dialogue.map(item => item.id));
    claim.task.dialogue.push(...latest.dialogue.filter(item => !known.has(item.id)));
    return claim.task.dialogue.filter(item => item.role === 'user' && !claim.internal.consumed.includes(item.id));
}
/** Atomically finish a segment or queue messages that arrived during settlement. */
export function finishClaim(claim: ClaimedTask) {
    const db=database();db.exec('BEGIN IMMEDIATE');
    try {
        if(syncDialogue(claim).length)claim.task.status='queued';
        saveClaim(claim);db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
}
export function memories(owner: string, repo: string): RepositoryMemory[] { return (database().prepare("SELECT state FROM maintenance_memory WHERE owner=? AND repo=? AND COALESCE(json_extract(state,'$.archived'),0)=0 ORDER BY rowid DESC LIMIT 100").all(owner, repo) as {
    state: string;
}[]).map(row => JSON.parse(row.state)).filter(item => !item.archived); }
export function remember(owner: string, task: MaintenanceTask, content: string, evidenceIds: string[]) {
    if (!task.commitSha || evidenceIds.some(id => !task.evidence.some(item => item.id === id)))
        throw new Error('知识必须关联已读取的提交及有效证据。');
    const memory: RepositoryMemory = { id: randomUUID(), taskId: task.id, content, evidenceIds, commitSha: task.commitSha, createdAt: new Date().toISOString() };
    database().prepare('INSERT INTO maintenance_memory(id,owner,repo,state) VALUES(?,?,?,?)').run(memory.id, owner, task.repoUrl, JSON.stringify(memory));
    return memory;
}
export function archiveMemory(owner: string, repo: string, id: string) {
    const db = database(), found = db.prepare('SELECT state FROM maintenance_memory WHERE id=? AND owner=? AND repo=?').get(id, owner, repo) as {
        state: string;
    } | undefined;
    if (!found)
        throw new Error('知识条目不存在。');
    db.prepare('UPDATE maintenance_memory SET state=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(found.state), archived: true }), id);
}
