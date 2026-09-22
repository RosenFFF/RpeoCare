'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Download, Eye, FileCode2, FileText, GitPullRequest, Info, Pencil, RefreshCw, Send, Sparkles, SplitSquareHorizontal } from 'lucide-react';
import type { Draft, DraftSource } from '@/contracts/workbench';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

type WorkspaceMode = 'edit' | 'preview' | 'diff';

const supportedChecks = ['readme', 'contributing', 'issue-template', 'pr-template', 'agent-readme-clarity', 'agent-contributing-clarity', 'agent-command-consistency'];

function draftPath(draft: Draft) {
  return draft.path || (draft.kind === 'issue' ? 'Issue #' + String(draft.number || '') : draft.kind === 'review' ? 'PR #' + String(draft.number || '') : '新文件');
}

function fileName(draft: Draft) {
  if (draft.path) return draft.path.split('/').pop() || draft.path;
  return draft.kind === 'issue' ? 'Issue #' + String(draft.number || '') : draft.kind === 'review' ? 'PR #' + String(draft.number || '') : '未命名草稿';
}

function statusLabel(status: Draft['status']) {
  return status === 'published' ? '已发布' : status === 'publishing' ? '发布中' : status === 'uncertain' ? '待核对' : '待审阅';
}

function sourceLabel(source?: DraftSource) {
  if (!source) return '工作区草稿';
  if (source.type === 'audit-check') return '项目体检 · ' + source.checkTitle;
  return (source.kind === 'issue' ? 'Issue #' : 'PR #') + String(source.number);
}

function lines(value: string) {
  return value.replace(/\r/g, '').split('\n');
}

function renderMarkdown(value: string): ReactNode[] {
  const output: ReactNode[] = [];
  const input = lines(value);
  let code = false;
  let codeLines: string[] = [];
  input.forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      if (code) {
        output.push(<pre className="wb-preview-code" key={'code-' + String(index)}><code>{codeLines.join('\n')}</code></pre>);
        codeLines = [];
      }
      code = !code;
      return;
    }
    if (code) {
      codeLines.push(line);
      return;
    }
    if (!line.trim()) {
      output.push(<div className="wb-preview-space" key={'space-' + String(index)} />);
    } else if (/^###\s+/.test(line)) {
      output.push(<h4 key={'h4-' + String(index)}>{line.replace(/^###\s+/, '')}</h4>);
    } else if (/^##\s+/.test(line)) {
      output.push(<h3 key={'h3-' + String(index)}>{line.replace(/^##\s+/, '')}</h3>);
    } else if (/^#\s+/.test(line)) {
      output.push(<h2 key={'h2-' + String(index)}>{line.replace(/^#\s+/, '')}</h2>);
    } else if (/^[-*]\s+/.test(line)) {
      output.push(<p className="wb-preview-list-item" key={'list-' + String(index)}><span aria-hidden="true">•</span>{line.replace(/^[-*]\s+/, '')}</p>);
    } else if (/^\d+\.\s+/.test(line)) {
      output.push(<p className="wb-preview-list-item" key={'ordered-' + String(index)}><span aria-hidden="true">{line.match(/^\d+/)?.[0]}.</span>{line.replace(/^\d+\.\s+/, '')}</p>);
    } else {
      output.push(<p key={'p-' + String(index)}>{line}</p>);
    }
  });
  if (code) output.push(<pre className="wb-preview-code" key="code-tail"><code>{codeLines.join('\n')}</code></pre>);
  return output;
}

function DraftIcon({ draft }: { draft: Draft }) {
  if (draft.kind === 'review') return <GitPullRequest size={16} aria-hidden="true" />;
  if (draft.kind === 'issue') return <Info size={16} aria-hidden="true" />;
  return <FileText size={16} aria-hidden="true" />;
}

function SourcePanel({ draft }: { draft: Draft }) {
  const source = draft.source;
  return <section className="wb-source-panel" aria-labelledby="wb-source-title">
    <div className="wb-panel-heading"><div><span className="wb-panel-kicker">TRACEABILITY</span><h3 id="wb-source-title">来源信息</h3></div><FileCode2 size={16} aria-hidden="true" /></div>
    <p className="wb-source-title">{sourceLabel(source)}</p>
    {source?.type === 'audit-check' && <>
      <p className="wb-source-copy">这份文件草稿来自固定提交版本的项目体检检查项，内容可回到原始依据核对。</p>
      <dl className="wb-source-meta"><div><dt>体检任务</dt><dd><code>{source.runId.slice(0, 8)}</code></dd></div><div><dt>检查项</dt><dd>{source.checkId}</dd></div></dl>
      {source.evidence.length > 0 && <div className="wb-source-evidence"><span>文件依据</span><ul>{source.evidence.slice(0, 5).map((item, index) => <li key={item.path + '-' + String(index)}><FileText size={12} aria-hidden="true" /><code>{item.path}</code></li>)}</ul></div>}
      <Link className="wb-source-link" href={'/audit?run=' + encodeURIComponent(source.runId)}>打开项目体检 <ChevronRight size={14} aria-hidden="true" /></Link>
    </>}
    {source?.type === 'github-item' && <>
      <p className="wb-source-copy">草稿根据 GitHub {source.kind === 'issue' ? 'Issue' : 'Pull Request'} 原文与可用 Diff 生成，发布前请重新核对上下文。</p>
      <dl className="wb-source-meta"><div><dt>来源编号</dt><dd>{source.kind === 'issue' ? 'Issue #' : 'PR #'}{source.number}</dd></div><div><dt>基准提交</dt><dd><code>{draft.baseSha ? draft.baseSha.slice(0, 8) : '讨论内容'}</code></dd></div></dl>
    </>}
    {!source && <p className="wb-source-copy">旧版本草稿没有记录来源。请根据文件内容和当前项目约定自行核对。</p>}
  </section>;
}

export function DraftWorkspace() {
  const { data, error, refresh } = useWorkbench();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<WorkspaceMode>('edit');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);

  const drafts = useMemo(() => {
    const repoUrl = data?.project?.repoUrl;
    return (data?.drafts || []).filter((draft) => !repoUrl || draft.repoUrl === repoUrl);
  }, [data?.drafts, data?.project?.repoUrl]);
  const selected = drafts.find((draft) => draft.id === selectedId) || null;
  const runs = (data?.runs || []).filter((run) => run.repoUrl === data?.project?.repoUrl && run.report);
  const report = runs[0]?.report;
  const availableChecks = report?.checks.filter((check) => check.status !== 'pass' && supportedChecks.includes(check.id)) || [];
  const unsaved = Boolean(selected && selected.status === 'draft' && content !== selected.content);

  useEffect(() => {
    const current = selectedId ? drafts.find((draft) => draft.id === selectedId) : undefined;
    if (current) return;
    const first = drafts[0];
    setSelectedId(first?.id || null);
    setContent(first?.content || '');
    setMode('edit');
  }, [drafts, selectedId]);

  function selectDraft(draft: Draft) {
    setSelectedId(draft.id);
    setContent(draft.content);
    setMode('edit');
    setConfirm(false);
    setNotice('');
  }

  async function operate(body: unknown) {
    setBusy(true);
    setNotice('');
    setConfirm(false);
    try {
      const result = await api<{ draft: Draft }>('/api/workbench/drafts', body);
      selectDraft(result.draft);
      await refresh();
      changed();
      if (result.draft.status === 'published') setNotice('已发布到 GitHub。');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '草稿操作未完成，请重试。');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!selected) return;
    const type = selected.path?.endsWith('.yml') || selected.path?.endsWith('.yaml') ? 'application/yaml;charset=utf-8' : 'text/markdown;charset=utf-8';
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(selected);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    setNotice('已开始下载 ' + fileName(selected) + '。');
  }

  function regenerate() {
    if (!selected?.source) return;
    if (selected.source.type === 'audit-check') {
      void operate({ action: 'file', runId: selected.source.runId, checkId: selected.source.checkId });
    } else {
      void operate({ action: 'item', kind: selected.source.kind, number: selected.source.number });
    }
  }

  return <div className="wb-page wb-document-page">
    <div className="wb-document-heading"><div><span className="wb-panel-kicker">DOCUMENT WORKBENCH</span><h1>规范改进工作台</h1><p>编辑 AI 草稿，查看来源与差异，在确认后下载或发布。</p></div><div className="wb-document-count"><Sparkles size={15} aria-hidden="true" /><span>{drafts.length} 份草稿</span></div></div>
    {(error || notice) && <p className={'wb-notice ' + (error ? 'wb-error' : '')} role="status">{error || notice}</p>}

    <div className="wb-document-layout">
      <aside className="wb-assets" aria-label="文档资产列表">
        <div className="wb-assets-heading"><h2>资产</h2><span>{drafts.length}</span></div>
        {drafts.length > 0 ? <div className="wb-asset-list">{drafts.map((draft) => <button type="button" key={draft.id} className={'wb-asset ' + (draft.id === selectedId ? 'is-active' : '')} aria-pressed={draft.id === selectedId} onClick={() => selectDraft(draft)} disabled={busy}><span className="wb-asset-icon"><DraftIcon draft={draft} /></span><span className="wb-asset-copy"><strong>{fileName(draft)}</strong><small>{statusLabel(draft.status)} · {sourceLabel(draft.source)}</small></span><ChevronRight size={14} aria-hidden="true" /></button>)}</div> : <div className="wb-assets-empty"><FileText size={22} aria-hidden="true" /><p>还没有草稿。</p><Link href="/audit">先完成项目体检</Link></div>}
        <div className="wb-assets-footer"><span>仅显示当前项目</span>{data?.project && <code>{data.project.fullName}</code>}</div>
      </aside>

      <section className="wb-document-main" aria-label="文档编辑工作区">
        {!selected ? <div className="wb-document-empty"><FileText size={30} aria-hidden="true" /><h2>选择一份草稿开始</h2><p>你可以从项目体检报告生成文档草稿，或在 Issue／PR 页面生成评论草稿。</p><Link href="/audit" className="button button-secondary">打开项目体检</Link></div> : <>
          <header className="wb-document-toolbar"><div className="wb-document-title"><span className="wb-asset-icon"><DraftIcon draft={selected} /></span><div><h2>{selected.title}</h2><p><code>{draftPath(selected)}</code><span>·</span>{statusLabel(selected.status)}<span>·</span>基准 {selected.baseSha ? selected.baseSha.slice(0, 8) : '讨论内容'}</p></div></div><div className="wb-mode-tabs" role="tablist" aria-label="文档视图"><button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}><Pencil size={14} aria-hidden="true" />编辑</button><button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}><Eye size={14} aria-hidden="true" />预览</button><button type="button" role="tab" aria-selected={mode === 'diff'} className={mode === 'diff' ? 'is-active' : ''} onClick={() => setMode('diff')}><SplitSquareHorizontal size={14} aria-hidden="true" />Diff</button></div></header>
          <div className="wb-document-body">
            {mode === 'edit' && <div className="wb-editor-wrap"><label className="wb-sr-only" htmlFor="wb-draft-editor">编辑草稿内容</label><textarea id="wb-draft-editor" className="wb-editor" value={content} disabled={busy || selected.status !== 'draft'} onChange={(event) => { setContent(event.target.value); setConfirm(false); }} spellCheck={false} /><div className="wb-editor-meta"><span>{content.length.toLocaleString('zh-CN')} 字符</span>{unsaved ? <span className="wb-unsaved">有未保存修改</span> : <span>已保存版本 {selected.revision}</span>}</div></div>}
            {mode === 'preview' && <article className="wb-preview" aria-label="Markdown 预览">{renderMarkdown(content)}</article>}
            {mode === 'diff' && <div className="wb-diff-view"><div className="wb-diff-summary"><span><strong>{lines(selected.before).length}</strong> 行原文</span><span className="wb-diff-added">+ {Math.max(0, lines(content).length - lines(selected.before).length)} 行新增</span><span className="wb-diff-removed">− {Math.max(0, lines(selected.before).length - lines(content).length)} 行删除</span></div><div className="wb-diff"><div><h3>修改前</h3><pre>{selected.before || '新建文件或评论草稿，没有原文。'}</pre></div><div><h3>修改后</h3><pre>{content}</pre></div></div></div>}
          </div>
          <div className="wb-document-actions"><div className="wb-action-group"><button type="button" className="button button-secondary" onClick={download} disabled={busy}><Download size={15} aria-hidden="true" />下载</button><button type="button" className="button button-secondary" onClick={() => void operate({ action: 'edit', id: selected.id, revision: selected.revision, content })} disabled={busy || selected.status !== 'draft' || !unsaved}><Check size={15} aria-hidden="true" />保存</button><button type="button" className="button button-secondary" onClick={regenerate} disabled={busy || !selected.source}><RefreshCw size={15} aria-hidden="true" />重新生成</button></div><div className="wb-action-group"><button type="button" className="button button-primary" onClick={() => setConfirm(true)} disabled={busy || selected.status !== 'draft' || unsaved || !data?.github?.canWrite}><Send size={15} aria-hidden="true" />发布</button></div></div>
          {!data?.github?.canWrite && selected.status === 'draft' && <p className="wb-action-hint">发布前请在<Link href="/settings">工作区设置</Link>授权 GitHub 写入权限。</p>}
          {selected.publishedUrl && <a className="wb-published-link" href={selected.publishedUrl} target="_blank" rel="noopener noreferrer">查看已发布内容 <ChevronRight size={14} aria-hidden="true" /></a>}
          {confirm && <div className="wb-confirm" role="region" aria-label="发布确认"><div><strong>{selected.kind === 'file' ? '将创建独立分支和草稿 PR' : selected.kind === 'review' ? '将发布 PR 评论，不批准或合并 PR' : '将向 Issue 发布评论'}</strong><p>目标：{selected.repoUrl} · {draftPath(selected)}。发布当前已保存版本 {selected.revision}。</p></div><div className="wb-actions"><button type="button" className="button button-primary" disabled={busy} onClick={() => void operate({ action: 'publish', id: selected.id, revision: selected.revision, confirmed: true })}>确认发布</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></div>}
        </>}
      </section>

      {selected && <aside className="wb-document-aside"><SourcePanel draft={selected} /><section className="wb-guidance"><span className="wb-panel-kicker">REVIEW NOTE</span><h3>发布前核对</h3><p>确认文件路径、命令和证据都符合当前仓库约定。RepoCare 不会在发布前替你运行项目脚本。</p></section></aside>}
    </div>

    {report && availableChecks.length > 0 && <section className="wb-generation-card"><div><span className="wb-panel-kicker">FROM AUDIT REPORT</span><h2>从体检报告生成文档草稿</h2><p>选择待完善检查项，生成一份可编辑的完整文件草稿。</p></div><div className="wb-generation-list">{availableChecks.map((check) => <div className="wb-generation-row" key={check.id}><span><strong>{check.title}</strong><small>{check.summary}</small></span><button type="button" className="button button-secondary" disabled={busy} onClick={() => void operate({ action: 'file', runId: report.runId, checkId: check.id })}>生成草稿</button></div>)}</div></section>}
  </div>;
}
