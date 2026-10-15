'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GitBranch, GitFork, LoaderCircle, RefreshCw, Search, Star } from 'lucide-react';
import type { BranchDirectory, RepositoryBranch } from '@/contracts/branches';
import { BranchOrbitField } from './branch-orbit-field';
import './pull-branch-atlas.css';

export type PullBranchScope = {
  repoUrl: string;
  selected: string | null;
  onSelect: (branch: string | null) => void;
  hasNext: boolean;
};

export function PullBranchAtlas({ scope, busy, hidden }: { scope: PullBranchScope; busy: boolean; hidden: boolean }) {
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [fieldActions, setFieldActions] = useState<HTMLDivElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const loadedRevision = useRef(-1);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusName = useRef<HTMLSpanElement>(null);
  const previousBranch = useRef(scope.selected);
  const gridScroll = useRef<{ top: number; left: number } | null>(null);

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
  useEffect(() => { if (hidden) { request.current?.abort(); setLoading(false); } }, [hidden]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (previousBranch.current === scope.selected) return;
    previousBranch.current = scope.selected;
    const frame = requestAnimationFrame(() => {
      (scope.selected === null ? heading.current : focusName.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scope.selected]);

  const visible = useMemo(() => branches.filter(branch => branch.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) =>
    Number(b.name === defaultBranch) - Number(a.name === defaultBranch) || Number(b.protected) - Number(a.protected) || a.name.localeCompare(b.name)), [branches, query, defaultBranch]);

  if (scope.selected !== null) return <header className="branch-focus-bar">
    <button type="button" className="branch-back" disabled={busy} onClick={() => scope.onSelect(null)}><ArrowLeft size={15} />全部分支</button>
    <span className="branch-focus-name" ref={focusName} tabIndex={-1}><GitBranch size={17} /><strong title={scope.selected}>{scope.selected}</strong>{scope.selected === defaultBranch && <span>默认</span>}</span>
    <span className="branch-focus-note">查看计划合入此分支的开放 PR</span>
  </header>;

  return <div className="branch-atlas">
    <header className="branch-atlas-toolbar"><div><GitFork size={17} aria-hidden="true" /><h2 ref={heading} tabIndex={-1}>分支导航</h2><span>{page ? `${hasNext ? '已加载 ' : '共 '}${branches.length} 个分支` : '仓库分支目录'}{query && ` · 匹配 ${visible.length} 个`}</span></div><div><label className="branch-search"><Search size={15} /><input aria-label="搜索已加载的分支" placeholder="搜索分支…" value={query} onChange={event => setQuery(event.target.value)} /></label>{defaultBranch&&!branches.some(branch=>branch.name===defaultBranch)&&<button className="branch-default-shortcut" type="button" disabled={busy||loading} onClick={()=>scope.onSelect(defaultBranch)}><Star size={12}/>默认分支 {defaultBranch}</button>}<div className="branch-field-actions" ref={setFieldActions} /><button type="button" className="branch-refresh" aria-label="刷新分支目录" title="刷新分支目录" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} className={loading ? 'branch-spin' : ''} /></button></div></header>
    {error && <div className="branch-directory-error" role="alert"><p>{error}{branches.length > 0 && ' 当前保留上次读取的目录。'}</p><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>重新读取目录</button></div>}
    {!page && loading ? <div className="branch-atlas-empty" role="status"><LoaderCircle className="branch-spin" size={23} /><strong>正在读取仓库分支</strong><p>包括暂时没有开放 PR 的分支。</p></div> : <>
      {visible.length > 0 && <BranchOrbitField branches={visible} defaultBranch={defaultBranch} disabled={busy || loading} active={!hidden} onSelect={name => scope.onSelect(name)} scrollMemory={gridScroll} actionsHost={fieldActions} />}
      {!visible.length && !loading && !error && <div className="branch-atlas-empty"><GitBranch size={25} /><strong>{query ? '已加载分支中没有匹配项' : '仓库尚未返回分支'}</strong><p>{query && hasNext ? '还有分支未读取，可继续加载后搜索。' : query ? '试试其他分支名称。' : '空仓库可能尚未创建第一个提交。'}</p></div>}
      {(hasNext || loading && page > 0) && <footer className="branch-atlas-footer">{hasNext && <button type="button" disabled={busy || loading || page >= 100} onClick={() => void more()}>{loading ? <LoaderCircle size={14} className="branch-spin" /> : <GitBranch size={14} />}{page >= 100 ? '已到目录读取上限，仍有分支未展示' : '继续加载分支（每次最多 100 个）'}</button>}{loading && page > 0 && <span role="status">正在更新目录…</span>}</footer>}
    </>}
  </div>;
}
