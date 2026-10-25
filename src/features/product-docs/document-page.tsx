import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, ChevronRight, Clock, ExternalLink, ListTree } from 'lucide-react';
import { BrandMark } from '@/shared/components/brand-mark';
import { docAsset, docChapters, docGroups, docHref, docLink, docSourceUrl, type DocChapter } from './catalog';
import { parseDoc, readChapterSource } from './doc-source';
import { remarkDocs, type CalloutKind } from './remark-docs';
import { CopyButton, DocSearch, DocThemeToggle, DocToc, MobileNav, SearchTrigger } from './doc-client';
import { callouts, ChapterIcon } from './doc-icons';
import './product-docs.css';

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const hastText = (node?: HastNode): string => node ? node.value ?? (node.children ?? []).map(hastText).join('') : '';
const languageNames: Record<string, string> = { sh: '终端', bash: '终端', shell: '终端', powershell: 'PowerShell', ps1: 'PowerShell', json: 'JSON', env: '环境变量', ini: '配置', text: '文本', md: 'Markdown', python: 'Python', ts: 'TypeScript' };

function isInternal(href: string) { return href.startsWith('/') || href.startsWith('#'); }

const components: Components = {
  a: ({ href = '', children }) => {
    const destination = docLink(href);
    if (destination.startsWith('/docs')) return <Link href={destination}>{children}</Link>;
    if (isInternal(destination)) return <a href={destination}>{children}</a>;
    return <a href={destination} target="_blank" rel="noreferrer" className="pd-external">{children}<ExternalLink size={12} aria-hidden="true" /><span className="pd-sr-only">（在新窗口打开）</span></a>;
  },
  h2: ({ id, children }) => <h2 id={id}>{children}<a className="pd-anchor" href={`#${id}`} aria-hidden="true" tabIndex={-1}>#</a></h2>,
  h3: ({ id, children }) => <h3 id={id}>{children}<a className="pd-anchor" href={`#${id}`} aria-hidden="true" tabIndex={-1}>#</a></h3>,
  // Procedures split by a table or callout continue numbering; CSS counters need the start value explicitly.
  ol: ({ start, children }) => <ol start={start} style={start && start > 1 ? { counterReset: `pd-step ${start - 1}` } : undefined}>{children}</ol>,
  table: ({ children }) => <div className="pd-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  pre: ({ node, children }) => {
    const code = (node as HastNode | undefined)?.children?.find(child => child.tagName === 'code');
    const className = code?.properties?.className;
    const language = (Array.isArray(className) ? className : []).map(String).find(name => name.startsWith('language-'))?.slice(9) ?? '';
    return <div className="pd-code"><div className="pd-code-bar"><span>{languageNames[language] ?? (language || '代码')}</span><CopyButton text={hastText(code).replace(/\n$/, '')} /></div><pre>{children}</pre></div>;
  },
  aside: ({ node, children }) => {
    // remark hProperties reach hast unnormalised, so the attribute keeps its dashed name.
    const properties = (node as HastNode | undefined)?.properties;
    const kind = (properties?.['data-callout'] ?? properties?.dataCallout) as CalloutKind | undefined;
    if (!kind || !callouts[kind]) return <aside>{children}</aside>;
    const { label, Icon } = callouts[kind];
    return <aside className={`pd-callout is-${kind}`} role="note" aria-label={label}><p className="pd-callout-title"><Icon size={16} aria-hidden="true" />{label}</p><div className="pd-callout-body">{children}</div></aside>;
  },
  img: ({ src, alt, title }) => <span className="pd-figure">
    {/* Markdown images are static repository files with unknown dimensions. */}
    <img src={docAsset(String(src ?? ''))} alt={alt ?? ''} loading="lazy" decoding="async" />
    {title && <span className="pd-figure-caption">{title}</span>}
  </span>,
};

function MarkdownBlock({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm, remarkDocs]} skipHtml components={components}>{children}</Markdown>;
}

function groupOf(chapter: DocChapter) { return docGroups.find(group => group.id === chapter.group)!; }

function DocNav({ current }: { current: string }) {
  return <nav className="pd-nav" aria-label="文档章节">
    {docGroups.map(group => <div className="pd-nav-group" key={group.id}>
      <p>{group.title}</p>
      <ul>{docChapters.filter(chapter => chapter.group === group.id).map(chapter => <li key={chapter.slug}>
        <Link href={docHref(chapter.slug)} aria-current={chapter.slug === current ? 'page' : undefined}><ChapterIcon icon={chapter.icon} size={16} /><span>{chapter.nav ?? chapter.title}</span></Link>
      </li>)}</ul>
    </div>)}
  </nav>;
}

function ChapterCard({ chapter, tone }: { chapter: DocChapter; tone?: 'large' }) {
  return <Link href={docHref(chapter.slug)} className={`pd-card${tone ? ` is-${tone}` : ''}`}>
    <span className="pd-card-icon"><ChapterIcon icon={chapter.icon} size={tone ? 20 : 18} /></span>
    <span className="pd-card-text"><strong>{chapter.title}</strong><span>{chapter.description}</span></span>
    <ArrowRight size={16} aria-hidden="true" className="pd-card-arrow" />
  </Link>;
}

const bySlug = (slug: string) => docChapters.find(chapter => chapter.slug === slug)!;
const guideChapters = () => docChapters.filter(chapter => chapter.group === 'guides' && chapter.slug !== 'modules');

function DocsHome({ title, lead }: { title: string; lead: string }) {
  const topics = [['模型连接', 'settings#配置模型连接'], ['关注矩阵', 'issues#关注矩阵'], ['审查航道', 'pull-requests#审查航道'], ['隔离验证', 'deployment#启用隔离执行'], ['发布草稿', 'drafts#确认交付'], ['结果待确认', 'troubleshooting#草稿无法保存或发布']];
  return <>
    <section className="pd-hero" aria-labelledby="pd-hero-title">
      <p className="pd-eyebrow">RepoCare 产品文档</p>
      <h1 id="pd-hero-title">{title}</h1>
      <div className="pd-hero-lead"><MarkdownBlock>{lead}</MarkdownBlock></div>
      <SearchTrigger variant="hero" />
      <p className="pd-hero-topics"><span>常用主题</span>{topics.map(([label, target]) => <Link key={label} href={`/docs/${target}`}>{label}</Link>)}</p>
    </section>
    <section className="pd-home-section" aria-labelledby="pd-start-title">
      <h2 id="pd-start-title" className="pd-section-title">从这里开始</h2>
      <div className="pd-card-grid is-three">{['quickstart', 'concepts', 'modules'].map(slug => <ChapterCard key={slug} chapter={bySlug(slug)} tone="large" />)}</div>
    </section>
    <section className="pd-home-section" aria-labelledby="pd-guides-title">
      <h2 id="pd-guides-title" className="pd-section-title">按功能浏览</h2>
      <div className="pd-card-grid">{guideChapters().map(chapter => <ChapterCard key={chapter.slug} chapter={chapter} />)}</div>
    </section>
    <section className="pd-home-section" aria-labelledby="pd-more-title">
      <h2 id="pd-more-title" className="pd-section-title">实践、部署与参考</h2>
      <div className="pd-card-grid">{docChapters.filter(chapter => ['practice', 'admin', 'reference'].includes(chapter.group)).map(chapter => <ChapterCard key={chapter.slug} chapter={chapter} />)}</div>
    </section>
  </>;
}

function ChapterHeader({ chapter, title, lead, minutes, sections }: { chapter: DocChapter; title: string; lead: string; minutes: number; sections: number }) {
  return <header className="pd-page-header">
    <nav aria-label="当前位置" className="pd-breadcrumb"><Link href="/docs">使用手册</Link><ChevronRight size={14} aria-hidden="true" /><span>{groupOf(chapter).title}</span></nav>
    <div className="pd-page-title"><span className="pd-page-icon"><ChapterIcon icon={chapter.icon} size={22} /></span><h1>{title}</h1></div>
    {lead && <div className="pd-lead"><MarkdownBlock>{lead}</MarkdownBlock></div>}
    <p className="pd-page-meta"><span><Clock size={14} aria-hidden="true" />阅读约 {minutes} 分钟</span>{sections > 0 && <span><ListTree size={14} aria-hidden="true" />{sections} 个小节</span>}</p>
  </header>;
}

export async function DocumentPage({ slug = '' }: { slug?: string }) {
  const position = docChapters.findIndex(item => item.slug === slug);
  const chapter = docChapters[position];
  if (!chapter) notFound();
  const doc = parseDoc(readChapterSource(chapter));
  const previous = docChapters[position - 1];
  const next = docChapters[position + 1];
  const sections = doc.headings.filter(heading => heading.depth === 2).length;
  const suggestions = ['quickstart', 'issues', 'pull-requests', 'settings', 'troubleshooting'].map(bySlug).map(item => ({ href: docHref(item.slug), title: item.title, description: item.description }));

  return <div className="product-docs">
    <a className="pd-skip" href="#doc-content">跳到正文</a>
    <header className="pd-header">
      <div className="pd-header-inner">
        <Link href="/docs" className="pd-brand" aria-label="RepoCare 使用手册首页"><BrandMark size={26} /><span>RepoCare</span><em>使用手册</em></Link>
        <SearchTrigger variant="header" />
        <nav className="pd-header-links" aria-label="站点导航"><Link href="/" className="pd-header-link">产品首页</Link><DocThemeToggle /><Link href="/workspace" className="pd-return">进入工作台<ArrowRight size={15} aria-hidden="true" /></Link></nav>
      </div>
    </header>
    <DocSearch suggestions={suggestions} />
    <div className="pd-layout">
      <aside className="pd-sidebar"><DocNav current={slug} /></aside>
      <MobileNav current={chapter.nav ?? chapter.title}><DocNav current={slug} /></MobileNav>
      <main id="doc-content" className="pd-main" tabIndex={-1}>
        {slug ? <ChapterHeader chapter={chapter} title={doc.title || chapter.title} lead={doc.lead} minutes={doc.minutes} sections={sections} /> : <DocsHome title={doc.title || chapter.title} lead={doc.lead} />}
        <article className="pd-prose"><MarkdownBlock>{doc.body}</MarkdownBlock></article>
        {slug === 'modules' && <div className="pd-card-grid is-inline">{guideChapters().map(item => <ChapterCard key={item.slug} chapter={item} />)}</div>}
        <nav className="pd-pager" aria-label="相邻章节">
          {previous ? <Link href={docHref(previous.slug)} className="pd-pager-link"><span><ArrowLeft size={14} aria-hidden="true" />上一页</span><strong>{previous.nav ?? previous.title}</strong></Link> : <span />}
          {next ? <Link href={docHref(next.slug)} className="pd-pager-link is-next"><span>下一页<ArrowRight size={14} aria-hidden="true" /></span><strong>{next.title}</strong></Link> : <span />}
        </nav>
        <footer className="pd-footer"><span>RepoCare 使用手册 · 文档与代码一同维护</span><a href={`${docSourceUrl}${chapter.file}`} target="_blank" rel="noreferrer">查看本页 Markdown 源文件<ExternalLink size={12} aria-hidden="true" /></a></footer>
      </main>
      <aside className="pd-toc">{doc.headings.length > 0 && <DocToc headings={doc.headings} editHref={`${docSourceUrl.replace('/blob/', '/edit/')}${chapter.file}`} />}</aside>
    </div>
  </div>;
}
