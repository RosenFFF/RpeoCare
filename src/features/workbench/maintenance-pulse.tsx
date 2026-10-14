'use client';

import { useState, type CSSProperties } from 'react';
import { Activity, ArrowUpRight, GitBranch, Link2, MessageSquare, ShieldAlert } from 'lucide-react';
import type { GitItem, IssueWorkflowStatus } from '@/contracts/workbench';
import { inboxDate, issueCategories, issueClassification, issuePriorities, issueStates, pullClassification, pullTypes } from './inbox-model';

type Props = {
  kind: 'issues' | 'pulls';
  items: GitItem[];
  busy: boolean;
  onOpen: (item: GitItem) => void;
};

type IssueNodeStyle = CSSProperties & {
  '--node-x': string;
  '--node-y': string;
  '--node-size': string;
};

type RadarStage = 'inbox' | 'clarify' | 'investigate' | 'action';
type PullStage = 'draft' | 'evidence' | 'checks' | 'review';

const radarTracks: { id: RadarStage; code: string; label: string; description: string; rx: number; ry: number; offset: number }[] = [
  { id: 'action', code: 'R1', label: '行动轨道', description: '准备回复与已回复', rx: 14.5, ry: 20, offset: 4 },
  { id: 'investigate', code: 'R2', label: '验证轨道', description: '调查与准备复现', rx: 25, ry: 30, offset: 16 },
  { id: 'clarify', code: 'R3', label: '澄清轨道', description: '等待补充信息', rx: 35.5, ry: 38.5, offset: -10 },
  { id: 'inbox', code: 'R4', label: '接收轨道', description: '未分诊与人工审阅', rx: 45, ry: 45, offset: 7 },
];

const radarStageByStatus: Record<IssueWorkflowStatus, RadarStage> = {
  untriaged: 'inbox',
  'manual-review': 'inbox',
  'needs-info': 'clarify',
  investigate: 'investigate',
  'ready-to-reproduce': 'investigate',
  'ready-to-reply': 'action',
  replied: 'action',
};

const pullStages: { id: PullStage; step: string; title: string; description: string }[] = [
  { id: 'draft', step: '01', title: '草稿', description: '仍在组织变更' },
  { id: 'evidence', step: '02', title: '证据待读取', description: '进入详情获取 Diff 与 CI' },
  { id: 'checks', step: '03', title: '检查处理中', description: '运行中或存在阻塞' },
  { id: 'review', step: '04', title: '可进入审查', description: '检查完成，等待维护者判断' },
];

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function ellipseCircumference(rx: number, ry: number) {
  const a = rx * 10;
  const b = ry * 5.6;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function radarPosition(item: GitItem, index: number, count: number, track: (typeof radarTracks)[number]) {
  const angle = (-90 + track.offset + (360 / Math.max(count, 1)) * index) * (Math.PI / 180);
  const comments = item.commentCount ?? item.comments?.length ?? 0;
  const desiredSize = 40 + Math.min(12, Math.log2(comments + 1) * 4);
  const densitySize = ellipseCircumference(track.rx, track.ry) / Math.max(count, 1) * 0.68;
  const size = clamp(Math.floor(Math.min(desiredSize, densitySize)), 28, 52);
  return {
    x: 50 + Math.cos(angle) * track.rx,
    y: 50 + Math.sin(angle) * track.ry,
    size,
    style: { '--node-x': `${50 + Math.cos(angle) * track.rx}%`, '--node-y': `${50 + Math.sin(angle) * track.ry}%`, '--node-size': `${size}px` } as IssueNodeStyle,
  };
}

function isRecent(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time < 72 * 60 * 60 * 1000;
}

function issueFocusScore(item: GitItem) {
  const fields = issueClassification(item);
  return (fields.priority === 'high' ? 120 : fields.priority === 'medium' ? 45 : 0)
    + (fields.status === 'needs-info' ? 34 : fields.status === 'ready-to-reproduce' ? 28 : 0)
    + (fields.stale ? 52 : 0)
    + (isRecent(item.updatedAt) ? 18 : 0)
    + Math.min(item.commentCount ?? item.comments?.length ?? 0, 20);
}

function IssuePulse({ items, busy, onOpen }: Omit<Props, 'kind'>) {
  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const high = items.filter(item => issueClassification(item).priority === 'high').length;
  const needsInfo = items.filter(item => issueClassification(item).status === 'needs-info').length;
  const ready = items.filter(item => issueClassification(item).status === 'ready-to-reproduce').length;
  const linked = items.filter(item => item.relatedPulls?.length).length;
  const focus = [...items].sort((a, b) => issueFocusScore(b) - issueFocusScore(a)).slice(0, 3);
  const groups = radarTracks.map(track => ({ ...track, items: items.filter(item => radarStageByStatus[issueClassification(item).status] === track.id) }));
  const placements = new Map<number, ReturnType<typeof radarPosition>>();
  for (const group of groups) group.items.forEach((item, index) => placements.set(item.number, radarPosition(item, index, group.items.length, group)));
  const outerTrack = radarTracks[radarTracks.length - 1];
  const activeItem = items.find(item => item.number === activeNumber);
  const activeFields = activeItem ? issueClassification(activeItem) : null;

  return <div className="pulse-layout">
    <section className="pulse-stage issue-pulse-stage" aria-label="Issue 维护信号雷达">
      <header className="pulse-stage-header">
        <div><span className="pulse-kicker"><Activity size={13} aria-hidden="true" /> ISSUE RADAR</span><h3>维护信号雷达</h3></div>
        <p>轨道表示处理阶段；颜色表示优先级；节点大小表示讨论量。</p>
      </header>
      <div className="radar-track-key" aria-label="处理阶段轨道">{[...groups].reverse().map(group => <span key={group.id} data-stage={group.id}><i /> <b>{group.code}</b><span>{group.label}</span><em>{group.items.length}</em></span>)}</div>
      <div className="issue-radar" role="group" aria-label="按处理阶段排列的 Issue 雷达">
        <svg className="issue-radar-grid" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
          <g className="radar-spokes">{Array.from({ length: 12 }, (_, index) => {
            const angle = (index * 30 - 90) * (Math.PI / 180);
            return <line key={index} x1="500" y1="280" x2={500 + Math.cos(angle) * outerTrack.rx * 10} y2={280 + Math.sin(angle) * outerTrack.ry * 5.6} />;
          })}</g>
          <g className="radar-orbits">{radarTracks.map(track => <ellipse key={track.id} className={`orbit-${track.id}`} cx="500" cy="280" rx={track.rx * 10} ry={track.ry * 5.6} />)}</g>
          <g className="radar-evidence-lines">{items.filter(item => item.relatedPulls?.length).map(item => {
            const placement = placements.get(item.number);
            return placement ? <line key={item.number} x1="500" y1="280" x2={placement.x * 10} y2={placement.y * 5.6} /> : null;
          })}</g>
          <g className="radar-sweep"><line x1="500" y1="280" x2="950" y2="280" /><circle cx="950" cy="280" r="3" /></g>
        </svg>
        <div className="radar-core" aria-label={`当前筛选有 ${items.length} 条开放 Issue`}><span>REPO SIGNAL</span><strong>{items.length}</strong><small>OPEN ISSUES</small></div>
        {items.map(item => {
          const fields = issueClassification(item);
          const comments = item.commentCount ?? item.comments?.length ?? 0;
          const related = item.relatedPulls?.length ?? 0;
          const stage = radarStageByStatus[fields.status];
          const placement = placements.get(item.number);
          if (!placement) return null;
          return <button
            id={`inbox-row-issues-${item.number}`}
            data-item-number={item.number}
            key={item.number}
            className={`issue-radar-node stage-${stage} tone-${fields.category || 'none'} priority-${fields.priority}${fields.stale ? ' is-stale' : ''}${isRecent(item.updatedAt) ? ' is-recent' : ''}`}
            style={placement.style}
            type="button"
            disabled={busy}
            onMouseEnter={() => setActiveNumber(item.number)}
            onMouseLeave={() => setActiveNumber(null)}
            onFocus={() => setActiveNumber(item.number)}
            onBlur={() => setActiveNumber(null)}
            onClick={() => onOpen(item)}
            aria-label={`Issue #${item.number}，${item.title}，${issuePriorities[fields.priority]}，${issueStates[fields.status]}，${comments} 条评论`}
          >
            <span className="issue-radar-node-core"><span>#</span>{item.number}</span>
            {related > 0 && <span className="issue-radar-node-link" aria-label={`有 ${related} 个关联 PR`}><Link2 size={10} aria-hidden="true" />{related}</span>}
            <span className="issue-radar-tooltip">
              <span className="issue-radar-tooltip-top"><b>#{item.number}</b><em>{radarTracks.find(track => track.id === stage)?.label}</em></span>
              <strong>{item.title}</strong>
              <span>{fields.category ? issueCategories[fields.category] : '待分类'} · {issuePriorities[fields.priority]} · {comments} 条评论{fields.stale ? ' · 原文有更新' : ''}</span>
            </span>
          </button>;
        })}
      </div>
      <footer className="pulse-stage-footer"><span><i className="legend-priority is-high" />高优先级</span><span><i className="legend-priority is-medium" />中优先级</span><span><i className="legend-priority is-unknown" />待判断</span><span><i className="legend-beacon" />近期活动</span><span><i className="legend-evidence" />关联 PR 证据</span></footer>
    </section>
    <aside className="pulse-insights" aria-label="问题场摘要">
      <div className="pulse-insight-heading"><span>RADAR SIGNAL</span><p>当前筛选 · 本页</p></div>
      <div className={`pulse-radar-readout${activeItem ? ' has-signal' : ''}`} aria-live="polite">{activeItem && activeFields ? <><span>{radarTracks.find(track => track.id === radarStageByStatus[activeFields.status])?.code} · {issueStates[activeFields.status]}</span><strong>#{activeItem.number} {activeItem.title}</strong><small>{issuePriorities[activeFields.priority]} · {activeItem.commentCount ?? activeItem.comments?.length ?? 0} 条评论{activeItem.relatedPulls?.length ? ` · ${activeItem.relatedPulls.length} 个关联 PR` : ''}</small></> : <><span>NODE READOUT</span><strong>悬停或聚焦一个信号</strong><small>在右侧读取标题、状态、优先级与证据关系。</small></>}</div>
      <div className="pulse-metrics">
        <div><strong>{high}</strong><span>高优先级</span></div>
        <div><strong>{needsInfo}</strong><span>待补充</span></div>
        <div><strong>{ready}</strong><span>可复现</span></div>
        <div><strong>{linked}</strong><span>连接 PR</span></div>
      </div>
      <div className="pulse-focus-list"><h4>维护焦点</h4>{focus.map((item, index) => {
        const fields = issueClassification(item);
        return <button type="button" key={item.number} disabled={busy} onClick={() => onOpen(item)}>
          <span className="pulse-focus-rank">0{index + 1}</span>
          <span><strong>#{item.number} {item.title}</strong><small>{issuePriorities[fields.priority]} · {issueStates[fields.status]}</small></span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>;
      })}</div>
      <div className="pulse-bridge-note"><Link2 size={15} aria-hidden="true" /><div><strong>证据桥</strong><p>节点上的链接标记来自已保存的 PR 审查，可追踪“反馈—变更”关系。</p></div></div>
    </aside>
  </div>;
}

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
  return kind === 'issues' ? <IssuePulse items={items} busy={busy} onOpen={onOpen} /> : <PullFlow items={items} busy={busy} onOpen={onOpen} />;
}
