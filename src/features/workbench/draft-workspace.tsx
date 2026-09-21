'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Draft } from '@/contracts/workbench';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

export function DraftWorkspace() {
  const { data, error, refresh } = useWorkbench(); const [selected, setSelected] = useState<Draft | null>(null), [content, setContent] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [confirm, setConfirm] = useState(false);
  const runs = data?.runs.filter(run => run.repoUrl === data.project?.repoUrl && run.report) || [], report = runs[0]?.report;
  const supported = ['readme', 'contributing', 'issue-template', 'pr-template', 'agent-readme-clarity', 'agent-contributing-clarity', 'agent-command-consistency'];
  function select(draft: Draft) { setSelected(draft); setContent(draft.content); setConfirm(false); setNotice(''); }
  async function operate(body: unknown) {
    setBusy(true); setNotice('');
    try { const result = await api<{ draft: Draft }>('/api/workbench/drafts', body); select(result.draft); await refresh(); changed(); }
    catch (cause) {
      setNotice((cause as Error).message); setConfirm(false);
      if (selected) {
        // A failed response may still have changed the publishing state server-side.
        try {
          const latest = await api<{ drafts: Draft[] }>('/api/workbench/drafts');
          const current = latest.drafts.find(draft => draft.id === selected.id);
          if (current) { setSelected(current); if (current.status !== 'draft') setContent(current.content); }
        } catch { /* Preserve the original error; the server still rejects duplicate writes. */ }
      }
      await refresh();
    } finally { setBusy(false); }
  }
  function download() { if (!selected) return; const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = selected.path?.split('/').pop() || `draft-${selected.id}.md`; link.click(); URL.revokeObjectURL(url); }
  return <div className="wb-page"><h1>规范改进与评论草稿</h1><p>根据真实报告生成文件，或审阅 Issue／PR 分析。所有发布操作都需要确认。</p>{(error || notice) && <p className="wb-error" role="alert">{error || notice}</p>}
    <section className="wb-card"><h2>从最近报告生成改进</h2>{!report && <p>先<Link href="/audit">完成项目体检</Link>，再生成对应文件。</p>}{report?.checks.filter(check => check.status !== 'pass' && supported.includes(check.id)).map(check => <div className="wb-row" key={check.id}><strong>{check.title}</strong><p>{check.summary}</p><button className="button button-secondary" disabled={busy} onClick={() => void operate({ action: 'file', runId: report.runId, checkId: check.id })}>生成可编辑草稿</button></div>)}<p>目前支持 README、贡献指南、Issue／PR 模板；许可证与可执行 CI 配置需要维护者单独决策。</p></section>
    <section className="wb-card"><h2>已保存草稿</h2>{data?.drafts.filter(draft => draft.repoUrl === data.project?.repoUrl).map(draft => <button className="wb-row" disabled={busy} key={draft.id} onClick={() => select(draft)}>{draft.title}<small>{draft.status} · {new Date(draft.createdAt).toLocaleString('zh-CN')}</small></button>)}</section>
    {selected && <section className="wb-card"><h2>{selected.title}</h2><p>{selected.repoUrl} · {selected.path || `#${selected.number}`} · 基准 {selected.baseSha.slice(0, 7) || 'Issue 讨论'}</p><div className="wb-diff"><div><h3>修改前</h3><pre>{selected.before || '新建文件或评论'}</pre></div><div><h3>修改后（可编辑）</h3><textarea aria-label="草稿内容" disabled={selected.status !== 'draft' || busy} value={content} onChange={event => { setContent(event.target.value); setConfirm(false); }} /></div></div><div className="wb-actions"><button className="button button-secondary" onClick={download}>下载 Markdown</button><button className="button button-secondary" disabled={busy || selected.status !== 'draft' || content === selected.content} onClick={() => void operate({ action: 'edit', id: selected.id, revision: selected.revision, content })}>保存修改</button><button className="button button-primary" disabled={busy || selected.status !== 'draft' || content !== selected.content || !data?.github?.canWrite} onClick={() => setConfirm(true)}>审阅发布</button></div>{!data?.github?.canWrite && <p>发布前请在设置中授权 GitHub 仓库访问与写入。</p>}{selected.publishedUrl && <a href={selected.publishedUrl} target="_blank" rel="noopener noreferrer">查看已发布内容</a>}
    {confirm && <div className="wb-confirm" role="region" aria-label="发布确认"><strong>{selected.kind === 'file' ? '将创建独立分支和草稿 PR' : selected.kind === 'review' ? '将发布 COMMENT 审阅，不批准或合并 PR' : '将向 Issue 发布评论'}</strong><p>目标：{selected.repoUrl} {selected.path || `#${selected.number}`}。发送上面已保存的完整内容，版本 {selected.revision}。</p><div className="wb-actions"><button className="button button-primary" disabled={busy} onClick={() => void operate({ action: 'publish', id: selected.id, revision: selected.revision, confirmed: true })}>确认发布到 GitHub</button><button className="button button-secondary" disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></div>}</section>}
  </div>;
}
