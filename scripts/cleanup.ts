import { loadEnvConfig } from '@next/env';
import { db } from '../src/server/audit/store';
import { workbenchDb } from '../src/server/workbench/store';

loadEnvConfig(process.cwd());
const days = Number(process.env.REPOCARE_RETENTION_DAYS || 90);
if (!Number.isInteger(days) || days < 7) throw new Error('保留时间至少 7 天。');
const database = workbenchDb(), cutoff = new Date(Date.now() - days * 86400_000).toISOString();
const rows = database.prepare("SELECT id FROM audit_runs WHERE status IN ('completed','failed','cancelled') AND created_at<? AND id NOT IN (SELECT json_extract(state,'$.runId') FROM drafts WHERE json_extract(state,'$.runId') IS NOT NULL)").all(cutoff) as { id: string }[];
if (!process.argv.includes('--apply')) console.log(`Dry run: ${rows.length} terminal audits older than ${days} days. Pass --apply after backup.`);
else {
  database.exec('BEGIN IMMEDIATE');
  try { for (const { id } of rows) { database.prepare('DELETE FROM snapshots WHERE run_id=?').run(id); database.prepare('DELETE FROM conversations WHERE run_id=?').run(id); database.prepare('DELETE FROM audit_run_models WHERE run_id=?').run(id); database.prepare('DELETE FROM audit_runs WHERE id=?').run(id); } database.exec('COMMIT'); console.log(`Removed ${rows.length} expired audits.`); }
  catch (error) { database.exec('ROLLBACK'); throw error; }
}
db().close();
