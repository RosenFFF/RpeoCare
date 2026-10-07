'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ArrowRight, Check, Download, FileText, GitPullRequest, MessageSquare, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { AuditReport } from '@/contracts/audit';
import type { Draft } from '@/contracts/workbench';
import { draftDiff } from '@/shared/lib/draft-diff';
import { inspectDraft, type DraftQualityContext } from '@/shared/lib/draft-quality';
import { api, changed, useWorkbench } from '../workbench/client';
import './draft-workspace.css';

type Buffer = { content: string; revision: number };
type Mode = 'edit' | 'preview' | 'diff';
const supportedChecks = ['readme', 'contributing', 'issue-template', 'pr-template', 'agent-readme-clarity', 'agent-contributing-clarity', 'agent-command-consistency'];
const kindLabels = { file: '文档改进', issue: 'Issue 回复', review: 'PR 评论' };
const statusLabels = { draft: '待审阅', publishing: '发布中', published: '已交付', uncertain: '待核对' };
const publishLabels = { file: '创建草稿 PR', issue: '发布 Issue 回复', review: '发布 PR 评论' };
const documentKey = (draft: Draft) => draft.path || `${draft.kind}:${draft.number}`;
const pathLabel = (draft: Draft) => draft.path || `${draft.kind === 'issue' ? 'Issue' : 'PR'} #${draft.number}`;
const cacheKey = (id: string) => `repocare.draft-buffer.${id}`;

export function DraftWorkspace() {
  const { data: workbench } = useWorkbench();
  const [drafts, setDrafts] = useState<Draft[]>([]), [report, setReport] = useState<AuditReport | null>(null);
  const [previousGeneration, setPreviousGeneration] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [compareRevision, setCompareRevision] = useState('original'), [showUnchanged, setShowUnchanged] = useState(false);
  const [mode, setMode] = useState<Mode>('diff'), [category, setCategory] = useState('all'), [status, setStatus] = useState('active'), [query, setQuery] = useState('');
  const [generationOpen, setGenerationOpen] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [versions, setVersions] = useState<Draft[]>([]), [context, setContext] = useState<DraftQualityContext>();
  const [batchQuality, setBatchQuality] = useState<Record<string, ReturnType<typeof inspectDraft>>>({});
  const [batch, setBatch] = useState<string[]>([]), [confirmation, setConfirmation] = useState<Draft[] | null>(null), [qualityAcknowledged, setQualityAcknowledged] = useState(false);
  const listRef = useRef<HTMLDivElement>(null), lastFocus = useRef<HTMLElement | null>(null), titleRef = useRef<HTMLHeadingElement>(null);
  const selected = drafts.find(draft => draft.id === selectedId && draft.repoUrl === workbench?.project?.repoUrl);
  const buffer = selected ? buffers[selected.id] : undefined;
  const content = selected ? buffer?.content ?? selected.content : '';
  const unsaved = Boolean(selected && content !== selected.content);
  const hasUnsaved = Object.entries(buffers).some(([id, value]) => !drafts.some(draft => draft.id === id && draft.content === value.content));
  const comparison = compareRevision === 'original' ? selected?.before || '' : compareRevision === 'previous' ? previousGeneration?.content || '' : versions.find(row => String(row.revision) === compareRevision)?.content ?? selected?.before ?? '';
  const diff = useMemo(() => draftDiff(comparison, content), [comparison, content]);
  const shownDiff = diff.rows.filter((row, index) => showUnchanged || row.type !== 'same' || diff.rows.slice(Math.max(0,index-3), index+4).some(part => part.type !== 'same'));
  const batchBlocked = confirmation?.some(draft => batchQuality[draft.id]?.some(item => item.level === 'blocker'));
  const quality = useMemo(() => inspectDraft(content, selected?.before || '', selected?.path, context), [content, selected?.before, selected?.path, context]);
  const blockers = quality.some(item => item.level === 'blocker');
  const filtered = drafts.filter(draft => (category === 'all' || draft.kind === category) && (status === 'archived' ? draft.archived : !draft.archived && (status === 'active' ? draft.status !== 'published' : status === 'all' || draft.status === status)) && `${draft.title} ${pathLabel(draft)}`.toLowerCase().includes(query.toLowerCase()));
  const available = report?.checks.filter(check => check.status !== 'pass' && supportedChecks.includes(check.id)) || [];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/workbench/drafts?offset=${offset}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error || '无法读取草稿。');
      if (controller.signal.aborted) return;
      setDrafts(value.drafts); setReport(value.report); setBatch(rows => rows.filter(id => value.drafts.some((draft: Draft) => draft.id === id && !draft.archived && draft.status === 'draft'))); setLoading(false);
      setBuffers(current => {
        const next = { ...current };
        for (const draft of value.drafts as Draft[]) { if (!next[draft.id]) { try { const saved = JSON.parse(sessionStorage.getItem(cacheKey(draft.id)) || 'null'); if (saved && typeof saved.content === 'string' && saved.content.length <= 30000 && Number.isInteger(saved.revision) && saved.revision > 0) next[draft.id] = saved; } catch { /* Optional cache. */ } } }
        return next;
      });
      const id = new URL(window.location.href).searchParams.get('draft');
      if (id && !value.drafts.some((draft: Draft) => draft.id === id)) {
        void api<{ draft: Draft }>(`/api/workbench/drafts?id=${encodeURIComponent(id)}`).then(result => { if (!controller.signal.aborted) { setDrafts(rows => [...rows.filter(row => row.id !== result.draft.id), result.draft]); try { const saved = JSON.parse(sessionStorage.getItem(cacheKey(result.draft.id)) || 'null'); if (saved && typeof saved.content === 'string' && saved.content.length <= 30000 && Number.isInteger(saved.revision) && saved.revision > 0) setBuffers(rows => ({ ...rows, [result.draft.id]: rows[result.draft.id] || saved })); } catch { /* Optional cache. */ } } }).catch(() => { if (!controller.signal.aborted) setNotice('链接中的草稿不属于当前项目或已不可用。'); });
      }
      if (id) setSelectedId(id);
      if (new URL(window.location.href).searchParams.has('generate')) { setGenerationOpen(true); setTimeout(() => document.getElementById('draft-generation-title')?.scrollIntoView({ block: 'start' }), 30); }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '读取失败。'); setLoading(false); } });
    return () => controller.abort();
  }, [offset, revision, workbench?.project?.repoUrl]);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    const pop = () => { setSelectedId(new URL(window.location.href).searchParams.get('draft')); setConfirmation(null); };
    window.addEventListener('repocare-project-change', update); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('repocare-project-change', update); window.removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => {
    setContext(undefined); setVersions([]); setPreviousGeneration(null); setQualityAcknowledged(false); setCompareRevision('original');
    if (!selectedId || !selected) return;
    let disposed = false;
    void api<{ versions: Draft[]; qualityContext?: DraftQualityContext }>(`/api/workbench/drafts?id=${encodeURIComponent(selectedId)}`).then(result => { if (!disposed) { setContext(result.qualityContext); setVersions(result.versions); } }).catch(() => { if (!disposed) setNotice('历史版本或快照依据读取失败，校验结果按未验证处理。'); });
    if (selected.previousDraftId) void api<{ draft: Draft }>(`/api/workbench/drafts?id=${encodeURIComponent(selected.previousDraftId)}`).then(result => { if (!disposed) setPreviousGeneration(result.draft); }).catch(() => { /* Older generation may no longer be readable. */ });
    return () => { disposed = true; };
  }, [selectedId, selected?.revision, selected?.previousDraftId]);
  useEffect(() => {
    if (!hasUnsaved) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest('a[href],button[aria-label^="切换项目："]');
      if (!target || (target.closest('.draft-center') && !(target instanceof HTMLAnchorElement))) return;
      if (!window.confirm('有未保存修改。内容已尽可能保留在当前标签页，仍要离开或切换项目吗？')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', navigate, true); };
  }, [hasUnsaved]);

  function edit(value: string) {
    if (!selected) return;
    const next = { content: value, revision: buffer?.revision || selected.revision };
    setBuffers(rows => ({ ...rows, [selected.id]: next })); setQualityAcknowledged(false); setConfirmation(null);
    try { sessionStorage.setItem(cacheKey(selected.id), JSON.stringify(next)); } catch { setNotice('浏览器无法暂存；离开前请保存或下载。'); }
  }
  function clearBuffer(id: string) {
    setBuffers(rows => { const next = { ...rows }; delete next[id]; return next; });
    try { sessionStorage.removeItem(cacheKey(id)); } catch { /* Optional cache. */ }
  }
  function open(draft: Draft, push = true) {
    lastFocus.current = document.activeElement as HTMLElement;
    setSelectedId(draft.id); setMode('diff'); setCompareRevision('original'); setShowUnchanged(false); setConfirmation(null); setNotice('');
    const url = new URL(window.location.href); url.searchParams.set('draft', draft.id); url.searchParams.delete('generate');
    window.history[push ? 'pushState' : 'replaceState']({}, '', url);
    setTimeout(() => titleRef.current?.focus(), 30);
  }
  function back() {
    setSelectedId(null); setConfirmation(null);
    const url = new URL(window.location.href); url.searchParams.delete('draft'); window.history.pushState({}, '', url);
    setTimeout(() => lastFocus.current?.isConnected ? lastFocus.current.focus() : listRef.current?.focus(), 30);
  }
  async function operate(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setConfirmation(null);
    try {
      const result = await api<{ draft: Draft; drafts?: Draft[] }>('/api/workbench/drafts', body);
      if (['edit', 'restore'].includes(String(body.action))) clearBuffer(result.draft.id);
      setDrafts(rows => { const replacements = result.drafts || [result.draft]; return [...replacements, ...rows.filter(row => !replacements.some(draft => draft.id === row.id))]; });
      setBatch([]); changed(); setNotice('操作已保存。');
      if (['file', 'item'].includes(String(body.action))) open(result.draft);
      if (body.action === 'publish-batch') open(result.draft);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，编辑内容已保留。'); setRevision(value => value + 1); }
    finally { setBusy(false); }
  }
  function previewHref(href?: string) {
    if (!href || !selected) return undefined;
    if (/^(https?:|mailto:)/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return undefined;
    const prefix = `${selected.repoUrl}/blob/${encodeURIComponent(selected.branch || 'HEAD')}/`;
    if (href.startsWith('/')) return prefix + href.replace(/^\/+/, '');
    if (href.startsWith('#')) return prefix + (selected.path || 'README.md') + href;
    return new URL(href, prefix + (selected.path || 'README.md')).href;
  }
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = selected.path?.split('/').pop() || `${selected.kind}-${selected.number}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  async function requestPublish(rows: Draft[]) {
    if (busy) return;
    if (rows.some(draft => buffers[draft.id] && buffers[draft.id].content !== draft.content)) { setError('请先保存批次所有文件的编辑内容。'); return; }
    if (rows.length > 1 && (rows.some(draft => draft.kind !== 'file' || draft.baseSha !== rows[0].baseSha || draft.branch !== rows[0].branch) || new Set(rows.map(draft => draft.path)).size !== rows.length)) { setError('请选择同分支、同基准的不同文件，不要同时选择同一文件的多个版本。'); return; }
    setBusy(true); setError('');
    try {
      const checks: typeof batchQuality = {};
      for (const draft of rows) {
        const result = await api<{ draft: Draft; qualityContext?: DraftQualityContext }>(`/api/workbench/drafts?id=${encodeURIComponent(draft.id)}`);
        if (result.draft.revision !== draft.revision) throw new Error('草稿版本已变化，请重新读取并审阅。');
        checks[draft.id] = inspectDraft(draft.content, draft.before, draft.path, result.qualityContext);
      }
      setBatchQuality(checks); setConfirmation(rows); setQualityAcknowledged(false);
      setTimeout(() => document.getElementById('draft-confirmation-title')?.focus(), 30);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法校验待发布内容。'); }
    finally { setBusy(false); }
  }
  const generation = <section className="draft-generation" aria-labelledby="draft-generation-title"><div><h2 id="draft-generation-title">从体检问题生成文档改进</h2><p>使用当前项目及分支的最近成功报告；生成会调用已配置模型，不会发布。</p></div>{!report ? <p>当前分支尚无成功体检报告。<Link href="/audit?new=1">开始项目体检</Link></p> : <><p className="draft-meta">{report.repository.branch} / {report.repository.sha.slice(0, 8)} <Link href={`/audit?run=${report.runId}`}>查看依据</Link></p>{available.length ? available.map(check => { const existing = drafts.filter(draft => draft.source?.type === 'audit-check' && draft.source.checkId === check.id && !draft.archived); return <div className="draft-generation-row" key={check.id}><div><strong>{check.title}</strong><p>{check.summary}</p>{existing.length > 0 && <small>已有 {existing.length} 份相关草稿；再次生成会保留为新版本。</small>}</div><button type="button" className="button button-secondary" disabled={busy} onClick={() => void operate({ action: 'file', runId: report.runId, checkId: check.id })}>{busy ? '处理中…' : existing.length ? '生成新版本' : '生成草稿'}</button></div>; }) : <p>报告没有可生成文档草稿的待完善项；其他检查仍需人工处理。</p>}</>}</section>;

  return <div className="draft-center">
    <header className="draft-heading"><div><h1>规范改进与草稿审阅</h1><p>从依据到改动。文档、Issue 回复与 PR 评论统一审阅，确认后交付。</p></div><span>{drafts.length} 份本页草稿</span></header>
    {loading && <p role="status">正在读取当前项目草稿…</p>}{error && <div className="draft-message error" role="alert">{error}<button type="button" className="button button-secondary" onClick={() => { setError(''); setRevision(value => value + 1); }}>重新读取</button></div>}{notice && <p className="draft-message" role="status">{notice}</p>}
    {!loading && !workbench?.project ? <section className="draft-empty"><FileText size={25}/><h2>先连接一个要维护的项目</h2><p>连接后可从体检生成文档，或从 Issue / PR 生成回复草稿。</p><Link className="button button-primary" href="/projects">连接项目</Link></section> : selected ? <>
      <div className="draft-editor-navigation"><button type="button" className="button button-secondary" disabled={busy} onClick={back}><ArrowLeft size={15}/>返回草稿列表</button><label>切换草稿<select value={selected.id} disabled={busy} onChange={event => { const row = drafts.find(draft => draft.id === event.target.value); if (row) open(row); }}>{drafts.map(draft => <option key={draft.id} value={draft.id}>{pathLabel(draft)} · {statusLabels[draft.status]} · {draft.id.slice(0, 6)}</option>)}</select></label></div>
      <section className="draft-editor">
        <header><div><span className="draft-meta">{kindLabels[selected.kind]} · {selected.archived ? '已归档' : statusLabels[selected.status]} · 版本 {selected.revision}</span><h2 ref={titleRef} tabIndex={-1}>{pathLabel(selected)}</h2><p className="draft-meta">{selected.branch || '讨论'} / 基准 {selected.baseSha.slice(0, 8) || '无代码快照'}</p></div><div role="group" aria-label="审阅视图" className="draft-modes">{(['diff', 'edit', 'preview'] as Mode[]).map(item => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item === 'diff' ? '差异' : item === 'edit' ? '编辑' : '预览'}</button>)}</div></header>
        {unsaved && <div className="draft-buffer-notice" role="status">有未保存修改，切换草稿不会丢失。{buffer?.revision !== selected.revision && '服务端版本已变化；请比较新版本后再保存。'}<button type="button" disabled={busy} onClick={() => { if (window.confirm('放弃此草稿的未保存修改？')) clearBuffer(selected.id); }}>放弃本地修改</button></div>}
        {mode === 'edit' && <><label className="draft-label" htmlFor="draft-content">编辑草稿内容</label><textarea id="draft-content" value={content} onChange={event => edit(event.target.value)} disabled={busy || selected.status !== 'draft' || selected.archived} maxLength={30000} spellCheck={false}/><p className="draft-meta">{content.length.toLocaleString('zh-CN')} / 30,000 字符；临时编辑保存在当前浏览器标签页。</p></>}
        {mode === 'preview' && <article className="draft-markdown" aria-label="Markdown 预览"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children, href }) => <a href={previewHref(href)} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="draft-image-placeholder">图片：{alt || '未加载'}（预览不自动请求外部图片）</span> }}>{content}</ReactMarkdown></article>}
        {mode === 'diff' && <div className="draft-diff"><div className="draft-diff-controls"><label>比较基准<select aria-label="差异比较基准" value={compareRevision} onChange={event => setCompareRevision(event.target.value)}><option value="original">原始文件 / 发布前内容</option>{previousGeneration && <option value="previous">上一份生成草稿</option>}{versions.map(row => <option key={row.revision} value={String(row.revision)}>保存版本 {row.revision}</option>)}</select></label><label><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)}/>展开未修改行</label></div><p className="draft-diff-summary">{diff.limited ? '内容差异过大，未计算统计；请切换编辑逐项核对。' : <>新增 {diff.additions} 行 / 删除 {diff.deletions} 行（替换计入两者）</>}</p><div className="draft-diff-lines" aria-label="逐行差异">{shownDiff.map((row, index) => <div className={`draft-diff-line ${row.type}`} key={index}><span aria-hidden="true">{row.oldLine}</span><span aria-hidden="true">{row.newLine}</span><span aria-hidden="true">{row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}</span><code>{row.text || ' '}</code></div>)}{!diff.limited && !shownDiff.length && <p className="draft-meta">内容与所选基准相同，没有差异。</p>}{!showUnchanged && shownDiff.length < diff.rows.length && <p className="draft-meta">未修改行已折叠，仅显示改动及前后上下文；勾选展开可查看全文。</p>}</div></div>}
        <footer className="draft-actions"><button type="button" className="button button-secondary" onClick={download} disabled={busy}><Download size={15}/>下载当前内容</button><button type="button" className="button button-secondary" disabled={busy || !unsaved || selected.status !== 'draft' || selected.archived || blockers} onClick={() => void operate({ action: 'edit', id: selected.id, revision: buffer?.revision || selected.revision, content })}><Check size={15}/>保存</button><button type="button" className="button button-secondary" disabled={busy || !selected.source || selected.archived || (selected.source.type === 'audit-check' && !report)} onClick={() => { if (unsaved && !window.confirm('未保存编辑会保留在原草稿。继续调用模型生成新版本？')) return; if (selected.source?.type === 'audit-check') void operate({ action: 'file', runId: report?.runId, checkId: selected.source.checkId }); else if (selected.source) void operate({ action: 'item', kind: selected.source.kind, number: selected.source.number }); }}><RefreshCw size={15}/>生成新版本</button><button type="button" className="button button-secondary" disabled={busy || selected.status === 'publishing' || unsaved} onClick={() => void operate({ action: 'archive', id: selected.id, revision: selected.revision, archived: !selected.archived })}>{selected.archived ? '取消归档' : '归档'}</button><button type="button" className="button button-primary" disabled={busy || selected.status !== 'draft' || selected.archived || unsaved || blockers || !workbench?.github?.canWrite} onClick={() => void requestPublish([selected])}>{publishLabels[selected.kind]}</button></footer>
        {!workbench?.github?.canWrite && <p className="draft-meta">发布需要额外授权；下载与编辑不要求写权限。<Link href="/settings">设置 GitHub 授权</Link></p>}
      </section>
      <details className="draft-details" open><summary>内容检查 <span>{quality.filter(item => item.level === 'warning').length} 项提醒 / {quality.filter(item => item.level === 'blocker').length} 项阻断</span></summary><p>基于固定快照的静态检查，不保证语义正确，不执行命令或网络探测。</p>{quality.length ? <ul>{quality.map((item, index) => <li className={item.level} key={index}>{item.level === 'blocker' ? '阻断' : item.level === 'warning' ? '提醒' : '未验证 / 边界'}：{item.message}</li>)}</ul> : <p>未发现规则范围内的问题；仍需维护者审阅。</p>}</details>
      <details className="draft-details"><summary>来源与版本</summary><p>{selected.source?.type === 'audit-check' ? selected.source.checkTitle : selected.source?.type === 'github-item' ? `${selected.source.kind === 'issue' ? 'Issue' : 'PR'} #${selected.source.number}` : '旧草稿未记录来源'}</p>{selected.source?.type === 'audit-check' ? <><Link href={`/audit?run=${selected.source.runId}`}>打开原始体检</Link><ul>{selected.source.evidence.map((item, index) => <li key={index}><code>{item.path}</code>{item.excerpt && <p>{item.excerpt}</p>}</li>)}</ul></> : selected.number && <Link href={`${selected.kind === 'issue' ? '/issues' : '/pull-requests'}?number=${selected.number}`}>返回原始讨论</Link>}{selected.previousDraftId && <button type="button" className="button button-secondary" onClick={() => { window.location.assign(`/improvements?draft=${selected.previousDraftId}`); }}>打开上一份生成版本</button>}<h3>保存版本（最近 20 个历史版本）</h3>{versions.filter(row => row.revision !== selected.revision).map(row => <div className="draft-version" key={row.revision}><span>版本 {row.revision} · {row.content.length} 字符</span><button type="button" className="button button-secondary" disabled={busy || selected.status !== 'draft' || selected.archived} onClick={() => { if (window.confirm('恢复此内容为新版本？本地未保存修改将被替换。')) void operate({ action: 'restore', id: selected.id, revision: selected.revision, version: row.revision }); }}>恢复内容为新版本</button></div>)}</details>
      {['published', 'uncertain'].includes(selected.status) && <section className="draft-publication"><h2>交付与后续验证</h2><p>{selected.status === 'uncertain' ? '发布结果待核对，不会自动重试。请核对 GitHub 内容。' : selected.kind === 'file' ? `PR 状态：${selected.publication?.state === 'merged' ? '已合并' : selected.publication?.state === 'closed' ? '已关闭' : '已创建，等待审阅'}` : '评论已发布；不表示问题已解决。'}</p><p>体检验证：{selected.publication?.verification === 'passed' ? '合并提交已包含在新报告，关联检查通过' : selected.publication?.verification === 'needs-attention' ? '新报告关联检查仍待完善或无法判断' : '尚未验证'}</p>{(selected.publishedUrl || selected.publication?.url) && <a href={selected.publishedUrl || selected.publication?.url} target="_blank" rel="noopener noreferrer">打开 GitHub 结果</a>}<button type="button" className="button button-secondary" disabled={busy} onClick={() => void operate({ action: 'check-publication', id: selected.id, revision: selected.revision })}>读取 GitHub 最新状态</button>{selected.kind === 'file' && <Link className="button button-secondary" href="/audit?new=1">重新体检（主动发起）</Link>}{selected.publication?.verificationRunId && <Link href={`/audit?run=${selected.publication.verificationRunId}`}>查看验证报告</Link>}{selected.publication?.checkedAt && <p className="draft-meta">状态读取时间：{selected.publication.checkedAt.replace('T',' ').slice(0,19)} UTC；读取不会启动体检。</p>}</section>}
    </> : <div ref={listRef} tabIndex={-1}>
      <details className="draft-generation-entry" open={!drafts.length || generationOpen} onToggle={event => setGenerationOpen(event.currentTarget.open)}><summary>从体检问题生成文档改进 · {available.length} 个可处理项</summary>{generation}</details>
      <div className="draft-list-tools"><div className="draft-categories" role="group" aria-label="草稿分类">{[['all','全部'],['file','文档改进'],['issue','Issue 回复'],['review','PR 评论']].map(([value,label]) => <button type="button" aria-pressed={category === value} key={value} onClick={() => { setCategory(value); setBatch([]); }}>{label}</button>)}</div><label className="draft-search"><Search size={15}/><input aria-label="搜索本页草稿" placeholder="搜索本页标题或文件路径" value={query} onChange={event => setQuery(event.target.value)}/></label><label>状态<select aria-label="草稿状态" value={status} onChange={event => setStatus(event.target.value)}><option value="active">待处理</option><option value="draft">待审阅</option><option value="uncertain">待核对</option><option value="published">已交付</option><option value="archived">已归档</option><option value="all">全部未归档</option></select></label></div>
      <p className="draft-meta">仅显示当前项目。搜索和分类限当前页；同路径的生成版本保留，不冒充完整仓库文档目录。</p>
      {batch.length > 0 && <div className="draft-batch"><span>已选择 {batch.length} 个文档；最多 4 个，同分支 / 同基准 / 不同路径。</span><button type="button" className="button button-primary" disabled={batch.length < 2 || !workbench?.github?.canWrite || busy} onClick={() => void requestPublish(drafts.filter(draft => batch.includes(draft.id)))}>审阅并创建一个草稿 PR</button><button type="button" onClick={() => setBatch([])}>清除选择</button></div>}
      <div className="draft-list" aria-label="草稿列表">{filtered.length ? filtered.map(draft => { const siblings = drafts.filter(row => documentKey(row) === documentKey(draft) && row.kind === draft.kind); const Icon = draft.kind === 'file' ? FileText : draft.kind === 'issue' ? MessageSquare : GitPullRequest; return <div className="draft-row" key={draft.id}>{draft.kind === 'file' && draft.status === 'draft' && !draft.archived && <input type="checkbox" aria-label={`选择 ${pathLabel(draft)} ${draft.id.slice(0,6)}`} checked={batch.includes(draft.id)} disabled={busy || (!batch.includes(draft.id) && batch.length >= 4)} onChange={event => setBatch(rows => event.target.checked ? [...rows,draft.id] : rows.filter(id => id !== draft.id))}/>}<button type="button" className="draft-open" disabled={busy} onClick={() => open(draft)}><Icon size={18}/><span><strong>{pathLabel(draft)}</strong><small>{kindLabels[draft.kind]} · {statusLabels[draft.status]} · 版本 {draft.revision} {siblings.length > 1 && `· 同目标 ${siblings.length} 份`}{buffers[draft.id]?.content !== undefined && buffers[draft.id].content !== draft.content && ' · 未保存'}</small></span><ArrowRight size={15}/></button></div>; }) : <section className="draft-empty"><FileText size={24}/><h2>{drafts.length ? '当前筛选没有匹配草稿' : '还没有草稿，从一个具体问题开始'}</h2><p>文档从下方体检问题生成，讨论回复从 Issue / PR 详情生成。</p>{drafts.length > 0 && <button type="button" className="button button-secondary" onClick={() => { setCategory('all'); setStatus('all'); setQuery(''); }}>清除筛选</button>}<div><Link href="/issues">打开 Issue 分诊</Link><Link href="/pull-requests">打开 PR 检查</Link></div></section>}</div>
      <div className="draft-pagination"><button type="button" className="button button-secondary" disabled={loading || offset === 0 || busy} onClick={() => setOffset(value => Math.max(0,value - 100))}>上一页</button><span>第 {offset / 100 + 1} 页 / 每页最多 100 份</span><button type="button" className="button button-secondary" disabled={loading || drafts.length < 100 || offset >= 10000 || busy} onClick={() => setOffset(value => value + 100)}>下一页</button></div>
    </div>}
    {confirmation && <section className="draft-confirmation" role="region" aria-label="发布确认"><h2 id="draft-confirmation-title" tabIndex={-1}>{confirmation.length > 1 ? '创建一个多文件草稿 PR' : publishLabels[confirmation[0].kind]}</h2><p>目标：{confirmation[0].repoUrl}。只发布已保存版本，不直接修改默认分支、不批准或合并 PR。</p><ul>{confirmation.map(draft => <li key={draft.id}>{pathLabel(draft)} / 版本 {draft.revision} / 基准 {draft.baseSha.slice(0,8)}{(batchQuality[draft.id] || []).filter(item => item.level !== 'info').map((item,index) => <p key={index} className={item.level}>{item.level === 'blocker' ? '阻断' : '提醒'}：{item.message}</p>)} <button type="button" onClick={() => open(draft)}>重新审阅</button></li>)}</ul><label><input type="checkbox" checked={qualityAcknowledged} disabled={Boolean(batchBlocked)} onChange={event => setQualityAcknowledged(event.target.checked)}/>我已审阅每份草稿的内容、差异及检查提醒；理解未执行命令或测试。</label><div><button type="button" className="button button-primary" disabled={busy || !qualityAcknowledged || batchBlocked} onClick={() => void operate(confirmation.length > 1 ? { action: 'publish-batch', drafts: confirmation.map(draft => ({ id: draft.id, revision: draft.revision })), confirmed: true } : { action: 'publish', id: confirmation[0].id, revision: confirmation[0].revision, confirmed: true })}>确认{confirmation.length > 1 ? '创建草稿 PR' : publishLabels[confirmation[0].kind]}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmation(null)}>取消</button></div></section>}
    <p className="draft-footer"><ShieldCheck size={14}/>生成是建议，交付需确认，合并后仍需重新验证。</p>
  </div>;
}
