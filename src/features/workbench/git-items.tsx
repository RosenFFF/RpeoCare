'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { GitItem } from '@/contracts/workbench';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

export function GitItems({ kind }: { kind: 'issues' | 'pulls' }) {
  const { data } = useWorkbench(); const [items, setItems] = useState<GitItem[]>([]), [selected, setSelected] = useState<GitItem | null>(null), [page, setPage] = useState(1), [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { let disposed = false; setSelected(null); setItems([]); setError(''); if (data?.project) void api<{ items: GitItem[] }>(`/api/workbench/items?kind=${kind}&page=${page}`).then(value => { if (!disposed) setItems(value.items); }).catch(cause => { if (!disposed) setError(cause.message); }); return () => { disposed = true; }; }, [data?.project?.repoUrl, kind, page]);
  async function open(item: GitItem) { setBusy(true); setError(''); try { setSelected((await api<{ item: GitItem }>(`/api/workbench/items?kind=${kind}&number=${item.number}`)).item); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  async function analyze() { if (!selected) return; setBusy(true); setError(''); try { await api('/api/workbench/drafts', { action: 'item', kind: kind === 'issues' ? 'issue' : 'review', number: selected.number }); setNotice('分析草稿已保存，可到规范改进中编辑、审阅后发布。'); changed(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <div className="wb-page"><h1>{kind === 'issues' ? 'Issue 分诊' : 'PR 检查'}</h1><p>{data?.project?.fullName || '请先在项目概览中连接仓库。'} · GitHub 实时数据</p>{!data?.project && <Link href="/overview">连接项目</Link>}{error && <p className="wb-error" role="alert">{error}</p>}
    <label>筛选当前页<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或编号" /></label><section className="wb-card">{items.filter(item => `${item.number} ${item.title}`.toLowerCase().includes(query.toLowerCase())).map(item => <button className="wb-row" disabled={busy} key={item.number} onClick={() => void open(item)}>#{item.number} {item.title}<small>{item.author} · {item.labels.join(' / ') || item.state}</small></button>)}{!items.length && <p>当前页没有数据；如未连接，请先选择项目。</p>}</section>
    <div className="wb-actions"><button className="button button-secondary" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页</span><button className="button button-secondary" disabled={!items.length || busy} onClick={() => setPage(value => value + 1)}>下一页</button></div>
    {selected && <section className="wb-card"><h2>#{selected.number} {selected.title}</h2><a href={selected.url} target="_blank" rel="noopener noreferrer">查看 GitHub 原文</a><pre className="wb-detail">{selected.body || '没有描述'}</pre>{selected.files && <><p>文件列表最多 100 个，单文件 patch 最多 12000 字符，省略内容不纳入分析。</p>{selected.files.map(file => <details key={file.path}><summary>{file.path} · +{file.additions} −{file.deletions}</summary><pre className="wb-detail">{file.patch || 'GitHub 未提供文本 Diff'}</pre></details>)}</>}<button className="button button-primary" disabled={busy} onClick={() => void analyze()}>{busy ? '正在处理…' : 'AI 分析并生成评论草稿'}</button>{notice && <p role="status">{notice} <Link href="/improvements">审阅草稿</Link></p>}</section>}
  </div>;
}
