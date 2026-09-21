import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function masterKey(): Buffer {
  const configured = process.env.REPOCARE_MASTER_KEY?.trim();
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error('REPOCARE_MASTER_KEY 必须为 64 位十六进制字符。');
    return Buffer.from(configured, 'hex');
  }
  const file = join(dirname(resolve(/* turbopackIgnore: true */ process.env.REPOCARE_DB_PATH || 'data/repocare.sqlite')), '.model-key');
  mkdirSync(dirname(file), { recursive: true });
  try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('无法创建本地模型主密钥。'); }
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error('本地模型主密钥无效。');
  return key;
}

export function encryptSecret(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(value: string, context: string): string {
  try {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new Error('无法解密模型配置，请检查服务端主密钥。'); }
}
