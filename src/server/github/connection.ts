import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '../audit/store';
import { encryptSecret, decryptSecret } from '../models/crypto';

export const githubScope = new AsyncLocalStorage<{ token?: string; allowPrivate?: boolean }>();
export function authDb() {
  const database = db();
  database.exec(`CREATE TABLE IF NOT EXISTS github_accounts (github_id TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, login TEXT NOT NULL, secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, verifier TEXT NOT NULL, write_access INTEGER NOT NULL);`);
  return database;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function accountSession(token?: string): string | undefined {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  return (authDb().prepare('SELECT owner FROM login_sessions WHERE hash=? AND expires>?').get(hash(token), Date.now()) as { owner: string } | undefined)?.owner;
}
export function githubAccount(owner: string) {
  const row = authDb().prepare('SELECT login, secret FROM github_accounts WHERE owner=?').get(owner) as { login: string; secret: string } | undefined;
  if (!row) return null;
  const credentials = JSON.parse(decryptSecret(row.secret, `github:${owner}`)) as { token: string; canWrite: boolean };
  return { login: row.login, ...credentials };
}
export function saveGithubAccount(id: string, login: string, token: string, canWrite: boolean) {
  const database = authDb();
  const existing = database.prepare('SELECT owner FROM github_accounts WHERE github_id=?').get(id) as { owner: string } | undefined;
  const owner = existing?.owner || randomUUID();
  database.prepare('INSERT INTO github_accounts VALUES (?, ?, ?, ?) ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, secret=excluded.secret')
    .run(id, owner, login, encryptSecret(JSON.stringify({ token, canWrite }), `github:${owner}`));
  const session = randomBytes(32).toString('hex');
  database.prepare('DELETE FROM login_sessions WHERE expires<?').run(Date.now());
  database.prepare('INSERT INTO login_sessions VALUES (?, ?, ?)').run(hash(session), owner, Date.now() + 30 * 86400_000);
  return session;
}
export function withGithubOwner<T>(owner: string, operation: () => T): T {
  const account = githubAccount(owner);
  return githubScope.run({ token: account?.token, allowPrivate: !!account }, operation);
}
