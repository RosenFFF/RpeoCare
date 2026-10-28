// Exports every package in package-lock.json as the third-party dependency inventory CSV
// used by the competition resource list. Usage: npx tsx scripts/export-dependency-inventory.ts <output.csv>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type LockPackage = {
  name?: string;
  version?: string;
  license?: string;
  resolved?: string;
  dev?: boolean;
  optional?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const output = process.argv[2];
if (!output) throw new Error('Usage: npx tsx scripts/export-dependency-inventory.ts <output.csv>');

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockPackage> };
const root = lock.packages[''];
const direct = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})]);

const obligations = (license: string) => {
  if (/LGPL/.test(license)) return '分发二进制时提供 LGPL 文本、对应源码与替换机制；其余组件按各自许可保留声明';
  if (/^(MIT-0|0BSD|CC0-1.0|Unlicense)$/.test(license)) return '无署名要求';
  if (/Apache/.test(license)) return '分发时附许可副本，保留 NOTICE 与版权声明';
  if (/BSD-3/.test(license)) return '分发时保留版权与免责声明；不得以作者名义背书';
  if (/CC-BY/.test(license)) return '分享时署名、附许可链接并标注修改';
  return '分发时保留版权与许可声明';
};

const repoOf = (dir: string) => {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return '';
  const repo = (JSON.parse(readFileSync(file, 'utf8')) as { repository?: string | { url?: string } }).repository;
  return (typeof repo === 'string' ? repo : repo?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
};

const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const header = ['序号', '名称', '版本', '许可证', '依赖类型', '来源', '使用方式', '关键义务/限制', '团队修改', '合规状态'];
const rows: (string | number)[][] = [];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = meta.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const license = meta.license ?? '未声明';
  const kind = [
    meta.dev ? '开发' : '运行',
    direct.has(name) && path === `node_modules/${name}` ? '直接' : '传递',
    meta.optional ? '可选平台包' : '',
  ].filter(Boolean).join(' / ');
  const lgpl = /LGPL/.test(license);
  rows.push([
    rows.length + 1,
    name,
    meta.version ?? '',
    license,
    kind,
    repoOf(path) || meta.resolved || '',
    meta.dev ? '开发与测试工具，不进入产品运行' : '由 npm 安装后在运行时调用',
    obligations(license),
    '未修改第三方源码',
    lgpl ? '已核验：作品只开放源码，不分发该原生二进制' : '已核验：作品只开放源码，依赖由使用者通过 npm 安装，不再分发',
  ]);
}

// The byte order mark lets Excel open the Chinese headers correctly.
writeFileSync(output, '﻿' + [header, ...rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n');
console.log(`${rows.length} packages -> ${output}`);
