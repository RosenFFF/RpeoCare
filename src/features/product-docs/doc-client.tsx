'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, Check, Copy, CornerDownLeft, FileText, Hash, Menu, PencilLine, Search, X } from 'lucide-react';
import { ThemePicker } from '@/shared/components/theme-picker';
import { useAppearance } from '@/shared/lib/use-appearance';
import type { DocHeading, DocSearchEntry } from './doc-source';

const OPEN_EVENT = 'repocare-docs:search';

function useShortcutLabel() {
  const [label, setLabel] = useState('Ctrl K');
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform)) setLabel('⌘ K'); }, []);
  return label;
}

export function SearchTrigger({ variant }: { variant: 'header' | 'hero' }) {
  const shortcut = useShortcutLabel();
  return <button type="button" className={`pd-search-trigger is-${variant}`} aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
    <Search size={variant === 'hero' ? 18 : 15} aria-hidden="true" />
    <span>{variant === 'hero' ? '搜索功能、操作步骤或错误提示…' : '搜索文档…'}</span>
    <kbd aria-label={`快捷键 ${shortcut}`}>{shortcut}</kbd>
  </button>;
}

type Result = { entry: DocSearchEntry; score: number };

function runSearch(index: DocSearchEntry[], query: string): Result[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results: Result[] = [];
  for (const entry of index) {
    const heading = entry.heading.toLowerCase(), chapter = entry.chapter.toLowerCase(), text = entry.text.toLowerCase();
    let score = 0, matched = true;
    for (const term of terms) {
      const inHeading = heading.includes(term), inChapter = chapter.includes(term), inText = text.includes(term);
      if (!inHeading && !inChapter && !inText) { matched = false; break; }
      score += (inHeading ? 8 : 0) + (inChapter ? 3 : 0) + (inText ? 1 : 0);
    }
    if (matched) results.push({ entry, score: score + (heading === query.trim().toLowerCase() ? 12 : 0) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 40);
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig');
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function snippet(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  const hit = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 28);
  return `${start ? '…' : ''}${text.slice(start, start + 120)}${start + 120 < text.length ? '…' : ''}`;
}

/** Full-text search over the manual. The index is a static JSON file fetched the first time the dialog opens. */
export function DocSearch({ suggestions }: { suggestions: { href: string; title: string; description: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<DocSearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = () => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true); };
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); show(); }
      else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); show(); }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener('keydown', keys);
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener('keydown', keys); };
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open || index || failed) return;
    let cancelled = false;
    fetch('/docs/search-index').then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((data: DocSearchEntry[]) => { if (!cancelled) setIndex(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, index, failed]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => input.current?.focus(), 20);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(timer); document.body.style.overflow = overflow; returnFocus.current?.focus(); };
  }, [open]);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => index ? runSearch(index, query) : [], [index, query]);
  const items = query.trim() ? results.map(result => result.entry.href) : suggestions.map(item => item.href);

  function close() { setOpen(false); }
  function go(href: string) { setOpen(false); setQuery(''); router.push(href); }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      setActive(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && event.target === input.current && items[active]) { event.preventDefault(); go(items[active]); return; }
    if (event.key === 'Tab') {
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('input, button, a[href]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  useEffect(() => {
    document.getElementById(`pd-search-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const optionId = items.length ? `pd-search-option-${active}` : undefined;
  return <div className="pd-search-layer" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="pd-search-dialog" role="dialog" aria-modal="true" aria-label="搜索文档" ref={dialog} onKeyDown={onKeyDown}>
      <div className="pd-search-field">
        <Search size={18} aria-hidden="true" />
        <input ref={input} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} placeholder="输入关键词，例如“模型连接”“关注矩阵”“结果待确认”"
          role="combobox" aria-expanded={items.length > 0} aria-controls="pd-search-results" aria-activedescendant={optionId} aria-autocomplete="list" autoComplete="off" spellCheck={false} />
        <button type="button" className="pd-search-close" onClick={close} aria-label="关闭搜索"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="pd-search-body">
        {query.trim() ? !index ? <p className="pd-search-state" role="status">{failed ? '搜索索引读取失败，请刷新页面后重试。' : '正在载入搜索索引…'}</p>
          : results.length ? <>
            <p className="pd-search-count" role="status">找到 {results.length} 个相关段落</p>
            <ul id="pd-search-results" role="listbox" aria-label="搜索结果">{results.map(({ entry }, position) => <li key={entry.href} role="presentation">
              <Link id={`pd-search-option-${position}`} role="option" aria-selected={position === active} href={entry.href} className="pd-search-result" onClick={() => setOpen(false)} onMouseMove={() => setActive(position)}>
                {entry.heading === entry.chapter ? <FileText size={16} aria-hidden="true" /> : <Hash size={16} aria-hidden="true" />}
                <span><small>{entry.group} › {entry.chapter}</small><strong><Highlight text={entry.heading} terms={terms} /></strong><span><Highlight text={snippet(entry.text, terms)} terms={terms} /></span></span>
                <CornerDownLeft size={14} aria-hidden="true" className="pd-search-enter" />
              </Link>
            </li>)}</ul>
          </> : <div className="pd-search-state" role="status"><strong>没有找到“{query.trim()}”</strong><span>换一个说法，或减少关键词。也可以从下方的常用页面开始。</span></div>
          : <>
            <p className="pd-search-count">常用页面</p>
            <ul id="pd-search-results" role="listbox" aria-label="常用页面">{suggestions.map((item, position) => <li key={item.href} role="presentation">
              <Link id={`pd-search-option-${position}`} role="option" aria-selected={position === active} href={item.href} className="pd-search-result" onClick={() => setOpen(false)} onMouseMove={() => setActive(position)}>
                <FileText size={16} aria-hidden="true" /><span><strong>{item.title}</strong><span>{item.description}</span></span><CornerDownLeft size={14} aria-hidden="true" className="pd-search-enter" />
              </Link>
            </li>)}</ul>
          </>}
      </div>
      <footer className="pd-search-help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
    </div>
  </div>;
}

/** Page outline with the section currently being read highlighted. */
export function DocToc({ headings, editHref }: { headings: DocHeading[]; editHref: string }) {
  const [active, setActive] = useState(headings[0]?.id ?? '');
  useEffect(() => {
    const elements = headings.map(item => document.getElementById(item.id)).filter((element): element is HTMLElement => !!element);
    if (!elements.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = elements[0].id;
      for (const element of elements) { if (element.getBoundingClientRect().top <= 112) current = element.id; else break; }
      setActive(atBottom ? elements[elements.length - 1].id : current);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); if (frame) window.cancelAnimationFrame(frame); };
  }, [headings]);

  return <nav className="pd-toc-nav" aria-label="本页目录">
    <p>本页内容</p>
    <ul>{headings.map(item => <li key={item.id} className={item.depth === 3 ? 'is-sub' : undefined}>
      <a href={`#${item.id}`} aria-current={active === item.id ? 'location' : undefined}>{item.title}</a>
    </li>)}</ul>
    <div className="pd-toc-actions">
      <a href={editHref} target="_blank" rel="noreferrer"><PencilLine size={14} aria-hidden="true" />在 GitHub 编辑此页</a>
      <button type="button" onClick={() => { window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); document.getElementById('doc-content')?.focus({ preventScroll: true }); }}><ArrowUp size={14} aria-hidden="true" />回到顶部</button>
    </div>
  </nav>;
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState('done'); }
    catch { setState('failed'); }
  }
  return <button type="button" className={`pd-copy${state === 'done' ? ' is-done' : ''}`} onClick={copy}>
    {state === 'done' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    <span aria-live="polite">{state === 'done' ? '已复制' : state === 'failed' ? '复制失败' : '复制'}</span>
  </button>;
}

/** Narrow screens fold the chapter list behind a disclosure that closes after navigation. */
export function MobileNav({ current, children }: { current: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { if (details.current) details.current.open = false; }, [pathname]);
  return <details className="pd-mobile-nav" ref={details}>
    <summary><Menu size={16} aria-hidden="true" /><span>文档目录</span><b>{current}</b></summary>
    <div className="pd-mobile-nav-panel">{children}</div>
  </details>;
}

/** Same light/dark switch as the workspace; the choice is shared through browser storage. */
export function DocThemeToggle() {
  const { appearance, updateAppearance } = useAppearance();
  return <ThemePicker theme={appearance.theme} onChange={theme => updateAppearance({ theme })} />;
}
