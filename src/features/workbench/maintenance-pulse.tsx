'use client';

import { ArrowUpRight, GitBranch, Link2, MessageSquare, ShieldAlert } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes } from './inbox-model';
import { IssueWeave } from './issue-weave';

type Props = {
  kind: 'issues' | 'pulls';
  items: GitItem[];
  busy: boolean;
  onOpen: (item: GitItem) => void;
};
type PullStage = 'draft' | 'evidence' | 'checks' | 'review';

const pullStages: { id: PullStage; step: string; title: string; description: string }[] = [
  { id: 'draft', step: '01', title: '草稿', description: '仍在组织变更' },
  { id: 'evidence', step: '02', title: '证据待读取', description: '进入详情获取 Diff 与 CI' },
  { id: 'checks', step: '03', title: '检查处理中', description: '运行中或存在阻塞' },
  { id: 'review', step: '04', title: '可进入审查', description: '检查完成，等待维护者判断' },
];

function checkSummary(item: GitItem) {
  const checks = item.checks || [];
  if (!checks.length) return { stage: 'evidence' as const, tone: 'unknown', label: item.reviewSnapshot?.state === 'stale' ? '审查证据已过期' : '打开后读取证据' };
  const failed = checks.filter(check => check.status === 'completed' && check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion)).length;
  const pending = checks.filter(check => check.status !== 'completed' || !check.conclusion).length;
  if (failed) return { stage: 'checks' as const, tone: 'failed', label: `${failed} 项检查未通过` };
  if (pending) return { stage: 'checks' as const, tone: 'pending', label: `${pending} 项检查进行中` };
  return { stage: 'review' as const, tone: 'passed', label: `${checks.length} 项检查完成` };
}

function pullStage(item: GitItem): { stage: PullStage; tone: string; label: string } {
  return item.isDraft ? { stage: 'draft', tone: 'draft', label: '草稿变更' } : checkSummary(item);
}

function isStacked(item: GitItem, items: GitItem[]) {
  return Boolean(item.headRef && item.baseRef && items.some(other => other.number !== item.number && (other.headRef === item.baseRef || other.baseRef === item.headRef)));
}

function PullFlow({ items, busy, onOpen }: Omit<Props, 'kind'>) {
  const staged = pullStages.map(stage => ({ ...stage, items: items.filter(item => pullStage(item).stage === stage.id) }));
  const linked = items.filter(item => item.linkedIssues?.length).length;
  const blocked = items.filter(item => pullStage(item).tone === 'failed').length;
  const reviewed = items.filter(item => item.reviewSnapshot?.state === 'current').length;
  const stacked = items.filter(item => isStacked(item, items)).length;

  return <div className="pull-flow-wrap">
    <header className="pull-flow-header">
      <div><span className="pulse-kicker"><GitBranch size={13} aria-hidden="true" /> MERGE FLOW</span><h3>合并流</h3></div>
      <p>沿着真实证据从草稿走向审查；打开卡片可读取最新 Diff 与 CI。</p>
      <div className="pull-flow-metrics" aria-label="合并流摘要"><span><b>{reviewed}</b> 已审查</span><span><b>{blocked}</b> 有阻塞</span><span><b>{linked}</b> 关联 Issue</span><span><b>{stacked}</b> 堆叠关系</span></div>
    </header>
    <div className="pull-flow" aria-label="按证据阶段排列的 Pull Request">
      <div className="pull-flow-spine" aria-hidden="true"><i /><i /><i /></div>
      {staged.map(stage => <section className={`pull-lane lane-${stage.id}`} key={stage.id} aria-labelledby={`pull-lane-${stage.id}`}>
        <header><span>{stage.step}</span><div><h4 id={`pull-lane-${stage.id}`}>{stage.title}</h4><p>{stage.description}</p></div><b>{stage.items.length}</b></header>
        <div className="pull-lane-items">{stage.items.length ? stage.items.map(item => {
          const status = pullStage(item);
          const type = pullClassification(item);
          const stack = isStacked(item, items);
          const findings = item.reviewSnapshot?.openFindingCount ?? 0;
          return <button
            id={`inbox-row-pulls-${item.number}`}
            data-item-number={item.number}
            type="button"
            key={item.number}
            disabled={busy}
            className={`pull-flow-card tone-${type} status-${status.tone}${item.reviewSnapshot?.state === 'stale' ? ' is-stale' : ''}`}
            onClick={() => onOpen(item)}
          >
            <span className="pull-card-top"><span className="pull-number">PR #{item.number}</span><span className={`pull-evidence state-${status.tone}`}><i />{status.label}</span></span>
            <strong>{item.title}</strong>
            <span className="pull-branch"><GitBranch size={12} aria-hidden="true" /><code>{item.headRef || 'head'}</code><span>→</span><code>{item.baseRef || 'base'}</code></span>
            <span className="pull-card-meta"><span>{pullTypes[type]}</span><span>{item.totalChangedFiles === undefined ? '文件数待读取' : `${item.totalChangedFiles} 个文件`}</span><span>{inboxDate(item.updatedAt)} 更新</span></span>
            {(item.linkedIssues?.length || stack || findings > 0) && <span className="pull-card-links">
              {item.linkedIssues?.slice(0, 2).map(issue => <span key={issue.number}><Link2 size={10} aria-hidden="true" />Issue #{issue.number}</span>)}
              {stack && <span><GitBranch size={10} aria-hidden="true" />堆叠变更</span>}
              {findings > 0 && <span><ShieldAlert size={10} aria-hidden="true" />{findings} 个待确认发现</span>}
            </span>}
            <span className="pull-card-open">查看证据 <ArrowUpRight size={13} aria-hidden="true" /></span>
          </button>;
        }) : <div className="pull-lane-empty"><span />当前无 PR</div>}</div>
      </section>)}
    </div>
    <footer className="pull-flow-legend"><span><i className="flow-legend-dot tone-fix" />颜色表示变更类型</span><span><MessageSquare size={12} aria-hidden="true" />审查结论仅来自已保存证据</span><span><Link2 size={12} aria-hidden="true" />关联 Issue 仅在证据已确认时显示</span></footer>
  </div>;
}

export function MaintenancePulse({ kind, items, busy, onOpen }: Props) {
  return kind === 'issues' ? <IssueWeave items={items} busy={busy} onOpen={onOpen} /> : <PullFlow items={items} busy={busy} onOpen={onOpen} />;
}
