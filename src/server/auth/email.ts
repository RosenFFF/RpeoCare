import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { authDb, hash } from '../github/connection';

const scrypt = promisify(scryptCallback);
export function emailDb() {
  const database = authDb();
  database.exec(`CREATE TABLE IF NOT EXISTS email_accounts (email TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS email_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT NOT NULL, at INTEGER NOT NULL);`);
  return database;
}
export function rateLimit(key: string, limit = 10) {
  const database = emailDb(), now = Date.now();
  database.prepare('DELETE FROM auth_attempts WHERE at<?').run(now - 3600_000);
  const count = database.prepare('SELECT COUNT(*) AS n FROM auth_attempts WHERE key=?').get(hash(key)) as { n: number };
  if (count.n >= limit) throw new Error('请求过于频繁，请一小时后重试。');
  database.prepare('INSERT INTO auth_attempts VALUES (?, ?)').run(hash(key), now);
}
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex'), derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest || digest.length !== 128) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(digest, 'hex'));
}
export function mailConfigured() { return !!(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.REPOCARE_APP_URL); }
async function sendToken(email: string, purpose: 'verify' | 'reset') {
  if (!mailConfigured()) throw new Error('邮件服务尚未配置，请设置 SMTP_HOST、SMTP_FROM 和 REPOCARE_APP_URL。');
  const token = randomBytes(32).toString('hex'), database = emailDb();
  database.prepare('DELETE FROM email_tokens WHERE expires<? OR (email=? AND purpose=?)').run(Date.now(), email, purpose);
  database.prepare('INSERT INTO email_tokens VALUES (?, ?, ?, ?)').run(hash(token), email, purpose, Date.now() + 30 * 60_000);
  const origin = new URL(process.env.REPOCARE_APP_URL!);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('公网邮件链接必须使用 HTTPS。');
  const url = new URL('/account', origin.origin); url.search = new URLSearchParams({ purpose, token }).toString();
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 10_000, socketTimeout: 15_000 });
  try { await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: purpose === 'verify' ? '验证 RepoCare 邮箱' : '重置 RepoCare 密码', text: `请打开链接完成${purpose === 'verify' ? '邮箱验证' : '密码重置'}，链接 30 分钟内有效且仅能使用一次。\n${url}\n如果并非你发起，请忽略。` }); }
  catch { database.prepare('DELETE FROM email_tokens WHERE hash=?').run(hash(token)); throw new Error('邮件发送失败，请检查邮件服务配置后重试。'); }
  finally { transport.close(); }
}
export async function register(email: string, name: string, password: string) {
  rateLimit(`register:${email}`, 5);
  if (!mailConfigured()) throw new Error('邮件服务尚未配置，暂时不能注册。');
  const database = emailDb();
  const existing = database.prepare('SELECT verified FROM email_accounts WHERE email=?').get(email) as { verified: number } | undefined;
  if (existing?.verified) return;
  const digest = await passwordHash(password);
  database.prepare('INSERT INTO email_accounts VALUES (?, ?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET name=excluded.name, password=excluded.password WHERE email_accounts.verified=0').run(email, randomUUID(), name, digest);
  await sendToken(email, 'verify');
}
export async function login(email: string, password: string) {
  rateLimit(`login:${email}`, 15);
  const database = emailDb();
  const account = database.prepare('SELECT owner, password, verified FROM email_accounts WHERE email=?').get(email) as { owner: string; password: string; verified: number } | undefined;
  const valid = await verifyPassword(password, account?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
  if (!account || !valid || !account.verified) throw new Error('邮箱、密码或验证状态不正确，请检查后重试。');
  const token = randomBytes(32).toString('hex');
  database.prepare('INSERT INTO login_sessions VALUES (?, ?, ?)').run(hash(token), account.owner, Date.now() + 30 * 86400_000);
  return token;
}
export async function requestReset(email: string) {
  rateLimit(`reset:${email}`, 5);
  if (!mailConfigured()) throw new Error('邮件服务尚未配置。');
  if (emailDb().prepare('SELECT email FROM email_accounts WHERE email=? AND verified=1').get(email)) await sendToken(email, 'reset');
}
export async function redeem(token: string, purpose: 'verify' | 'reset', password?: string) {
  const database = emailDb();
  const row = database.prepare('SELECT email FROM email_tokens WHERE hash=? AND purpose=? AND expires>?').get(hash(token), purpose, Date.now()) as { email: string } | undefined;
  if (!row) throw new Error('链接无效、已使用或过期。');
  const digest = purpose === 'reset' ? await passwordHash(password!) : null;
  database.exec('BEGIN IMMEDIATE');
  try {
    if (!database.prepare('DELETE FROM email_tokens WHERE hash=? AND expires>?').run(hash(token), Date.now()).changes) throw new Error('链接已使用或过期。');
    if (digest) {
      database.prepare('UPDATE email_accounts SET password=? WHERE email=?').run(digest, row.email);
      database.prepare('DELETE FROM login_sessions WHERE owner=(SELECT owner FROM email_accounts WHERE email=?)').run(row.email);
    } else database.prepare('UPDATE email_accounts SET verified=1 WHERE email=?').run(row.email);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
