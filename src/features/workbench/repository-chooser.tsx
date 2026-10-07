'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, GitFork, LockKeyhole, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { GithubRepositoryPage } from '@/contracts/repositories';
import { api, changed } from './client';
import './repository-chooser.css';

type GithubIdentity = { login: string; canWrite: boolean } | null;
const permissionLabels = { admin: '管理员', maintain: '维护', write: '写入', read: '读取', unknown: '未返回' };

export function RepositoryChooser({ github, currentProject, onConnected }: {
  github: GithubIdentity;
  currentProject?: string;
  onConnected: () => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<'account' | 'manual'>(github ? 'account' : 'manual');
  const [affiliation, setAffiliation] = useState<'owner' | 'all'>('owner');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [data, setData] = useState<GithubRepositoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [repoUrl, setRepoUrl] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    try { setRepoUrl(localStorage.getItem('openbridge.connection-draft') || ''); } catch { /* Storage is optional. */ }
  }, []);
  useEffect(() => {
    if (!github || tab !== 'account') return;
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setData(null);
    void fetch(`/api/workbench/repositories?page=${page}&affiliation=${affiliation}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || '无法读取仓库列表。');
        if (!controller.signal.aborted) { setData(value); setLoading(false); }
      }).catch(error => {
        if (!controller.signal.aborted) { setLoadError(error instanceof Error ? error.message : '无法读取仓库列表。'); setLoading(false); }
      });
    return () => controller.abort();
  }, [github?.login, Boolean(github), tab, page, affiliation, retry]);

  async function connect(url: string) {
    if (busy.current) return;
    busy.current = true; setConnecting(url); setConnectError('');
    try {
      await api('/api/workbench', { repoUrl: url });
      try { localStorage.setItem('openbridge.connection-draft', url); } catch { /* Storage is optional. */ }
      changed(); onConnected();
    } catch (error) { setConnectError(error instanceof Error ? error.message : '连接失败，请重试。'); }
    finally { busy.current = false; setConnecting(null); }
  }
  const repositories = (data?.repositories || []).filter(repo =>
    `${repo.fullName} ${repo.description}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (visibility === 'all' || (visibility === 'private' ? repo.private : !repo.private)));

  return <div className="repo-chooser">
    {currentProject && <p className="repo-current"><Check size={15} />当前项目 <strong>{currentProject}</strong></p>}
    <div className="repo-tabs" role="group" aria-label="项目连接方式">
      {github && <button type="button" aria-pressed={tab === 'account'} disabled={!!connecting} onClick={() => { setTab('account'); setConnectError(''); }}>GitHub 仓库</button>}
      <button type="button" aria-pressed={tab === 'manual'} disabled={!!connecting} onClick={() => { setTab('manual'); setConnectError(''); }}>粘贴仓库地址</button>
    </div>
    {tab === 'account' && github && <>
      <div className="repo-tools">
        <label className="repo-search" htmlFor={`${id}-search`}><Search size={16}/><input id={`${id}-search`} aria-label="搜索本页仓库" placeholder="搜索本页仓库名称或描述" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>仓库范围<select aria-label="仓库范围" value={affiliation} disabled={!!connecting} onChange={event => { setAffiliation(event.target.value as 'owner' | 'all'); setPage(1); }}><option value="owner">我的仓库</option><option value="all">我有权访问的仓库</option></select></label>
        <label>可见性<select aria-label="本页仓库可见性" value={visibility} onChange={event => setVisibility(event.target.value)}><option value="all">全部</option><option value="public">公开</option><option value="private">私有</option></select></label>
      </div>
      <p className="repo-scope">按最近更新排序，每页最多 30 个；搜索和可见性筛选仅作用于当前页，不是全账户搜索。</p>
      <div className="repo-list" aria-busy={loading}>
        {loading ? <p className="repo-state" role="status">正在读取 GitHub 仓库…</p> : loadError ? <div className="repo-state" role="alert"><p>{loadError}</p><button className="button button-secondary" type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15}/>重新读取</button></div> : repositories.length ? <ul aria-label="GitHub 仓库列表">{repositories.map(repo => <li key={repo.id}>
          <div className="repo-row-content"><h3>{repo.fullName}{repo.fullName === currentProject && <span className="repo-current-tag">当前项目</span>}</h3><div className="repo-badges"><span>{repo.private ? <><LockKeyhole size={12}/>私有</> : '公开'}</span>{repo.fork && <span><GitFork size={12}/>Fork</span>}{repo.archived && <span>已归档</span>}<span>{repo.owned ? '个人所有' : '协作 / 组织'}</span><span>仓库权限：{permissionLabels[repo.permission]}</span></div>{repo.description && <p>{repo.description}</p>}</div>
          <button className="button button-secondary" type="button" aria-label={`连接 ${repo.fullName}`} disabled={!!connecting} onClick={() => void connect(repo.url)}>{connecting === repo.url ? '正在连接…' : '连接'}<ArrowRight size={14}/></button>
        </li>)}</ul> : <div className="repo-state"><p>{data?.repositories.length ? '本页没有匹配的仓库。可清除筛选、翻页，或粘贴完整地址。' : '当前授权范围内没有找到仓库。可切换仓库范围，或粘贴完整地址。'}</p>{(query || visibility !== 'all') && <button className="button button-secondary" type="button" onClick={() => { setQuery(''); setVisibility('all'); }}>清除本页筛选</button>}</div>}
      </div>
      <div className="repo-pagination"><button type="button" className="button button-secondary" disabled={loading || !!connecting || page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span aria-live="polite">第 {page} 页</span><button type="button" className="button button-secondary" disabled={loading || !!connecting || !data?.hasMore} onClick={() => setPage(value => value + 1)}>下一页</button></div>
      <div className="repo-access"><ShieldCheck size={17}/><div><p>公开仓库无需追加写权限。列表中的仓库权限不代表已授权 RepoCare 发布。</p><p>{github.canWrite ? '已追加仓库授权；私有仓库仍受账户权限及组织访问策略限制。' : '普通登录仅显示当前授权可见的仓库。读取私有仓库需要额外授权，现有 OAuth 的 repo 范围同时包含写权限。'}</p>{!github.canWrite && <a href="/api/auth/github?write=1">需要私有仓库？追加 GitHub 仓库授权</a>}</div></div>
    </>}
    {tab === 'manual' && <form className="repo-manual" onSubmit={event => { event.preventDefault(); void connect(repoUrl.trim()); }}>
      <p>也可以连接其他公开项目，不必是你自己的仓库。</p>
      <label htmlFor={`${id}-url`}>GitHub 仓库地址</label><input id={`${id}-url`} type="url" required maxLength={300} disabled={!!connecting} value={repoUrl} onChange={event => { setRepoUrl(event.target.value); setConnectError(''); }} placeholder="https://github.com/owner/repo" aria-describedby={`${id}-hint`}/>
      <p id={`${id}-hint`} className="repo-scope">服务端会确认仓库是否可读取。私有仓库需要 GitHub 授权和实际访问权限。</p>
      <button className="button button-primary" type="submit" disabled={!!connecting}>{connecting ? '正在连接…' : '连接项目'}<ArrowRight size={15}/></button>
      {!github && <a className="repo-login" href="/api/auth/github">使用 GitHub 登录，从账户仓库中选择</a>}
    </form>}
    {connectError && <p className="repo-error" role="alert">{connectError}</p>}
    <p className="repo-footnote">仅保存当前项目，不自动体检、调用模型、执行代码或发布内容。连接后由你选择下一步。</p>
  </div>;
}
