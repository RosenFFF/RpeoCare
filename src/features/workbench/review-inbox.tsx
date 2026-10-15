'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, ChevronLeft, ChevronRight, CircleDot, GitPullRequest, RefreshCw, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import type { GitItem, IssueCategory, IssuePriority, IssueWorkflowStatus } from '@/contracts/workbench';
import { inboxDate, inScope, issueClassification, issuePriorities, issueStates, pullClassification, pullTypes, type InboxScope, type PullType } from './inbox-model';
import { MaintenancePulse } from './maintenance-pulse';
import { PullBranchAtlas, type PullBranchScope } from './pull-branch-atlas';
import { issueAttention, issueCategorySignal, visualCategoryNames, type AttentionProfile, type IssueVisualSignal, type VisualIssueCategory } from './issue-visual-signals';

type Props = {
  kind: 'issues' | 'pulls';
  items: GitItem[];
  page: number;
  connected: boolean;
  busy: boolean;
  loading: boolean;
  hidden: boolean;
  failed: boolean;
  onOpen: (item: GitItem) => void;
  onPage: (page: number) => void;
  onBatch: (numbers: number[]) => void;
  onRefresh?: () => void;
  pullBranches?: PullBranchScope;
};

type InboxMode = 'pulse' | 'list';

export function ReviewInbox({ kind, items, page, connected, busy, loading, hidden, failed, onOpen, onPage, onBatch, onRefresh, pullBranches }: Props) {
  const issues = kind === 'issues';
  const title = issues ? 'Issue' : 'PR';
  const [mode, setMode] = useState<InboxMode>('pulse');
  const [scope, setScope] = useState<InboxScope>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IssueCategory | PullType | 'unknown' | 'all'>('all');
  const [workflow, setWorkflow] = useState<IssueWorkflowStatus | 'all'>('all');
  const [priority, setPriority] = useState<IssuePriority | 'all'>('all');
  const [sort, setSort] = useState(issues ? 'attention' : 'updated');
  const [attentionProfile, setAttentionProfile] = useState<AttentionProfile>('maintenance');
  const [signalTime, setSignalTime] = useState(() => Date.now());
  const [branchFocusHost, setBranchFocusHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (!issues) { setScope('all'); setQuery(''); setCategory('all'); setMode('pulse'); } }, [issues, pullBranches?.selected]);
  useEffect(() => {
    if (!issues || hidden) return;
    const timer = window.setInterval(() => setSignalTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [issues, hidden]);
  const signalsByUrl = useMemo(() => new Map<string, IssueVisualSignal>(issues ? items.map(item => [item.url, { classification: issueCategorySignal(item), attention: issueAttention(item, attentionProfile, signalTime) }]) : []), [items, issues, attentionProfile, signalTime]);
  const scopes: { id: InboxScope; label: string }[] = issues
    ? [{ id: 'all', label: '全部反馈' }, { id: 'untriaged', label: '未分诊' }, { id: 'needs-info', label: '待补充' }, { id: 'ready-to-reproduce', label: '准备复现' }, { id: 'high', label: '高优先级' }]
    : [{ id: 'all', label: '全部变更' }, { id: 'ready', label: 'Open PR' }, { id: 'draft', label: 'Draft PR' }];
  const baseItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(item => {
      const fields = issueClassification(item);
      return (!pullBranches?.selected || item.baseRef === pullBranches.selected) && inScope(item, kind, scope)
        && (!needle || `${item.number} ${item.title} ${item.body} ${item.author} ${item.labels.join(' ')}`.toLowerCase().includes(needle))
        && (!issues || ((workflow === 'all' || fields.status === workflow) && (priority === 'all' || fields.priority === priority)));
    });
  }, [items, kind, issues, scope, query, workflow, priority, pullBranches?.selected]);
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<VisualIssueCategory, number>> = {};
    for (const item of baseItems) {
      const key = signalsByUrl.get(item.url)?.classification.category;
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [baseItems, signalsByUrl]);
  const visible = useMemo(() => {
    return baseItems.filter(item => category === 'all' || (issues ? signalsByUrl.get(item.url)?.classification.category : pullClassification(item)) === category).sort((a, b) => {
      if (issues && sort === 'attention') {
        const delta = (signalsByUrl.get(b.url)?.attention.known ?? 0) - (signalsByUrl.get(a.url)?.attention.known ?? 0);
        if (delta) return delta;
      }
      if (sort === 'priority') {
        const weight = { high: 0, medium: 1, low: 2, unknown: 3 };
        const delta = weight[issueClassification(a).priority] - weight[issueClassification(b).priority];
        if (delta) return delta;
      }
      return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    });
  }, [baseItems, issues, category, sort, signalsByUrl]);
  const filtered = scope !== 'all' || !!query || category !== 'all' || workflow !== 'all' || priority !== 'all';
  const pending = visible.filter(item => !item.triage || item.triage.sourceUpdatedAt !== item.updatedAt).slice(0, 12).map(item => item.number);

  function reset() {
    setScope('all');
    setQuery('');
    setCategory('all');
    setWorkflow('all');
    setPriority('all');
  }

  if (!connected) return <section className="workspace-onboarding review-onboarding" aria-label={`${title} 工作区`} aria-busy={loading}>
    <div className="workspace-onboarding-copy">
      <span className="workspace-onboarding-icon">{issues ? <CircleDot size={22} /> : <GitPullRequest size={22} />}</span>
      <div className="eyebrow"><span className="tiny-square" /> {issues ? '协作审阅 / Issue' : '协作审阅 / Pull Request'}</div>
      <h2>{loading ? '正在准备协作工作区' : '连接项目后，再开始审阅'}</h2>
      <p>{loading ? '正在确认当前工作区与项目连接状态。' : issues ? '连接 GitHub 仓库后，分诊工作地图会按下一步处理动作整理真实反馈。' : '连接 GitHub 仓库后，变更汇流图会呈现提交、文件改动、CI 与审查证据。'}</p>
      {!loading && <div className="workspace-onboarding-actions"><Link className="button button-primary" href="/projects">连接 GitHub 项目<ArrowRight size={14} /></Link><Link className="button button-secondary" href="/overview">返回项目概览</Link></div>}
    </div>
    <aside className="workspace-onboarding-flow" aria-label="协作审阅流程"><span>REVIEW FLOW</span><ol><li><span>01</span><div><strong>读取真实内容</strong><p>保留 Issue、评论、Diff 与检查状态。</p></div></li><li><span>02</span><div><strong>核对证据</strong><p>区分原始事实、机器建议与未知信息。</p></div></li><li><span>03</span><div><strong>维护者确认</strong><p>编辑草稿并确认后，才进入交付动作。</p></div></li></ol></aside>
  </section>;

  const canvasMode = mode === 'pulse';
  const shortcutScopes = issues && canvasMode ? scopes.filter(view => {
    if (view.id === 'all' || view.id === scope) return true;
    const count = items.filter(item => inScope(item, kind, view.id)).length;
    return count > 0 && count < items.length;
  }) : scopes;
  const scopeControls = <div className="inbox-scopes" role="group" aria-label={`${title} 快捷视图`}>{shortcutScopes.map(view => <button type="button" key={view.id} aria-pressed={scope === view.id} onClick={() => { setScope(view.id); setCategory('all'); setWorkflow('all'); setPriority('all'); }}><span>{view.label}</span><span className="inbox-count">{items.filter(item => inScope(item, kind, view.id)).length}</span></button>)}</div>;
  const searchControl = <label className="inbox-search"><Search size={16} aria-hidden="true" /><input aria-label={`搜索 ${title}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、编号、作者或标签" /><span className="inbox-search-key">筛选本页</span></label>;
  const typeControl = <label className="inbox-filter"><SlidersHorizontal size={14} aria-hidden="true" /><span>{issues ? '类别（含线索）' : '变更类型'}</span><select aria-label={issues ? '类别（含线索）' : '变更类型'} value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">全部类型</option>{Object.entries(issues ? visualCategoryNames : pullTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
  const empty = !loading && !visible.length;
  return <section className={`review-inbox${canvasMode ? issues ? ' is-issue-canvas' : ' is-pr-canvas' : ''}`} aria-label={`${title} 工作区`} hidden={hidden} inert={hidden ? true : undefined}>
    {!issues && pullBranches && <PullBranchAtlas scope={pullBranches} busy={busy} hidden={hidden} focusHost={branchFocusHost}/>}
    {(!pullBranches || pullBranches.selected !== null) && <>
    {canvasMode ? <div className="inbox-canvas-toolbar">
      {!issues && pullBranches && <div className="inbox-branch-slot" ref={setBranchFocusHost} />}
      {scopeControls}{searchControl}{issues ? <details className="inbox-canvas-filters"><summary><SlidersHorizontal size={14} aria-hidden="true" />筛选</summary><div>
        {typeControl}<label className="inbox-filter"><span>处理状态</span><select aria-label="处理状态筛选" value={workflow} onChange={event => { setWorkflow(event.target.value as typeof workflow); setScope('all'); }}><option value="all">全部状态</option>{Object.entries(issueStates).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="inbox-filter"><span>优先级</span><select aria-label="优先级筛选" value={priority} onChange={event => { setPriority(event.target.value as typeof priority); setScope('all'); }}><option value="all">全部优先级</option>{Object.entries(issuePriorities).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="inbox-filter"><span>排序</span><select aria-label="列表排序" value={sort} onChange={event => setSort(event.target.value)}><option value="attention">按关注分</option><option value="updated">最近更新</option><option value="priority">优先级优先</option></select></label>
      </div></details> : typeControl}<span className="inbox-canvas-count" title="仅统计当前页筛选结果">{visible.length}/{items.length}</span>
      {filtered && <button type="button" className="inbox-canvas-reset" aria-label={`清除 ${title} 筛选`} onClick={reset}><X size={15} aria-hidden="true" /></button>}
      {issues && <button type="button" className="inbox-canvas-batch" disabled={busy || loading || !pending.length} title="每次最多分诊 12 条" aria-label={`分诊当前筛选前 ${pending.length} 条 Issue，每次最多 12 条`} onClick={() => onBatch(pending)}>分诊 {pending.length} 条</button>}
      <button type="button" className="inbox-canvas-list" title="切换列表" aria-label={`切换 ${title} 列表`} onClick={() => setMode('list')}><Rows3 size={15} aria-hidden="true" /><span>列表</span></button>
      {onRefresh && <button type="button" className="inbox-canvas-list" disabled={busy || loading} aria-label={`刷新 ${title}`} title={`刷新 ${title}`} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" /></button>}
    </div> : <>
    <div className="inbox-views">
      {scopeControls}
      <div className="inbox-view-meta"><span className="inbox-local-note">当前页 · 开放中的{issues ? '反馈' : '变更'}</span><div className="inbox-mode-switch" role="group" aria-label="展示方式"><button type="button" aria-pressed={false} onClick={() => setMode('pulse')}><Activity size={13} aria-hidden="true" />{issues ? '工作地图' : '分支变更图'}</button><button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}><Rows3 size={13} aria-hidden="true" />列表</button></div>{onRefresh && <button type="button" className="inbox-canvas-list" disabled={busy || loading} aria-label={`刷新 ${title}`} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" /></button>}</div>
    </div>
    <div className="inbox-toolbar">
      {searchControl}
      {typeControl}
      {issues && <><label className="inbox-filter"><span>处理状态</span><select aria-label="处理状态筛选" value={workflow} onChange={event => { setWorkflow(event.target.value as typeof workflow); setScope('all'); }}><option value="all">全部状态</option>{Object.entries(issueStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="inbox-filter"><span>优先级</span><select aria-label="优先级筛选" value={priority} onChange={event => { setPriority(event.target.value as typeof priority); setScope('all'); }}><option value="all">全部优先级</option>{Object.entries(issuePriorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
      <label className="inbox-filter inbox-sort"><span>排序</span><select aria-label="列表排序" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近更新</option>{issues && <><option value="attention">按关注分</option><option value="priority">优先级优先</option></>}</select></label>
    </div>
    <div className="inbox-summary"><div><h2>{issues ? '待处理反馈' : '待审查变更'}</h2><span>显示 {visible.length} / {items.length}</span>{filtered && <button type="button" onClick={reset}><X size={12} aria-hidden="true" />清除筛选</button>}</div>{issues ? <button type="button" className="button button-secondary" disabled={busy || loading || !pending.length} onClick={() => onBatch(pending)}>分诊当前筛选<span className="inbox-batch-count">{pending.length}</span></button> : <span className="inbox-caption">阶段来自真实检查证据，未知状态保持未知</span>}</div>
    </>}

    {loading && !visible.length ? <div className="inbox-empty" role="status"><span className="inbox-empty-icon">{issues ? <CircleDot size={22} /> : <GitPullRequest size={22} />}</span><h3>正在读取 {title} 数据…</h3><p>保留真实数据，不填充演示记录。</p></div> : empty ? <div className="inbox-empty"><span className="inbox-empty-icon">{issues ? <CircleDot size={22} /> : <GitPullRequest size={22} />}</span><h3>{failed ? '数据暂时无法读取' : filtered ? '没有符合筛选条件的记录' : issues ? '分诊工作地图当前没有开放反馈' : '此分支当前页没有开放 PR'}</h3><p>{failed ? '查看上方错误信息，重试刷新；这不代表仓库没有数据。' : filtered ? '筛选只作用于当前页；换页可以继续查看其他记录。' : '没有待处理记录时无需发起分析，也不会显示空详情面板。'}</p>{filtered && <button className="button button-secondary" type="button" onClick={reset}>重置筛选</button>}</div> : mode === 'pulse' ? <MaintenancePulse kind={kind} items={visible} busy={busy} onOpen={onOpen} baseBranch={pullBranches?.selected || undefined} signals={{ byUrl: signalsByUrl, counts: categoryCounts, category: category as VisualIssueCategory | 'all', onCategory: setCategory, profile: attentionProfile, onProfile: value => { setAttentionProfile(value); setSort('attention'); }, attentionSorted: sort === 'attention' }} /> : <>
      <div className={`inbox-columns ${issues ? 'is-issues' : 'is-pulls'}`} aria-hidden="true"><span>{issues ? '反馈内容' : '变更内容'}</span><span>{issues ? '类别（含线索）' : '变更类型'}</span><span>{issues ? '处理状态' : 'PR 状态'}</span><span>{issues ? '优先级' : 'Head 提交'}</span><span>更新</span><span /></div>
      <div className="inbox-rows" aria-busy={loading}>{visible.map(item => {
        const fields = issueClassification(item);
        const pullType = pullClassification(item);
        const visualType = signalsByUrl.get(item.url)?.classification;
        return <button id={`inbox-row-${kind}-${item.number}`} data-item-number={item.number} className={`inbox-row ${issues ? 'is-issues' : 'is-pulls'}`} type="button" key={item.number} onClick={() => onOpen(item)} disabled={busy}>
          <span className="inbox-subject"><span className="inbox-subject-line"><span className="inbox-item-icon" aria-hidden="true">{issues ? <CircleDot size={17} /> : <GitPullRequest size={17} />}</span><span className="inbox-number">#{item.number}</span><strong title={item.title}>{item.title}</strong></span><span className="inbox-subject-meta">{item.author || '未知作者'}{issues && <span> · {item.commentCount ?? item.comments?.length ?? 0} 条评论</span>}{!issues && item.headRef && <span> · {item.headRef} → {item.baseRef || 'base'}</span>}{fields.stale && issues && <span className="inbox-stale"> · 原文有更新</span>}</span>{item.labels.length > 0 && <span className="inbox-labels">{item.labels.slice(0, 3).map(label => <span key={label}>{label}</span>)}{item.labels.length > 3 && <span>+{item.labels.length - 3}</span>}</span>}</span>
          <span className="inbox-cell"><span className="inbox-cell-label">{issues ? '类型' : '变更类型'}</span><span className={`inbox-tag ${issues ? `tone-${visualType?.category || 'none'}` : `tone-${pullType}`}`}>{issues ? visualType ? visualCategoryNames[visualType.category] : '待确认' : pullTypes[pullType]}</span>{issues && <small title={visualType?.reason}>{visualType?.source ?? fields.source}</small>}</span>
          <span className="inbox-cell"><span className="inbox-cell-label">状态</span><span className={`inbox-state state-${issues ? fields.status : item.isDraft ? 'draft' : 'open'}`}><i aria-hidden="true" />{issues ? issueStates[fields.status] : item.isDraft ? 'Draft' : 'Open'}</span></span>
          <span className="inbox-cell"><span className="inbox-cell-label">{issues ? '优先级' : '提交'}</span>{issues ? <span className={`inbox-priority priority-${fields.priority}`}><i aria-hidden="true" />{issuePriorities[fields.priority]}</span> : <code>{item.headSha?.slice(0, 7) || '待读取'}</code>}</span>
          <span className="inbox-updated"><span className="inbox-cell-label">更新</span>{inboxDate(item.updatedAt)}</span><ChevronRight className="inbox-open" size={16} aria-hidden="true" />
        </button>;
      })}</div>
    </>}
    <footer className="inbox-footer"><span>{mode === 'pulse' ? issues ? '按已有处理状态分流，点击问题查看依据与下一步' : '连线表示目标分支，节点状态依据已读取证据' : issues ? '分类是建议，处理由维护者决定' : '先审阅证据，再决定是否发布评论'}</span><nav aria-label={`${title} 分页`}><button type="button" disabled={page === 1 || busy || loading} onClick={() => onPage(page - 1)} aria-label={`上一页 ${title}`}><ChevronLeft size={15} /></button><span>第 {page} 页{!issues && pullBranches && ' · 每页最多 30 条'}{page >= 100 && ' · 已达读取上限'}</span><button type="button" disabled={page >= 100 || (issues ? !items.length : pullBranches ? !pullBranches.hasNext : !items.length) || busy || loading} onClick={() => onPage(page + 1)} aria-label={`下一页 ${title}`}><ChevronRight size={15} /></button></nav></footer>
    </>}
  </section>;
}
