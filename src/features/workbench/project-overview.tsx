'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

export function ProjectOverview() {
  const { data, error, refresh } = useWorkbench();
  const [url, setUrl] = useState(''), [branch, setBranch] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const runs = data?.runs.filter(run => run.repoUrl === data.project?.repoUrl) || [], latest = runs.find(run => run.report), previous = runs.filter(run => run.report)[1];
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setNotice('');
    try { await api('/api/workbench', { repoUrl: url, branch: branch || undefined }); changed(); await refresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : '连接失败'); } finally { setPending(false); }
  }
  return <div className="wb-page"><p>项目概览</p><h1>{data?.project?.fullName || '连接你的第一个项目'}</h1><p>体检、讨论和修改草稿都围绕同一个真实仓库。</p>
    <form className="wb-card wb-form" onSubmit={connect}><label>GitHub 仓库地址<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder={data?.project?.repoUrl || 'https://github.com/owner/repo'} /></label><label>分支（留空使用默认分支）<input value={branch} onChange={event => setBranch(event.target.value)} maxLength={200} /></label><button className="button button-primary" disabled={pending}>{pending ? '正在连接…' : '连接并切换项目'}</button></form>
    {(error || notice) && <p className="wb-error" role="alert">{error || notice}</p>}
    {data?.project && <><div className="wb-stats"><div className="wb-card"><p>最近任务</p><strong>{runs.length}</strong><p>最多显示最近 20 次</p></div><div className="wb-card"><p>待完善检查</p><strong>{latest?.report?.checks.filter(check => check.status === 'needs_attention').length ?? '—'}</strong><p>{latest?.repository?.sha.slice(0, 7) || '尚未生成报告'}</p></div><div className="wb-card"><p>改进草稿</p><strong>{data.drafts.filter(draft => draft.repoUrl === data.project?.repoUrl && draft.status === 'draft').length}</strong><p>等待审阅与确认</p></div></div>
    <div className="wb-actions"><Link className="button button-primary" href="/audit?new=1">发起项目体检</Link><Link href="/issues">处理 Issue</Link><Link href="/pull-requests">检查 PR</Link><Link href="/improvements">审阅改进草稿</Link></div>
    <section className="wb-card"><h2>体检历史</h2>{!runs.length && <p>尚未体检，发送仓库即可开始。</p>}{runs.map(run => <Link className="wb-row" key={run.id} href={`/audit?run=${run.id}`}>{new Date(run.createdAt).toLocaleString('zh-CN')} · {({ queued: '排队中', running: '执行中', completed: '完成', failed: '失败', cancelled: '已取消' })[run.status]}<small>{run.repository?.sha.slice(0, 7)} · {run.report ? `${run.report.checks.filter(check => check.status === 'needs_attention').length} 项待完善` : run.error || '尚无报告'}</small></Link>)}</section>
    {latest?.report && previous?.report && <section className="wb-card"><h2>最近两次报告对比</h2><p>{previous.repository?.sha.slice(0, 7)} → {latest.repository?.sha.slice(0, 7)} · 仅比较双方均有的检查项，AI 配置变化可能影响结论。</p>{latest.report.checks.map(check => { const before = previous.report!.checks.find(item => item.id === check.id); return before && before.status !== check.status ? <p key={check.id}><strong>{check.title}</strong>：{before.status} → {check.status}</p> : null; })}{latest.report.checks.every(check => { const before = previous.report!.checks.find(item => item.id === check.id); return !before || before.status === check.status; }) && <p>共有检查项的状态没有变化。</p>}</section>}</>}
    <section className="wb-card"><h2>模型用量</h2><p>{data?.usage.calls || 0} 次请求 · 输入 {data?.usage.inputTokens || 0} tokens · 输出 {data?.usage.outputTokens || 0} tokens · 失败 {data?.usage.failures || 0} 次</p><p>仅统计服务返回的 token 用量；自定义模型价格未配置，不推算费用。</p></section>
    <GithubConnection />
  </div>;
}
export function GithubConnection() {
  const { data } = useWorkbench(); const [notice, setNotice] = useState(''), [signedIn, setSignedIn] = useState(false);
  useEffect(() => { void api<{ signedIn: boolean }>('/api/auth/session').then(value => setSignedIn(value.signedIn)).catch(() => {}); }, [data]);
  return <section className="wb-card"><h2>GitHub 账户</h2><p>{data?.github ? `已连接 ${data.github.login} · ${data.github.canWrite ? '已申请仓库授权，实际写入仍取决于仓库权限' : '身份授权'}` : '公开仓库可直接读取；私有仓库和发布需要 GitHub 授权。'}</p><div className="wb-actions"><a className="button button-secondary" href="/api/auth/github">GitHub 登录</a><a className="button button-secondary" href="/api/auth/github?write=1">授权仓库访问与写入</a>{signedIn && <button className="button button-secondary" onClick={async () => { try { await api('/api/auth/session', {}, 'DELETE'); changed(); window.location.assign('/?auth=login'); } catch { setNotice('退出失败，请重试。'); } }}>退出登录</button>}</div><p>授权会跳转 GitHub；发布评论或创建 PR 前仍需审阅并确认。</p>{notice && <p role="alert">{notice}</p>}</section>;
}
