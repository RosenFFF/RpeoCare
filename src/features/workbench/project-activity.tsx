'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Bell, CheckCircle2, CircleAlert, Clock3, ListChecks, RefreshCw } from 'lucide-react';
import type { ActivityItem, ActivityState } from '@/contracts/activity';
import { useActivityFeed } from './use-project-activity';
import './project-activity.css';

const labels: Record<ActivityState, string> = { attention: '需要处理', review: '等待审阅', running: '进行中', complete: '已有结果' };
const icons = { attention: CircleAlert, review: ListChecks, running: Clock3, complete: CheckCircle2 };

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen?: () => void }) {
  const Icon = icons[item.state];
  return <a className={`pa-row is-${item.state}`} href={item.href} onClick={onOpen}>
    <span className="pa-icon"><Icon size={18} aria-hidden="true" /></span>
    <div className="pa-copy"><div><span className="pa-status">{labels[item.state]}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><strong>{item.title}</strong><p>{item.detail}</p></div>
    <span className="pa-action">{item.action}<ArrowRight size={15} aria-hidden="true" /></span>
  </a>;
}

export function ProjectActivityPanel() {
  const feed = useActivityFeed();
  const [filter, setFilter] = useState<'todo' | 'running' | 'complete'>('todo');
  const [expanded, setExpanded] = useState(false);
  if (!feed) return null;
  const { data, error } = feed;
  const items = data?.items || [];
  const groups = { todo: items.filter(item => ['attention', 'review'].includes(item.state)), running: items.filter(item => item.state === 'running'), complete: items.filter(item => item.state === 'complete') };
  const selected = groups[filter];
  return <section className="pa-panel" aria-labelledby="pa-title">
    <header className="pa-heading"><div><span>继续维护</span><h2 id="pa-title">接下来，处理这些事</h2><p>当前项目的近期记录。打开事项可继续处理，不会自动执行或调用模型。</p></div><button type="button" className="button button-secondary" onClick={feed.refresh}><RefreshCw size={15} aria-hidden="true" />刷新</button></header>
    {error ? <p className="pa-message" role="alert">{error}</p> : !data ? <p className="pa-message" role="status">正在读取维护记录…</p> : <>
      <div className="pa-filters" role="group" aria-label="筛选维护记录">{([['todo', '待处理'], ['running', '进行中'], ['complete', '已有结果']] as const).map(([value, title]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setExpanded(false); }}>{title}<span>{groups[value].length}</span></button>)}</div>
      {selected.length ? <div className="pa-list">{(expanded ? selected : selected.slice(0, 4)).map(item => <ActivityRow key={item.id} item={item} />)}</div> : <div className="pa-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>{filter === 'todo' ? '近期记录中没有待处理事项' : filter === 'running' ? '当前没有正在进行的任务' : '暂时没有已完成的记录'}</strong><p>{filter === 'todo' ? '可以查看已有结果，或从 Issue 中选择下一项维护工作。' : '任务状态会自动刷新，离开页面后仍会保留。'}</p></div>{filter === 'todo' && <Link href="/issues">查看 Issue<ArrowRight size={14} aria-hidden="true" /></Link>}</div>}
      {selected.length > 4 && <button type="button" className="pa-more" onClick={() => setExpanded(!expanded)}>{expanded ? '收起近期记录' : `展开其余 ${selected.length - 4} 项`}</button>}
      {!data.modelConfigured && <div className="pa-setup"><div><strong>准备使用 AI 调查？先配置模型</strong><p>基础体检和已有记录可以直接使用。模型连接只在主动发起分析时调用。</p></div><Link className="button button-secondary" href="/settings?section=models&returnTo=%2Foverview">配置模型<ArrowRight size={14} aria-hidden="true" /></Link></div>}
      <details className="pa-prerequisites"><summary>使用条件：模型、GitHub 与隔离执行</summary><ul><li>AI 调查：{data.modelConfigured ? '已有默认模型配置，实际连接是否可用需主动测试。' : '尚未配置默认模型。'}{!data.workerOnline && ' 调查服务当前离线，请启动后台 Worker。'}</li><li>GitHub：公开仓库可读取；私有仓库和发布操作需要相应授权。<Link href="/settings?section=github&returnTo=%2Foverview">管理 GitHub 账户</Link></li><li>隔离执行：{data.sandboxConfigured && data.reproductionWorkerOnline ? '执行服务已启用，具体依赖和 Docker 状态仍需任务预检。' : '需要启用 Docker 沙箱并启动复现 Worker。'}每次执行前仍需审阅并确认计划。</li></ul></details>
    </>}
  </section>;
}

export function ActivityNotifications({ onOpen }: { onOpen: () => void }) {
  const feed = useActivityFeed();
  if (!feed) return null;
  return <div className="pa-notifications">
    <div className="pa-notification-heading"><p>当前项目的近期任务与结果</p><button type="button" onClick={feed.markRead} disabled={!feed.unread}>标为已读</button></div>
    {feed.error ? <p className="pa-message" role="alert">{feed.error}<button type="button" onClick={feed.refresh}>重新读取</button></p> : !feed.data ? <p className="pa-message" role="status">正在读取…</p> : feed.data.items.length ? <div className="pa-list">{feed.data.items.map(item => <ActivityRow key={item.id} item={item} onOpen={onOpen} />)}</div> : <div className="pa-empty"><Bell size={24} aria-hidden="true" /><div><strong>暂无任务动态</strong><p>体检、调查、验证和草稿保存后，相关状态会显示在这里。</p></div></div>}
    <p className="pa-footnote">仅展示近期保存记录；“已有结果”不表示候选已通过全部测试。已读状态保存在当前浏览器。</p>
  </div>;
}
