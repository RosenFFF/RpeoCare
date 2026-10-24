'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, GitBranch, LoaderCircle, RefreshCw, Search, ShieldCheck, Star } from 'lucide-react';
import type { BranchDirectory, RepositoryBranch } from '@/contracts/branches';
import './pull-branch-atlas.css';

export type PullBranchScope = {
  repoUrl: string;
  selected: string | null;
  onSelect: (branch: string | null) => void;
  hasNext: boolean;
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Reads the real branch directory, opens the default branch automatically and
 * offers a compact, searchable switcher instead of a separate branch page.
 */
export function PullBranchAtlas({ scope, busy, hidden, focusHost }: { scope: PullBranchScope; busy: boolean; hidden: boolean; focusHost?: HTMLDivElement | null }) {
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const loadedRevision = useRef(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  async function read(nextPage: number, signal: AbortSignal) {
    const params = new URLSearchParams({ repoUrl: scope.repoUrl, page: String(nextPage) });
    const response = await fetch(`/api/workbench/branches?${params}`, { signal, cache: 'no-store' });
    const body = await response.json() as BranchDirectory & { error?: string };
    if (!response.ok) throw new Error(body.error || '分支目录暂时无法读取。');
    if (body.repoUrl !== scope.repoUrl || body.page !== nextPage) throw new Error('项目已变化，请重新读取分支。');
    return body;
  }

  useEffect(() => {
    if (hidden || loadedRevision.current === revision) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    void read(1, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      loadedRevision.current = revision;
      setBranches(value.branches); setDefaultBranch(value.defaultBranch); setHasNext(value.hasNext); setPage(1);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '分支目录读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // The owning inbox is keyed by repository. Hide cancels in-flight reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.repoUrl, revision, hidden]);

  // Most PRs target the default branch, so open it directly instead of asking first.
  useEffect(() => {
    if (scope.selected !== null || !page) return;
    const target = defaultBranch ?? branches[0]?.name;
    if (target) scope.onSelect(target);
  }, [scope, page, defaultBranch, branches]);

  async function more() {
    if (loading || !hasNext || page >= 100) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setLoading(true); setError('');
    try {
      const value = await read(page + 1, controller.signal);
      if (controller.signal.aborted) return;
      setBranches(current => [...new Map([...current, ...value.branches].map(branch => [branch.name, branch])).values()]);
      setPage(value.page); setHasNext(value.hasNext);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '更多分支读取失败。'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => { if (hidden) { request.current?.abort(); setLoading(false); setOpen(false); } }, [hidden]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); };
  }, [open]);

  const visible = useMemo(() => branches.filter(branch => branch.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) =>
    Number(b.name === defaultBranch) - Number(a.name === defaultBranch) || Number(b.protected) - Number(a.protected) || collator.compare(a.name, b.name)), [branches, query, defaultBranch]);

  function choose(name: string) {
    setOpen(false); setQuery('');
    if (name !== scope.selected) scope.onSelect(name);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  if (scope.selected === null) return <div className="branch-atlas branch-atlas-status" role={error ? 'alert' : 'status'}>
    {error ? <><p><GitBranch size={18} aria-hidden="true" />{error}</p><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={14} aria-hidden="true" />重新读取分支</button></>
      : page && !branches.length && !defaultBranch ? <p><GitBranch size={18} aria-hidden="true" />仓库尚未返回分支，空仓库可能还没有第一个提交。</p>
      : <p><LoaderCircle className="branch-spin" size={18} aria-hidden="true" />正在读取分支并打开默认分支的 PR…</p>}
  </div>;

  const current = branches.find(branch => branch.name === scope.selected);
  const switcher = <div className="branch-switcher" ref={root} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
    <span className="branch-switcher-label">目标分支</span>
    <button type="button" ref={trigger} className="branch-switcher-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`目标分支 ${scope.selected}，切换分支`} disabled={busy} onClick={() => setOpen(value => !value)}>
      <GitBranch size={14} aria-hidden="true" /><strong title={scope.selected}>{scope.selected}</strong>
      {scope.selected === defaultBranch && <span className="branch-tag is-default">默认</span>}
      {current?.protected && <ShieldCheck size={13} aria-hidden="true" className="branch-protected" />}
      <ChevronDown size={14} aria-hidden="true" className="branch-chevron" />
    </button>
    {open && <div className="branch-popover" role="dialog" aria-label="切换目标分支">
      <label className="branch-search"><Search size={14} aria-hidden="true" /><input ref={search} aria-label="搜索已加载的分支" placeholder={`搜索 ${branches.length} 个已加载分支…`} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="branch-options">
        {visible.map(branch => <button type="button" key={branch.name} className={branch.name === scope.selected ? 'is-current' : undefined} aria-current={branch.name === scope.selected ? 'true' : undefined} aria-label={`切换到 ${branch.name} 分支${branch.name === defaultBranch ? '，默认分支' : ''}${branch.protected ? '，受保护' : ''}`} onClick={() => choose(branch.name)}>
          {branch.name === scope.selected ? <Check size={14} aria-hidden="true" className="branch-check" /> : branch.name === defaultBranch ? <Star size={13} aria-hidden="true" className="branch-star" /> : <GitBranch size={13} aria-hidden="true" />}
          <span title={branch.name}>{branch.name}</span>
          {branch.name === defaultBranch && <em className="branch-tag is-default">默认</em>}
          {branch.protected && <ShieldCheck size={12} aria-hidden="true" className="branch-protected" />}
          <code>{branch.commitSha?.slice(0, 7) ?? '—'}</code>
        </button>)}
        {!visible.length && <p className="branch-options-empty">{query && hasNext ? '已加载分支中没有匹配项，可继续加载后再搜索。' : '没有匹配的分支。'}</p>}
      </div>
      <footer><span>{hasNext ? `已加载 ${branches.length} 个` : `共 ${branches.length} 个分支`}</span>
        {hasNext && <button type="button" disabled={loading || page >= 100} onClick={() => void more()}>{loading ? <LoaderCircle size={13} className="branch-spin" aria-hidden="true" /> : null}{page >= 100 ? '已到读取上限' : '继续加载'}</button>}
        <button type="button" aria-label="刷新分支目录" title="刷新分支目录" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} aria-hidden="true" className={loading ? 'branch-spin' : undefined} /></button>
      </footer>
      {error && <p className="branch-options-error" role="alert">{error}{branches.length > 0 && ' 当前保留上次读取的目录。'}</p>}
    </div>}
  </div>;
  return focusHost ? createPortal(switcher, focusHost) : <div className="branch-atlas branch-atlas-inline">{switcher}</div>;
}
