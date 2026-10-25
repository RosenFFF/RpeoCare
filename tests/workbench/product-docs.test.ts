import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chapterByFile, docAsset, docChapters, docLink } from '../../src/features/product-docs/catalog';
import { buildSearchIndex, parseDoc, readChapterSource } from '../../src/features/product-docs/doc-source';
import { remarkDocs } from '../../src/features/product-docs/remark-docs';

const docsDir = path.join(process.cwd(), 'docs', 'product');
const parsed = new Map(docChapters.map(chapter => [chapter.file, parseDoc(readChapterSource(chapter))]));
const linksIn = (source: string) => [...source.replace(/```[\s\S]*?```/g, '').matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => ({ image: match[1] === '!', href: match[2] }));

test('every catalog chapter has a Markdown file and every Markdown file is in the catalog', () => {
  const files = readdirSync(docsDir).filter(file => file.endsWith('.md'));
  assert.deepEqual([...files].sort(), docChapters.map(chapter => chapter.file).sort());
  assert.equal(new Set(docChapters.map(chapter => chapter.slug)).size, docChapters.length);
  for (const [file, doc] of parsed) {
    assert.ok(doc.title, `${file} needs an H1 title`);
    assert.ok(doc.lead, `${file} needs an opening paragraph`);
  }
});

test('internal links point at existing chapters and headings', () => {
  for (const [file, doc] of parsed) {
    for (const { image, href } of linksIn(readChapterSource(chapterByFile(file)!))) {
      if (/^https?:/.test(href)) continue;
      if (image) { assert.ok(existsSync(path.join(process.cwd(), 'public', docAsset(href))), `${file}: missing image ${href}`); continue; }
      const destination = docLink(href);
      if (destination.startsWith('https://github.com/')) { assert.ok(existsSync(path.join(process.cwd(), 'docs', href.slice(3).split('#')[0])), `${file}: missing ${href}`); continue; }
      const [target, anchor] = href.split('#');
      const targetDoc = target ? parsed.get(target) : doc;
      assert.ok(targetDoc, `${file}: unknown chapter ${href}`);
      if (anchor) assert.ok(targetDoc!.headings.some(heading => heading.id === decodeURIComponent(anchor)), `${file}: unknown anchor ${href}`);
    }
  }
});

test('the search index covers every chapter with linkable sections', () => {
  const index = buildSearchIndex();
  for (const chapter of docChapters) assert.ok(index.some(entry => entry.chapter === chapter.title), `${chapter.title} is not searchable`);
  for (const entry of index) {
    const [page, anchor] = entry.href.split('#');
    const chapter = docChapters.find(item => (item.slug ? `/docs/${item.slug}` : '/docs') === page)!;
    if (anchor) assert.ok(parsed.get(chapter.file)!.headings.some(heading => heading.id === anchor), `${entry.href} has no heading`);
  }
});

test('GitHub alerts become callouts and headings get the outline ids', () => {
  const tree = { type: 'root', children: [
    { type: 'heading', depth: 2, children: [{ type: 'text', value: '发起 ' }, { type: 'inlineCode', value: 'AI' }, { type: 'text', value: ' 审查' }] },
    { type: 'heading', depth: 2, children: [{ type: 'text', value: '发起 AI 审查' }] },
    { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[!WARNING]\n先备份。' }] }] },
    { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: '普通引用' }] }] },
  ] };
  remarkDocs()(tree);
  const [first, second, alert, quote] = tree.children as { data?: { hName?: string; hProperties?: Record<string, unknown> }; children?: { children?: { value?: string }[] }[] }[];
  assert.equal(first.data?.hProperties?.id, '发起-ai-审查');
  assert.equal(second.data?.hProperties?.id, '发起-ai-审查-1');
  assert.equal(alert.data?.hName, 'aside');
  assert.equal(alert.data?.hProperties?.['data-callout'], 'warning');
  assert.equal(alert.children?.[0].children?.[0].value, '先备份。');
  assert.equal(quote.data, undefined);
});
