'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Blocks, Grid2x2, LayoutGrid, BookOpen, Bug, CheckCheck, ChevronRight, CircleDashed, CircleDot, Compass, FileQuestion, FlaskConical, Focus, Gauge, HelpCircle, Info, Lightbulb, Link2, Map, MessageSquare, Minus, Plus, RefreshCw, Scan, Shapes, ShieldAlert, ShieldQuestion, X } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, issueCategories, issueClassification, issuePriorities, issueStates } from './inbox-model';
import { issueActionGroups, issueActionKey, issueActions, issueDiscussion, issueTitleNeedsContext, type IssueActionGroup, type IssueActionKey } from './issue-map-model';
import { usePrCanvas } from './use-pr-canvas';
import { attentionProfiles, signalCategoryOrder, visualCategoryNames, type IssueAttention, type IssueMapSignals, type IssueVisualSignal } from './issue-visual-signals';
import { IssueMatrix } from './issue-matrix';
import './issue-work-map.css';
import './issue-visual-signals.css';

type Props = { items: GitItem[]; busy: boolean; onOpen: (item: GitItem) => void; signals: IssueMapSignals };
const actionIcons = { refresh: RefreshCw, decision: ShieldQuestion, triage: Compass, information: FileQuestion, verify: FlaskConical, reply: MessageSquare, replied: CheckCheck };
const categoryIcons = { bug: Bug, feature: Lightbulb, question: HelpCircle, documentation: BookOpen, performance: Gauge, compatibility: Blocks, security: ShieldAlert, other: Shapes, unknown: CircleDashed };

function CategoryMark({ signal }: { signal: IssueVisualSignal['classification'] }) {
  const Icon = categoryIcons[signal.category];
  return <span className={`issue-category-mark category-${signal.category}${signal.provisional ? ' is-provisional' : ''}`} title={signal.reason}><Icon size={13} aria-hidden="true" />{visualCategoryNames[signal.category]}<small>{signal.source}</small></span>;
}

function AttentionStrip({ attention }: { attention: IssueAttention }) {
  return <span className="issue-attention-strip" title={`已知关注分 ${attention.known}，${attention.unknown} 分权重待评估；点击问题查看计算依据。`}><span><span>关注分</span><b>{attention.known}{attention.unknown > 0 && '+'}</b>{attention.unknown > 0 && <small>{attention.unknown} 分待评估</small>}</span><i aria-hidden="true"><b style={{ width: `${attention.known}%` }} /><em style={{ width: `${attention.unknown}%` }} /></i></span>;
}

function IssueSign({ item, selected, busy, onSelect, signal }: { item: GitItem; selected: boolean; busy: boolean; onSelect: (item: GitItem) => void; signal?: IssueVisualSignal }) {
  const fields = issueClassification(item);
  const action = issueActions[issueActionKey(item)];
  const comments = issueDiscussion(item);
  const summary = item.triage?.summaryZh?.trim();
  const insufficient = issueTitleNeedsContext(item.title);
  return <button type="button" id={`inbox-row-issues-${item.number}`} data-item-number={item.number} className={`issue-sign category-${signal?.classification.category ?? 'unknown'} priority-${fields.priority}${selected ? ' is-selected' : ''}`} disabled={busy} aria-pressed={selected} aria-label={`查看 Issue #${item.number}，${item.title}，${action.label}，${issuePriorities[fields.priority]}${signal ? `，${visualCategoryNames[signal.classification.category]}，${signal.classification.source}，已知关注分 ${signal.attention.known}，${signal.attention.unknown} 分待评估` : ''}`} onClick={() => onSelect(item)}>
    <span className="issue-sign-top"><b>#{item.number}</b><span>{issuePriorities[fields.priority]}</span><ChevronRight size={14} aria-hidden="true" /></span>
    {signal && <CategoryMark signal={signal.classification} />}
    <strong className="issue-sign-title" title={item.title}>{item.title || '无标题'}</strong>
    {(summary || insufficient) && <span className="issue-sign-context">{summary ? <><b>{fields.stale ? '历史 AI 摘要' : 'AI 摘要'}</b>{summary}</> : '标题信息不足，需核对正文'}</span>}
    {signal && <AttentionStrip attention={signal.attention} />}
    <span className="issue-sign-bottom"><span><MessageSquare size={12} aria-hidden="true" />{comments === undefined ? '评论未知' : `${comments} 条评论`}</span><span>{fields.stale ? '原文有更新' : item.triage?.review ? '含人工确认' : fields.source}</span>{Boolean(item.triage?.missingInformation?.length) && <span className="issue-sign-missing" title={item.triage?.missingInformation?.join('；')}><FileQuestion size={12} aria-hidden="true" />{fields.stale ? '历史缺失' : '待补'} {item.triage?.missingInformation?.length} 项</span>}{Boolean(item.relatedPulls?.length) && <span title="历史关联不表示问题已修复"><Link2 size={12} aria-hidden="true" />{item.relatedPulls?.length}</span>}</span>
    <span className="issue-sign-action">{action.action}<ArrowUpRight size={13} aria-hidden="true" /></span>
  </button>;
}

/** Optional spatial exploration; the default reading view never scales down text. */
function ExplorationCanvas({ groups, selected, busy, onSelect, signals }: { groups: IssueActionGroup[]; selected: number | null; busy: boolean; onSelect: (item: GitItem) => void; signals: IssueMapSignals['byUrl'] }) {
  const geometry = useMemo(() => {
    let top = 24;
    const regions = groups.map(group => {
      const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(group.items.length))));
      const height = 84 + Math.ceil(group.items.length / columns) * 306;
      const region = { ...group, top, width: columns * 310 + 40, height, columns };
      top += height + 24;
      return region;
    });
    return { regions, width: Math.max(350, ...regions.map(region => region.width)) + 48, height: top };
  }, [groups]);
  const canvas = usePrCanvas(geometry, JSON.stringify(groups.map(group => [group.key, group.items.map(item => item.number)])));
  return <div className="issue-exploration">
    <div className="issue-explore-tools"><span>滚轮缩放 · 空白或中键拖动 · 0 恢复全图</span><div role="group" aria-label="Issue 画布缩放"><button type="button" aria-label="缩小 Issue 画布" onClick={() => canvas.zoom(1 / 1.2)}><Minus size={16} /></button><output aria-label="Issue 缩放比例">{Math.round(canvas.camera.scale * 100)}%</output><button type="button" aria-label="放大 Issue 画布" onClick={() => canvas.zoom(1.2)}><Plus size={16} /></button><button type="button" onClick={canvas.fit}><Scan size={15} />适应全部</button></div></div>
    <div ref={canvas.surface} className={`issue-explore-viewport${canvas.dragging ? ' is-dragging' : ''}`} role="region" aria-label="Issue 探索画布" tabIndex={0} style={{ height: canvas.frame.height }} onPointerDown={canvas.pointerDown} onPointerMove={canvas.pointerMove} onPointerUp={canvas.pointerEnd} onPointerCancel={canvas.pointerEnd} onLostPointerCapture={canvas.pointerEnd} onKeyDown={canvas.keyDown}>
      <div className="issue-explore-world" style={{ width: geometry.width, height: geometry.height, transform: `translate(${canvas.camera.x}px,${canvas.camera.y}px) scale(${canvas.camera.scale})` }}>
        {geometry.regions.map(region => <section key={region.key} className={`issue-explore-region tone-${issueActions[region.key].tone}`} style={{ left: 24, top: region.top, width: region.width, height: region.height }} aria-label={issueActions[region.key].label}><h3>{issueActions[region.key].label}<span>{region.items.length} 条</span></h3>{region.items.map((item, index) => <div key={item.number} className="issue-explore-node" style={{ left: 20 + index % region.columns * 310, top: 64 + Math.floor(index / region.columns) * 306 }} onFocus={() => canvas.reveal({ x: 24 + 165 + index % region.columns * 310, y: region.top + 207 + Math.floor(index / region.columns) * 306 })}><IssueSign item={item} selected={selected === item.number} busy={busy} onSelect={onSelect} signal={signals.get(item.url)} /></div>)}</section>)}
      </div>
    </div>
  </div>;
}

export function IssueWorkMap({ items, busy, onOpen, signals }: Props) {
  const groups = useMemo(() => issueActionGroups(items), [items]);
  const [focusKey, setFocusKey] = useState<IssueActionKey | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'matrix' | 'regions' | 'explore'>('matrix');
  const exploring = view === 'explore';
  const matrix = view === 'matrix';
  const stage = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusGroup = groups.find(group => group.key === focusKey);
  const unifiedGroup = focusGroup ?? (groups.length === 1 ? groups[0] : undefined);
  const shownGroups = focusGroup ? [focusGroup] : groups;
  const active = items.find(item => item.url === selected);
  const activeSignal = active ? signals.byUrl.get(active.url) : undefined;
  const fields = active ? issueClassification(active) : undefined;
  const high = items.filter(item => issueClassification(item).priority === 'high').length;
  const stale = items.filter(item => issueClassification(item).stale).length;

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    function measure() {
      if (!element?.getClientRects().length) return;
      const top = stage.current?.getBoundingClientRect().top ?? element.getBoundingClientRect().top;
      element.style.setProperty('--issue-map-height', `${Math.max(260, window.innerHeight - top - 42)}px`);
    }
    const observer = new ResizeObserver(measure);
    const page = element.closest('.review-page');
    observer.observe(element);
    if (page) observer.observe(page);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  function changeFocus(key: IssueActionKey | null) {
    setFocusKey(key);
    setSelected(null);
    if (stage.current) stage.current.scrollTop = 0;
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }
  function selectItem(item: GitItem, expand = false) {
    if (expand) setFocusKey(issueActionKey(item));
    setSelected(item.url);
    requestAnimationFrame(() => document.getElementById('issue-map-evidence-title')?.focus({ preventScroll: true }));
  }
  function closeEvidence() {
    const number = active?.number;
    setSelected(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(`inbox-row-issues-${number}`) ?? document.getElementById(`issue-map-marker-${number}`);
      const foldedIndex = target?.closest('details');
      if (foldedIndex) foldedIndex.open = true;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  return <section className="issue-work-map" aria-label="Issue 分诊工作地图" onKeyDown={event => { if (event.key === 'Escape' && active) { event.stopPropagation(); closeEvidence(); } }}>
    <div ref={body} className={`issue-map-body${active ? ' has-evidence' : ''}`}>
      <div className={`issue-map-workspace${groups.length <= 1 || matrix ? ' is-single-group' : ''}`}>
        {groups.length > 1 && !matrix && <nav className="issue-action-nav" aria-label="按下一步动作聚焦"><button type="button" aria-pressed={!focusGroup} onClick={() => changeFocus(null)}><Map size={16} aria-hidden="true" /><span>全部分布</span><b>{items.length}</b></button>{groups.map(group => { const Icon = actionIcons[group.key]; return <button key={group.key} type="button" className={`tone-${issueActions[group.key].tone}`} aria-pressed={focusGroup?.key === group.key} onClick={() => changeFocus(group.key)}><Icon size={16} aria-hidden="true" /><span>{issueActions[group.key].label}</span><b>{group.items.length}</b></button>; })}</nav>}
        <div className="issue-map-stage" ref={stage}>
          <div className="issue-map-stage-heading"><div><h3 ref={heading} tabIndex={-1}>{matrix ? '关注矩阵' : unifiedGroup ? issueActions[unifiedGroup.key].label : '全部分布'}</h3><span aria-live="polite">{matrix ? `${items.length} 条` : unifiedGroup ? `${unifiedGroup.items.length} 条${focusGroup ? ' · 已全部展开' : ''}` : `${groups.length} 组`}</span>{high > 0 && <span className="issue-map-high">高优先级 {high}</span>}{stale > 0 && <span className="issue-map-updated">原文更新 {stale}</span>}</div><div className="issue-map-tools">
            <label className="issue-attention-lens"><span>关注视角</span><select aria-label="关注视角，切换后按关注分排序" value={signals.profile} onChange={event => signals.onProfile(event.target.value as IssueMapSignals['profile'])}>{Object.entries(attentionProfiles).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}</select></label>
            {!matrix && (focusGroup ? <button type="button" onClick={() => changeFocus(null)}><ArrowLeft size={14} />总览</button> : unifiedGroup && <button type="button" onClick={() => changeFocus(unifiedGroup.key)}><Focus size={15} />展开全部</button>)}
            <div className="issue-view-switch" role="group" aria-label="Issue 视图"><button type="button" aria-pressed={matrix} onClick={() => setView('matrix')}><Grid2x2 size={15} aria-hidden="true" />关注矩阵</button><button type="button" aria-pressed={view === 'regions'} onClick={() => setView('regions')}><LayoutGrid size={15} aria-hidden="true" />动作分区</button><button type="button" aria-pressed={exploring} onClick={() => setView('explore')}><Scan size={15} aria-hidden="true" />探索画布</button></div>
            <details className="issue-map-help"><summary aria-label="地图说明" title="地图说明"><Info size={16} /></summary><div><p>色标表示类别。实线表示当前维护者分类确认；虚线标出 AI 分析、标签或标题线索，文字显示具体来源。</p><p>关注分是本视角下已知信号的规则加权和，+ 表示仍有权重待评估。它辅助查看顺序，不表示问题严重程度。</p><p>点击类别可筛选；切换视角会调整权重并按关注分排序。未知优先级不视为低风险。</p></div></details>
          </div></div>
          <div className="issue-category-legend" role="group" aria-label="按类别筛选，包含待确认线索"><span>类别 / 线索</span><button type="button" aria-pressed={signals.category === 'all'} onClick={() => { changeFocus(null); signals.onCategory('all'); }}>全部<b>{Object.values(signals.counts).reduce((sum, count) => sum + (count ?? 0), 0)}</b></button>{signalCategoryOrder.filter(category => Boolean(signals.counts[category]) || signals.category === category).map(category => { const Icon = categoryIcons[category]; return <button key={category} type="button" className={`category-${category}`} aria-pressed={signals.category === category} onClick={() => { changeFocus(null); signals.onCategory(category); }}><Icon size={14} aria-hidden="true" />{visualCategoryNames[category]}<b>{signals.counts[category] ?? 0}</b></button>; })}<span className="issue-attention-sort-note">{signals.attentionSorted ? '按已知关注分排序' : '沿用当前排序'}</span></div>
          {matrix ? <IssueMatrix items={items} busy={busy} selected={active?.url ?? null} onSelect={item => selectItem(item)} signals={signals} /> : exploring ? <ExplorationCanvas groups={shownGroups} selected={active?.number ?? null} busy={busy} onSelect={selectItem} signals={signals.byUrl} /> : <div key={focusGroup?.key ?? 'overview'} className={`issue-action-regions${focusGroup ? ' is-focused' : ''}`}>
            {shownGroups.map(group => {
              const meta = issueActions[group.key];
              const Icon = actionIcons[group.key];
              const limit = focusGroup ? group.items.length : groups.length === 1 ? 6 : 3;
              const preview = group.items.slice(0, limit);
              return <section key={group.key} className={`issue-action-region tone-${meta.tone}${group.items.length === 1 ? ' is-single' : ''}`} aria-label={`${meta.label}，${group.items.length} 条`}>
                {!unifiedGroup && <header className="issue-region-heading"><span className="issue-region-icon"><Icon size={19} aria-hidden="true" /></span><div><h4>{meta.label}<b>{group.items.length}</b></h4><p>{meta.hint}</p></div><button type="button" onClick={() => changeFocus(group.key)} aria-label={`展开${meta.label}全部 ${group.items.length} 条`}><Focus size={15} aria-hidden="true" /><span>展开全部</span></button></header>}
                <div className="issue-region-signs">{preview.map(item => <IssueSign key={item.number} item={item} selected={active?.number === item.number} busy={busy} onSelect={selectItem} signal={signals.byUrl.get(item.url)} />)}</div>
                {!focusGroup && <details className="issue-region-index"><summary>编号定位 · {group.items.length} 条</summary><div role="group" aria-label={`${meta.label}全部问题定位`}>{group.items.map(item => <button key={item.number} id={`issue-map-marker-${item.number}`} type="button" className={`category-${signals.byUrl.get(item.url)?.classification.category ?? 'unknown'}${active?.number === item.number ? ' is-selected' : ''}`} title={`#${item.number} ${item.title}`} aria-label={`定位 Issue #${item.number}，${item.title}`} disabled={busy} onClick={() => selectItem(item, true)}>#{item.number}</button>)}</div></details>}
                {!focusGroup && group.items.length > preview.length && <button className="issue-region-more" type="button" onClick={() => changeFocus(group.key)}>当前预览 {preview.length} 条，展开其余 {group.items.length - preview.length} 条<ChevronRight size={15} aria-hidden="true" /></button>}
              </section>;
            })}
          </div>}
          {!items.length && <p className="issue-map-no-data">当前没有可展示的问题，请调整筛选或刷新。</p>}
        </div>
      </div>
      {active && fields && <aside className="issue-map-evidence" aria-label="Issue 依据与下一步"><header><span><CircleDot size={17} aria-hidden="true" />Issue #{active.number}</span><button type="button" aria-label="关闭 Issue 依据面板" onClick={closeEvidence}><X size={18} /></button></header><h3 id="issue-map-evidence-title" tabIndex={-1}>{active.title || '无标题'}</h3><p className="issue-map-byline">{active.author || '未知作者'} · {inboxDate(active.updatedAt)} 更新</p>
        {activeSignal && <section className="issue-signal-explanation"><h4>分类依据</h4><CategoryMark signal={activeSignal.classification} /><p>{activeSignal.classification.reason}{activeSignal.classification.stale && ' 原文已更新，分类需重新核对。'}</p></section>}
        <section className={`issue-map-next tone-${issueActions[issueActionKey(active)].tone}`}><span>下一步</span><strong>{issueActions[issueActionKey(active)].action}</strong><p>{issueActions[issueActionKey(active)].hint}</p><button type="button" className="button button-primary" disabled={busy} onClick={() => onOpen(active)}>进入 Issue 分诊<ArrowUpRight size={14} aria-hidden="true" /></button></section>
        {activeSignal && <section className="issue-attention-explanation"><header><h4>关注分依据</h4><b>{activeSignal.attention.known}{activeSignal.attention.unknown > 0 && '+'}</b></header><p>{attentionProfiles[signals.profile].label} · 已知 {activeSignal.attention.known} / 100{activeSignal.attention.unknown > 0 && `，另有 ${activeSignal.attention.unknown} 分待评估`}。</p>{activeSignal.attention.parts.map(part => <details key={part.key}><summary><span>{part.label}</span><strong>{part.points === null ? '待评估' : part.points}<small> / {part.maximum}</small></strong></summary><div className={`issue-attention-part${part.points === null ? ' is-unknown' : ''}`} aria-hidden="true"><i style={{ width: `${part.points === null ? 100 : part.points / part.maximum * 100}%` }} /></div><p>{part.reason}</p></details>)}<small>规则辅助查看顺序；未知项不按低风险处理。类别线索不参与优先级计分。</small></section>}
        <dl><div><dt>已有状态</dt><dd>{issueStates[fields.status]}</dd></div><div><dt>优先级</dt><dd className={`priority-${fields.priority}`}>{issuePriorities[fields.priority]}</dd></div><div><dt>问题类型</dt><dd>{fields.category ? issueCategories[fields.category] : '待分类'}</dd></div><div><dt>字段来源</dt><dd>{active.triage?.review ? '含维护者确认' : fields.source}</dd></div></dl>
        {fields.stale && <p className="issue-map-stale">原文在分诊后更新。下方保留的是历史分析，需重新核对。</p>}
        {active.triage?.summaryZh ? <section className="issue-map-excerpt"><h4>{fields.stale ? '历史 AI 摘要' : 'AI 摘要'}</h4><p>{active.triage.summaryZh}</p></section> : <section className="issue-map-excerpt"><h4>原文预览</h4><p>{active.body?.trim() ? active.body.slice(0, 600) : '列表未提供正文，请进入分诊读取原始内容。'}</p>{active.body?.length > 600 && <small>此处仅预览前 600 字，详情保留完整正文。</small>}</section>}
        {Boolean(active.triage?.missingInformation?.length) && <section className="issue-map-excerpt"><h4>分析中记录的缺失信息</h4><ul>{active.triage?.missingInformation.map((text, index) => <li key={index}>{text}</li>)}</ul></section>}
        {Boolean(active.triage?.rationale?.length) && <details className="issue-map-reasons"><summary>查看分析依据</summary><ul>{active.triage?.rationale?.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
        {Boolean(active.relatedPulls?.length) && <section className="issue-map-excerpt"><h4>历史 PR 关联</h4>{active.relatedPulls?.map(pull => <p key={`${pull.number}-${pull.headSha}`}>PR #{pull.number} · {pull.title}</p>)}<small>关联不表示问题已经修复。</small></section>}
      </aside>}
    </div>
  </section>;
}
