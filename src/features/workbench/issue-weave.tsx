'use client';

import { useState } from 'react';
import { ArrowUpRight, Layers, Link2, MessageSquare, Sparkles } from 'lucide-react';
import type { GitItem, IssueWorkflowStatus } from '@/contracts/workbench';
import { inboxDate, issueCategories, issueClassification, issuePriorities, issueStates } from './inbox-model';
import './issue-weave.css';

type Props = { items: GitItem[]; busy: boolean; onOpen: (item: GitItem) => void };
type Phase = 'receive' | 'clarify' | 'verify' | 'act';
const phases: { id: Phase; label: string; description: string }[] = [
  { id: 'receive', label: '接收反馈', description: '未分诊与人工审阅' },
  { id: 'clarify', label: '补齐信息', description: '等待补充关键线索' },
  { id: 'verify', label: '调查验证', description: '待调查与准备复现' },
  { id: 'act', label: '回复处理', description: '准备回复与已回复' },
];
const phaseByStatus: Record<IssueWorkflowStatus, Phase> = {
  untriaged: 'receive', 'manual-review': 'receive', 'needs-info': 'clarify',
  investigate: 'verify', 'ready-to-reproduce': 'verify', 'ready-to-reply': 'act', replied: 'act',
};
function commentCount(item: GitItem) { return Math.max(0, item.commentCount ?? item.comments?.length ?? 0); }
function recent(item: GitItem) {
  const elapsed = Date.now() - Date.parse(item.updatedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 72 * 60 * 60 * 1000;
}

export function IssueWeave({ items, busy, onOpen }: Props) {
  const [grouping, setGrouping] = useState<'phase' | 'category'>('phase');
  const [compact, setCompact] = useState(false);
  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const phaseGroups = phases.map(phase => ({ ...phase, items: items.filter(item => phaseByStatus[issueClassification(item).status] === phase.id) }));
  const categoryGroups = [...Object.entries(issueCategories), ['unknown', '待分类']].map(([id, label]) => ({
    id, label, description: id === 'unknown' ? '保留未知，等待实际分诊' : '按已有分诊结果组织',
    items: items.filter(item => (issueClassification(item).category ?? 'unknown') === id),
  }));
  const groups = (grouping === 'phase' ? phaseGroups : categoryGroups).filter(group => group.items.length);
  const active = items.find(item => item.number === activeNumber) ?? items[0];
  const activeFields = active ? issueClassification(active) : null;
  const discussions = items.reduce((sum, item) => sum + commentCount(item), 0);
  const linked = items.filter(item => item.relatedPulls?.length).length;
  const priorities = items.filter(item => issueClassification(item).priority === 'high').length;

  return <section className={`issue-weave${compact ? ' is-compact' : ''}`} aria-label="Issue 问题信号织图">
    <header className="weave-heading">
      <div><h3><Layers size={19} aria-hidden="true" />问题信号织图</h3><p>把每一条反馈展开，让讨论和处理线索变得可见。</p></div>
      <div className="weave-totals" aria-label="当前筛选摘要"><span><b>{items.length}</b> 条反馈</span><span><b>{discussions}</b> 条评论</span><span><b>{priorities}</b> 高优先级</span><span><b>{linked}</b> 关联 PR</span></div>
    </header>

    <div className="weave-distribution" aria-label="当前筛选的处理阶段分布">
      <div className="weave-proportion" aria-hidden="true">{phaseGroups.filter(group => group.items.length).map(group => <span key={group.id} data-phase={group.id} style={{ flexGrow: group.items.length }} />)}</div>
      <div className="weave-phase-key">{phaseGroups.map(group => <span key={group.id} data-phase={group.id}><i aria-hidden="true" /><span>{group.label}</span><b>{group.items.length}</b></span>)}</div>
    </div>

    <div className="weave-controls">
      <div role="group" aria-label="织图分组"><button type="button" aria-pressed={grouping === 'phase'} onClick={() => setGrouping('phase')}>按处理阶段</button><button type="button" aria-pressed={grouping === 'category'} onClick={() => setGrouping('category')}>按问题类型</button></div>
      <button type="button" className="weave-density" aria-pressed={compact} onClick={() => setCompact(!compact)}>{compact ? '舒展浏览' : '紧凑浏览'}</button>
    </div>

    {active && activeFields && <div className="weave-inspector" aria-label="当前观察的 Issue">
      <div className="weave-inspector-number"><span>正在观察</span><b>#{active.number}</b></div>
      <div className="weave-inspector-copy"><strong>{active.title}</strong><span>{issueStates[activeFields.status]}<i />{issuePriorities[activeFields.priority]}<i />{activeFields.source}{activeFields.stale ? '，原文有更新' : ''}</span>{Boolean(active.relatedPulls?.length) && <small><Link2 size={12} aria-hidden="true" />历史审查关联：{active.relatedPulls?.map(pull => `PR #${pull.number}`).join('、')}</small>}</div>
      <button type="button" disabled={busy} onClick={() => onOpen(active)}>进入分诊<ArrowUpRight size={15} aria-hidden="true" /></button>
    </div>}

    <div className="weave-groups">
      {groups.map(group => <section className="weave-group" key={group.id} aria-label={`${group.label}，${group.items.length} 条 Issue`}>
        <header><h4>{group.label}<span>{group.items.length}</span></h4><p>{group.description}</p><div className="weave-group-thread" aria-hidden="true" /></header>
        <div className="weave-mosaic">
          {group.items.map(item => {
            const fields = issueClassification(item);
            const comments = commentCount(item);
            const expanded = !compact && comments >= 6;
            const linkedCount = item.relatedPulls?.length ?? 0;
            return <button type="button" key={item.number} id={`inbox-row-issues-${item.number}`} data-item-number={item.number}
              className={`weave-tile priority-${fields.priority}${expanded ? ' is-expanded' : ''}${active?.number === item.number ? ' is-observed' : ''}${fields.stale ? ' is-stale' : ''}`}
              disabled={busy} onMouseEnter={() => setActiveNumber(item.number)} onFocus={() => setActiveNumber(item.number)} onClick={() => onOpen(item)}
              aria-label={`Issue #${item.number}，${item.title}，${issueStates[fields.status]}，${issuePriorities[fields.priority]}，${comments} 条评论${fields.stale ? '，原文有更新' : ''}`}>
              <span className="weave-tile-top"><b>#{item.number}</b><span className="weave-priority"><i aria-hidden="true" />{issuePriorities[fields.priority]}</span>{recent(item) && <span className="weave-recent"><Sparkles size={11} aria-hidden="true" />近期</span>}</span>
              <strong className="weave-title">{item.title}</strong>
              <span className="weave-tile-kind">{fields.category ? issueCategories[fields.category] : '待分类'}{fields.stale && <em>原文有更新</em>}</span>
              <span className="weave-discussion"><span className="weave-grains" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} className={index < comments ? 'is-filled' : ''} />)}</span><span><MessageSquare size={12} aria-hidden="true" />{comments}</span></span>
              <span className="weave-tile-bottom"><span>{inboxDate(item.updatedAt)} 更新</span>{linkedCount > 0 ? <span><Link2 size={12} aria-hidden="true" />{linkedCount} PR</span> : <ArrowUpRight size={13} aria-hidden="true" />}</span>
            </button>;
          })}
        </div>
      </section>)}
    </div>

    <footer className="weave-legend"><span><i className="weave-grain-sample" />一颗实心粒 = 一条评论，最多显示 16 颗</span><span>{compact ? '紧凑模式统一版面' : '6 条及以上评论展开为宽幅单元'}</span><span>悬停或聚焦查看完整标题，点击进入分诊</span></footer>
  </section>;
}
