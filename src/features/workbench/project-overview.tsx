'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, GitBranch, GitFork, MessagesSquare, GitPullRequest, FileCheck2, History, Activity } from 'lucide-react';
import { api, changed, useWorkbench } from './client';
import './workbench.css';

const statuses = { queued: '排队中', running: '执行中', completed: '完成', failed: '失败', cancelled: '已取消' };
const checkStatuses = { pass: '通过', needs_attention: '待完善', unknown: '无法判断' };

export function ProjectOverview() {
  const { data, error, refresh } = useWorkbench();
  const [url, setUrl] = useState(''), [branch, setBranch] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const project = data?.project;
  const runs = data?.runs.filter(run => run.repoUrl === project?.repoUrl) || [];
  const latest = runs.find(run => run.report), previous = runs.filter(run => run.report)[1];
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setNotice('');
    try { await api('/api/workbench', { repoUrl: url, branch: branch || undefined }); changed(); await refresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : '连接失败'); } finally { setPending(false); }
  }
  return <div className="wb-page wb-overview">
    <header className="wb-overview-header">
      <div><h1>{project?.fullName || '连接你的第一个项目'}</h1><p>{project ? '查看维护进展，继续处理项目中的问题。' : '从一个 GitHub 仓库开始，集中管理体检、讨论与改进。'}</p></div>
      {project && <Link className="button button-primary" href="/audit?new=1"><Activity size={16} />发起项目体检</Link>}
    </header>
    <section className="wb-connect-panel" aria-labelledby="wb-connect-heading">
      <div className="wb-section-title"><div><h2 id="wb-connect-heading"><GitBranch size={18} />{project ? '当前仓库' : '连接仓库'}</h2><p>{project ? `${project.repoUrl} · ${project.branch || '默认分支'}` : '公开仓库粘贴地址即可连接，私有仓库请先授权 GitHub。'}</p></div></div>
      <form className="wb-connect-form" onSubmit={connect}>
        <label>GitHub 仓库地址<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder={project?.repoUrl || 'https://github.com/owner/repository'} autoComplete="off" spellCheck={false} /></label>
        <label>分支 <span>可选</span><input value={branch} onChange={event => setBranch(event.target.value)} maxLength={200} placeholder="默认分支" /></label>
        <button className="button button-primary" disabled={pending}>{pending ? '正在连接…' : project ? '连接并切换项目' : '连接项目'}</button>
      </form>
      {(error || notice) && <p className="wb-error" role="alert">{error || notice}</p>}
    </section>
    <div className="wb-overview-grid">
      <div className="wb-overview-main">
        {project && <dl className="wb-project-metrics">
          <div><dt>最近任务</dt><dd>{runs.length}</dd><small>最近 20 次记录</small></div>
          <div><dt>待完善检查</dt><dd>{latest?.report?.checks.filter(check => check.status === 'needs_attention').length ?? '—'}</dd><small>{latest?.repository?.sha.slice(0, 7) || '等待首次体检'}</small></div>
          <div><dt>待审阅草稿</dt><dd>{data.drafts.filter(draft => draft.repoUrl === project.repoUrl && draft.status === 'draft').length}</dd><small>确认后发布到 GitHub</small></div>
        </dl>}
        <section className="wb-history" aria-labelledby="wb-history-heading">
          <div className="wb-section-title"><h2 id="wb-history-heading">体检记录</h2>{runs.length > 0 && <Link href="/audit">全部任务<ArrowUpRight size={14} /></Link>}</div>
          {!runs.length ? <div className="wb-history-empty"><History size={28} strokeWidth={1.4} /><h3>{project ? '开始第一次项目体检' : '你的维护记录，从这里开始'}</h3><p>{project ? '检查维护文档与工程配置，生成有文件依据的报告。' : '连接仓库后，每次体检的结论、依据与改进进展都会保留在这里。'}</p>{project ? <Link className="button button-secondary" href="/audit?new=1">开始体检</Link> : <p className="wb-empty-hint">先在上方连接项目</p>}</div>
            : runs.map(run => <Link className="wb-history-row" key={run.id} href={`/audit?run=${run.id}`}><FileCheck2 size={18} /><div><strong>{run.report ? `${run.report.checks.filter(check => check.status === 'needs_attention').length} 项待完善` : run.error || '项目体检'}</strong><small>{new Date(run.createdAt).toLocaleString('zh-CN')} {run.repository?.sha && ` · ${run.repository.sha.slice(0, 7)}`}</small></div><span className={`wb-run-status wb-run-${run.status}`}>{statuses[run.status]}</span><ArrowUpRight size={15} /></Link>)}
        </section>
        {latest?.report && previous?.report && <section className="wb-comparison"><h2>最近两次报告对比</h2><p>{previous.repository?.sha.slice(0, 7)} → {latest.repository?.sha.slice(0, 7)} · 仅比较共有检查项，AI 配置变化可能影响结论。</p>{latest.report.checks.map(check => { const before = previous.report!.checks.find(item => item.id === check.id); return before && before.status !== check.status ? <p key={check.id}><strong>{check.title}</strong>：{checkStatuses[before.status]} → {checkStatuses[check.status]}</p> : null; })}{latest.report.checks.every(check => { const before = previous.report!.checks.find(item => item.id === check.id); return !before || before.status === check.status; }) && <p>共有检查项的状态没有变化。</p>}</section>}
        <nav className="wb-maintenance-links" aria-label="项目维护入口">
          <Link href="/issues"><MessagesSquare size={19} /><div><strong>Issue 分诊</strong><span>查看讨论，准备回复</span></div><ArrowUpRight size={15} /></Link>
          <Link href="/pull-requests"><GitPullRequest size={19} /><div><strong>PR 检查</strong><span>核对变更，生成审阅草稿</span></div><ArrowUpRight size={15} /></Link>
          <Link href="/improvements"><FileCheck2 size={19} /><div><strong>草稿与交付</strong><span>编辑草稿，确认后交付</span></div><ArrowUpRight size={15} /></Link>
        </nav>
      </div>
      <aside className="wb-overview-aside" aria-label="账户与模型">
        <GithubConnection />
        <section className="wb-usage"><div className="wb-section-title"><h2>模型用量</h2><Link href="/settings">管理模型<ArrowUpRight size={14} /></Link></div>
          <dl><div><dt>请求次数</dt><dd>{data?.usage.calls || 0}<small>次</small></dd></div><div><dt>失败请求</dt><dd>{data?.usage.failures || 0}<small>次</small></dd></div><div><dt>输入 tokens</dt><dd>{(data?.usage.inputTokens || 0).toLocaleString()}</dd></div><div><dt>输出 tokens</dt><dd>{(data?.usage.outputTokens || 0).toLocaleString()}</dd></div></dl>
          <p>用量由模型服务返回，暂不估算费用。</p>
        </section>
      </aside>
    </div>
  </div>;
}

export function GithubConnection() {
  const { data } = useWorkbench(); const [notice, setNotice] = useState(''), [signedIn, setSignedIn] = useState(false);
  useEffect(() => { void api<{ signedIn: boolean }>('/api/auth/session').then(value => setSignedIn(value.signedIn)).catch(() => {}); }, [data]);
  return <section className="wb-card wb-github"><div className="wb-section-title"><h2><GitFork size={18} />GitHub 账户</h2><span className="wb-connection-state">{data?.github ? '已连接' : '未连接'}</span></div><p>{data?.github ? `${data.github.login} · ${data.github.canWrite ? '已授权仓库访问，写入取决于仓库权限' : '已登录，尚未授权仓库访问'}` : '连接账户后，可访问私有仓库并发布已确认的改进。'}</p><div className="wb-actions"><a className="button button-secondary" href="/api/auth/github">GitHub 登录</a><a className="wb-authorization-link" href="/api/auth/github?write=1">授权仓库访问与写入<ArrowUpRight size={14} /></a>{signedIn && <button className="button button-secondary" onClick={async () => { try { await api('/api/auth/session', {}, 'DELETE'); changed(); window.location.assign('/?auth=login'); } catch { setNotice('退出失败，请重试。'); } }}>退出登录</button>}</div><p className="wb-github-note">每次发布评论或创建 PR，都会先请你确认。</p>{notice && <p className="wb-error" role="alert">{notice}</p>}</section>;
}

