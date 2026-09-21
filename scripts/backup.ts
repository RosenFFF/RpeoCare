import { loadEnvConfig } from '@next/env';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

loadEnvConfig(process.cwd());
async function main() {
  const source = resolve(process.env.REPOCARE_DB_PATH || 'data/repocare.sqlite');
  const destination = resolve(process.argv[2] || `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(destination, { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try { await backup(database, join(destination, 'repocare.sqlite')); }
  finally { database.close(); }
  const key = join(dirname(source), '.model-key');
  if (!process.env.REPOCARE_MASTER_KEY && existsSync(key)) copyFileSync(key, join(destination, '.model-key'));
  writeFileSync(join(destination, 'RESTORE.txt'), '停止 Web 和所有 Worker，将数据库及对应 .model-key 恢复到 data 目录。使用环境变量主密钥时须另行安全保管原值。备份包含用户数据与密钥，不要上传 Git。\n');
  console.log(`Backup saved: ${destination}`);
}
main().catch(() => { console.error('Backup failed. Check paths and storage permissions.'); process.exitCode = 1; });
