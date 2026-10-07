'use client';
import Link from 'next/link';
import { BrandMark } from '@/shared/components/brand-mark';
import { useWorkbench } from './client';
import { RepositoryChooser } from './repository-chooser';

export function ProjectsPage() {
  const { data, error, refresh } = useWorkbench();
  return <main className="projects-page" id="main-content">
    <header className="projects-header"><Link href="/" className="brand" aria-label="返回 RepoCare 首页"><BrandMark/><span>RepoCare<span className="brand-dot">.</span></span></Link><span className="projects-account">{data?.github ? `GitHub · ${data.github.login}` : '项目连接'}</span></header>
    <section className="projects-intro"><h1>{data?.project ? '选择要维护的项目' : '先选一个要维护的项目'}</h1><p>从 GitHub 账户仓库中选择，或粘贴公开仓库地址。连接后进入工作台，体检与 AI 分析由你主动发起。</p></section>
    {error ? <div className="repo-state" role="alert"><p>{error}</p><button className="button button-primary" type="button" onClick={() => void refresh()}>重新读取工作区</button></div> : !data ? <p role="status">正在读取账户信息…</p> : <RepositoryChooser github={data.github} currentProject={data.project?.fullName} onConnected={() => window.location.assign('/workspace')}/>}
    {data?.project && <Link className="repo-login" href="/workspace">返回当前项目工作台</Link>}
  </main>;
}
