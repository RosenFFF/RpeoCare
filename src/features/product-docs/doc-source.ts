import { readFileSync } from 'node:fs';
import path from 'node:path';
import { docChapters, docGroups, docHref, uniqueId, type DocChapter } from './catalog';

export interface DocHeading { id: string; title: string; depth: 2 | 3 }
export interface DocSearchEntry { href: string; chapter: string; group: string; heading: string; text: string }
export interface ParsedDoc { title: string; lead: string; body: string; headings: DocHeading[]; minutes: number }

/** Only catalog-owned filenames are read; route input never becomes a file path. */
export function readChapterSource(chapter: DocChapter) {
  return readFileSync(path.join(process.cwd(), 'docs', 'product', chapter.file), 'utf8').replace(/\r\n?/g, '\n');
}

/** Removes Markdown syntax so headings and search snippets read as plain text. */
export function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?/g, ' '))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, '')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\|?\s*:?-{3,}.*$/gm, '')
    .replace(/\*\*|`|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mirrors the text remark sees for a heading: link text kept, code and strong markers dropped. */
export function headingText(line: string) {
  return line.replace(/^#{2,3}\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|`/g, '').trim();
}

/** Splits a chapter into the H1 title, the opening paragraph and the remaining body. */
export function parseDoc(source: string): ParsedDoc {
  const lines = source.split('\n');
  const titleIndex = lines.findIndex(line => /^#\s+/.test(line));
  const title = titleIndex >= 0 ? lines[titleIndex].replace(/^#\s+/, '').trim() : '';
  let cursor = titleIndex + 1;
  while (cursor < lines.length && !lines[cursor].trim()) cursor++;
  const leadLines: string[] = [];
  if (cursor < lines.length && !/^(?:#|>|[-*+]\s|\d+\.\s|\||```)/.test(lines[cursor])) {
    while (cursor < lines.length && lines[cursor].trim()) leadLines.push(lines[cursor++]);
  }
  const body = lines.slice(cursor).join('\n').trim();
  const used = new Map<string, number>();
  const headings: DocHeading[] = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = headingText(line);
    headings.push({ id: uniqueId(text, used), title: text, depth: match[1].length as 2 | 3 });
  }
  const text = plainText(source);
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_-]+/g) ?? []).length;
  return { title, lead: leadLines.join('\n'), body, headings, minutes: Math.max(1, Math.round(cjk / 420 + words / 220)) };
}

/** One entry per chapter intro and per H2/H3 section, with plain text for matching and snippets. */
export function buildSearchIndex(): DocSearchEntry[] {
  return docChapters.flatMap(chapter => {
    const parsed = parseDoc(readChapterSource(chapter));
    const href = docHref(chapter.slug);
    const entries: DocSearchEntry[] = [];
    const used = new Map<string, number>();
    let heading = '', id = '', buffer: string[] = [parsed.lead];
    let fenced = false;
    const flush = () => {
      const text = plainText(buffer.join('\n')).slice(0, 1600);
      if (heading || text) entries.push({ href: id ? `${href}#${id}` : href, chapter: chapter.title, group: groupTitle(chapter), heading: heading || chapter.title, text });
    };
    for (const line of parsed.body.split('\n')) {
      if (/^```/.test(line)) fenced = !fenced;
      if (!fenced && /^#{2,3}\s+/.test(line)) {
        flush();
        heading = headingText(line); id = uniqueId(heading, used); buffer = [];
      } else buffer.push(line);
    }
    flush();
    return entries;
  });
}

function groupTitle(chapter: DocChapter) { return docGroups.find(group => group.id === chapter.group)?.title ?? ''; }
