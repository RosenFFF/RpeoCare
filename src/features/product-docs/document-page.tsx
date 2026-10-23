import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { docChapters, docHref, docLink, headingId } from './catalog';
import './product-docs.css';

export async function DocumentPage({ slug = '' }: { slug?: string }) {
  const index = docChapters.findIndex(item => item.slug === slug);
  const chapter = docChapters[index];
  if (!chapter) notFound();
  // Only catalog-owned filenames are read; route input never becomes a file path.
  const source = await readFile(path.join(process.cwd(), 'docs', 'product', chapter.file), 'utf8');
  const sections = [...source.matchAll(/^## (.+)$/gm)].map(match => ({ title: match[1], id: headingId(match[1]) }));
  const previous = docChapters[index - 1];
  const next = docChapters[index + 1];

  return <div className="product-docs">
    <a className="pd-skip" href="#doc-content">跳到正文</a>
    <header className="pd-header"><Link href="/docs" className="pd-brand">RepoCare <span>产品文档</span></Link><Link href="/workspace" className="pd-return">返回工作区</Link></header>
    <div className="pd-layout">
      <nav className="pd-chapters" aria-label="文档章节">
        <p>使用手册</p>
        {docChapters.map(item => <Link key={item.slug} href={docHref(item.slug)} aria-current={item.slug === slug ? 'page' : undefined}>{item.title}</Link>)}
        <small>先阅读，再实践。<br/>每一次交付，由你确认。</small>
      </nav>
      <main id="doc-content" className="pd-main" tabIndex={-1}>
        <article className="pd-prose">
          <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
            a: ({ href = '', children }) => {
              const destination = docLink(href);
              return destination.startsWith('/docs') ? <Link href={destination}>{children}</Link> : <a href={destination}>{children}</a>;
            },
            h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
            table: ({ children }) => <div className="pd-table" tabIndex={0} role="region" aria-label="参考表格，可横向滚动"><table>{children}</table></div>,
          }}>{source}</Markdown>
        </article>
        <nav className="pd-pagination" aria-label="相邻章节">
          {previous ? <Link href={docHref(previous.slug)}><span>上一章</span>{previous.title}</Link> : <span/>}
          {next && <Link href={docHref(next.slug)}><span>下一章</span>{next.title}</Link>}
        </nav>
        <footer className="pd-footer">RepoCare 使用手册 · <a href="https://github.com/RosenFFF/RpeoCare/tree/main/docs/product">查看 Markdown 源文档</a></footer>
      </main>
      <aside className="pd-toc"><nav aria-label="本页目录"><p>本页内容</p>{sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav></aside>
    </div>
  </div>;
}
