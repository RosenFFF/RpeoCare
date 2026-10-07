import type { DraftQualityItem } from '../../contracts/workbench';

export interface DraftQualityContext { paths: string[]; pathsComplete: boolean; scripts: string[]; scriptsKnown: boolean }
export function inspectDraft(content: string, before: string, path: string | undefined, context?: DraftQualityContext): DraftQualityItem[] {
  const items: DraftQualityItem[] = [];
  if (!content.trim()) items.push({ code: 'empty', level: 'blocker', message: '内容不能为空。' });
  if (content.length > 30000) items.push({ code: 'size', level: 'blocker', message: '内容超过 30,000 字符限制。' });
  if (/(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) items.push({ code: 'secret', level: 'blocker', message: '检测到疑似凭据或私钥，请删除并人工检查；不会展示匹配内容。' });
  if (/\bTODO\b|\bTBD\b|待(?:填写|确认|补充)|<YOUR[_ -]|YOUR_API_KEY|example\.com/i.test(content)) items.push({ code: 'placeholder', level: 'warning', message: '存在占位符或待确认内容，发布前请检查。' });
  const links = [...content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)].slice(0, 100);
  let external = false;
  for (const [, raw] of links) {
    if (/^(?:javascript|data|vbscript):/i.test(raw)) { items.push({ code: 'unsafe-link', level: 'blocker', message: '存在不安全的链接协议。' }); continue; }
    if (/^(?:https?:|mailto:|\/\/)/i.test(raw)) { external = true; continue; }
    if (raw.startsWith('#')) continue;
    let value: string;
    try { value = decodeURIComponent(raw.split('#')[0].split('?')[0]); } catch { items.push({ code: 'link-encoding', level: 'warning', message: '链接编码无效。' }); continue; }
    const segments = value.startsWith('/') ? [] : (path || '').split('/').slice(0, -1);
    for (const segment of value.split('/')) { if (segment === '..') segments.pop(); else if (segment && segment !== '.') segments.push(segment); }
    const resolved = segments.join('/');
    if (context?.paths.includes(resolved)) continue;
    items.push({ code: 'relative-link', level: context?.pathsComplete ? 'warning' : 'info', message: context?.pathsComplete ? `快照中未找到链接目标：${resolved.slice(0, 160)}` : '快照不足，部分相对链接未验证。' });
  }
  if (external) items.push({ code: 'external-link', level: 'info', message: '外部链接未联网检查，不代表可访问。' });
  const commands = new Set([...content.matchAll(/\bnpm\s+run\s+([\w:-]+)|\bnpm\s+(test|start|build)\b/g)].map(match => match[1] || match[2]));
  for (const name of commands) if (!context?.scriptsKnown || !context.scripts.includes(name)) items.push({ code: 'command', level: context?.scriptsKnown ? 'warning' : 'info', message: context?.scriptsKnown ? `package.json 中未找到 npm 脚本：${name}` : `npm 脚本 ${name} 缺少完整配置依据。` });
  if (commands.size) items.push({ code: 'execution', level: 'info', message: '仅核对脚本配置，未执行任何命令或测试。' });
  const headings = before.split('\n').filter(line => /^#{1,6}\s+/.test(line)).map(line => line.trim());
  for (const heading of headings) if (!content.split('\n').some(line => line.trim() === heading)) items.push({ code: 'removed-heading', level: 'warning', message: `原有章节标题发生移除或改名：${heading.slice(0, 140)}` });
  if (/license|许可证|版权|copyright/i.test(before) && !/license|许可证|版权|copyright/i.test(content)) items.push({ code: 'license', level: 'warning', message: '原文许可证或版权说明可能被移除。' });
  if (before.length > 500 && content.length < before.length * .5) items.push({ code: 'shrunk', level: 'warning', message: '内容缩短超过一半，请检查是否丢失原有内容。' });
  return items.slice(0, 40);
}
