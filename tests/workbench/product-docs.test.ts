import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { docChapters, headingId, docLink, docHref } from '../../src/features/product-docs/catalog';

test('published manual has valid local links, unique headings and documented environment options', () => {
  const root = path.resolve('docs/product');
  for (const chapter of docChapters) {
    const source = readFileSync(path.join(root, chapter.file), 'utf8');
    const headings = [...source.matchAll(/^## (.+)$/gm)].map(match => headingId(match[1]));
    assert.equal(new Set(headings).size, headings.length, `${chapter.file}: duplicate anchor`);
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (href.startsWith('https://')) continue;
      assert.ok(existsSync(path.resolve(root, href.split('#')[0])), `${chapter.file}: missing ${href}`);
      assert.match(docLink(href), /^(\/docs|https:\/\/github\.com\/)/, 'Local Markdown links must resolve on the website');
    }
    assert.equal(docLink(chapter.file), docHref(chapter.slug));
  }
  const configuration = readFileSync(path.join(root, 'configuration.md'), 'utf8');
  const env = readFileSync('.env.example', 'utf8');
  for (const match of env.matchAll(/^([A-Z_]+)=/gm)) {
    assert.ok(configuration.includes(`\`${match[1]}\``), `Undocumented option: ${match[1]}`);
  }
});
