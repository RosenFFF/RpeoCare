'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Bug, CheckCircle2, CircleHelp, CircleX, FileCode2, FileText, GitBranch, GitPullRequest, LoaderCircle, Minus, PackageOpen, PanelRightOpen, Plus, Scan, ShieldCheck, UserRound, Workflow } from 'lucide-react';
import type { GitItem } from '@/contracts/workbench';
import { inboxDate, pullClassification, pullTypes, type PullType } from './inbox-model';
import { pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from './pull-voyage-model';
import { pullMapLayout } from './pull-map-model';
import { usePrCanvas } from './use-pr-canvas';
import './pull-confluence.css';

type Props = { items: GitItem[]; selected: string; busy: boolean; baseBranch?: string; onSelect: (item: GitItem) => void; onShowInspector: () => void };
const typeIcons = { feature: Plus, fix: Bug, docs: FileText, dependency: PackageOpen, other: GitPullRequest };

export function PullConfluence({ items, selected, busy, onSelect, onShowInspector }: Props) {
  const [overview, setOverview] = useState(items.length > 12);
  const [allEdges, setAllEdges] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<PullType | null>(null);
  const layout = useMemo(() => pullMapLayout(items, false, overview), [items, overview]);
  const signature = JSON.stringify([overview, items.map(item => [item.number, item.baseRef])]);
  const canvas = usePrCanvas({ width: layout.width, height: layout.height }, signature, overview ? 0 : 1);
  const summary = overview || canvas.camera.scale < .85;
  const simplified = summary && canvas.camera.scale < .6;
  const dense = summary && canvas.camera.scale < .43;
  const preview = items.find(item => pullIdentity(item) === hovered);
  const highlighted = items.some(item => pullIdentity(item) === hovered) ? hovered : selected;
  const focusedType = items.some(item => pullClassification(item) === highlightType) ? highlightType : null;
  const typeCounts = Object.keys(pullTypes).map(type => ({ type: type as PullType, count: items.filter(item => pullClassification(item) === type).length })).filter(group => group.count);
  function locate(number: number) {
    const node = layout.groups.flatMap(group => group.nodes).find(node => node.item.number === number);
    if (!node) return;
    canvas.reveal({ x: node.x, y: node.y + (overview ? 46 : 80) }, { width: layout.nodeWidth, height: layout.nodeHeight });
    document.getElementById(`inbox-row-pulls-${number}`)?.focus({ preventScroll: true });
  }
  return <div className={`confluence-map is-spacious-map${allEdges ? ' has-all-edges' : ''}`}>
    <div className="confluence-toolbar"><nav className="confluence-type-nav" aria-label="按变更类别突出显示连线">{typeCounts.map(({type,count}) => { const Icon = typeIcons[type]; return <button type="button" className={`type-${type}`} key={type} aria-pressed={focusedType === type} title="分类来自标题和标签，点击突出显示同类 PR" onClick={() => setHighlightType(current => current === type ? null : type)}><Icon size={14}/><span>{pullTypes[type]}</span><b>{count}</b></button>; })}</nav><div className="confluence-camera-controls" role="group" aria-label="PR 画布操作">
      <button type="button" aria-pressed={overview} title={overview ? '切换详细信息，恢复原始字号' : '总览当前页全部 PR'} onClick={() => setOverview(value => !value)}>{overview ? <FileText size={15}/> : <Scan size={15}/>}<span>{overview ? '展开信息' : '总览'}</span></button>
      <button type="button" aria-label="缩小画布" onClick={() => canvas.zoom(1 / 1.2)}><Minus size={16}/></button><output aria-label="当前缩放比例">{Math.round(canvas.camera.scale * 100)}%</output><button type="button" aria-label="放大画布" onClick={() => canvas.zoom(1.2)}><Plus size={16}/></button>
      <button type="button" onClick={canvas.readable} aria-label="恢复默认视图" title="恢复默认视图"><FileText size={15}/></button><button type="button" onClick={canvas.fit} aria-label="适应全部节点" title="适应全部（0）"><Scan size={16}/></button><button type="button" aria-label={allEdges ? '只显示聚焦连线' : '显示全部连线'} title={allEdges ? '只显示聚焦连线' : '显示全部连线'} aria-pressed={allEdges} onClick={() => setAllEdges(value => !value)}><Workflow size={15}/></button><button type="button" aria-label="查看选中 PR" title="查看选中 PR" onClick={onShowInspector}><PanelRightOpen size={16}/></button>
    </div></div>
    <div className={`confluence-viewport${canvas.dragging ? ' is-dragging' : ''}`} ref={canvas.surface} style={{ height: canvas.frame.height, backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`, backgroundSize: `${26 * canvas.camera.scale}px ${26 * canvas.camera.scale}px` }} data-scale={canvas.camera.scale} data-pan-x={canvas.camera.x} data-pan-y={canvas.camera.y} tabIndex={0} role="region" aria-label="PR 变更汇流画布，滚轮缩放，拖拽平移，0适应全部" onPointerDown={canvas.pointerDown} onPointerMove={canvas.pointerMove} onPointerUp={canvas.pointerEnd} onPointerCancel={canvas.pointerEnd} onLostPointerCapture={canvas.pointerEnd} onKeyDown={canvas.keyDown} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) canvas.fit(); }}>
      <div className={`confluence-canvas${summary ? ' is-summary-view' : ''}${simplified ? ' is-simple-view' : ''}${dense ? ' is-dense-view' : ''}`} style={{ width: layout.width, height: layout.height, '--read-scale': Math.min(4, Math.max(1, 1 / canvas.camera.scale)), transform: `translate(${canvas.camera.x}px, ${canvas.camera.y}px) scale(${canvas.camera.scale})` } as CSSProperties}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">{layout.groups.map(group => <g key={group.base}>
          <path className="confluence-trunk" d={`M${group.hub.x} ${group.top + 30} V${group.top + group.height - 30}`}/>
          {group.nodes.map(node => { const type = pullClassification(node.item), checks = pullCheckSignal(node.item, node.item.files !== undefined); const active = highlighted === pullIdentity(node.item) || focusedType === type;
            return <g className={`confluence-edge type-${type} tone-${checks.tone}${active ? ' is-active' : ''}${focusedType && focusedType !== type ? ' is-muted' : ''}`} key={node.item.number}><path d={`M${node.x + 43} ${node.y} C${node.x + 86} ${node.y} ${node.x + 92} ${node.channelY} ${node.x + 124} ${node.channelY} H${group.hub.x - 84} C${group.hub.x - 42} ${node.channelY} ${group.hub.x - 42} ${node.portY} ${group.hub.x} ${node.portY}`}/><circle cx={group.hub.x} cy={node.portY} r="3"/></g>;
          })}
        </g>)}</svg>
        {layout.groups.map(group => <section key={group.base} aria-label={`计划合入 ${group.base} 的 PR`}>
          <div className="confluence-target" style={{ left: group.hub.x, top: group.hub.y }}><span className="confluence-target-glyph"><GitBranch size={31}/></span><strong title={group.base}>{group.base}</strong><span>合入目标分支</span><div><b>{group.nodes.length}<small>当前页 PR</small></b><b>{group.nodes.filter(node => node.item.isDraft).length}<small>草稿</small></b></div></div>
          {group.nodes.map(node => {
            const item = node.item, type = pullClassification(item), Icon = typeIcons[type], changes = pullChangeSignal(item), checks = pullCheckSignal(item, item.files !== undefined), review = pullReviewSignal(item);
            const CheckIcon = checks.tone === 'passed' ? CheckCircle2 : checks.tone === 'failed' ? CircleX : checks.tone === 'pending' ? LoaderCircle : CircleHelp;
            const count = changes.total ?? (changes.read ? changes.count : undefined);
            const size = summary ? 64 : count === undefined ? 80 : Math.min(92, 80 + Math.log2(1 + count) * 2);
            const source = item.headRepository ? `${item.headRepository.split('/')[0]}:${item.headRef || '?'}` : item.headRef || '来源分支未知';
            return <button type="button" id={`inbox-row-pulls-${item.number}`} data-item-number={item.number} key={item.number} disabled={busy} aria-pressed={selected === pullIdentity(item)} aria-label={`选择 PR #${item.number}，${item.title}，${checks.label}，${review.label}`} className={`confluence-node type-${type} tone-${checks.tone}${selected === pullIdentity(item) ? ' is-selected' : ''}${item.isDraft ? ' is-draft' : ''}${focusedType === type ? ' is-highlighted' : ''}`} style={{ left: node.x, top: node.y, width: layout.nodeWidth, '--node-size': `${size}px` } as CSSProperties} onMouseEnter={() => setHovered(pullIdentity(item))} onMouseLeave={() => setHovered(null)} onFocus={() => { setHovered(pullIdentity(item)); canvas.reveal({ x: node.x, y: node.y + (overview ? 46 : 80) }, { width: layout.nodeWidth, height: layout.nodeHeight }); }} onBlur={() => setHovered(null)} onClick={() => onSelect(item)}>
              <span className="confluence-glyph"><Icon size={24}/><b>#{item.number}</b>{item.isDraft && <em>草稿</em>}</span>
              <strong className="confluence-title" title={item.title}>{item.title}</strong>
              <span className="confluence-node-meta"><span className="confluence-type-tag">{pullTypes[type]}</span><span title={item.author}><UserRound size={12}/>{item.author || '未知作者'}</span><time dateTime={item.updatedAt}>{inboxDate(item.updatedAt)}</time></span>
              <span className="confluence-node-source" title={`来源分支 ${source}`}><GitBranch size={12}/><code>{source}</code></span>
              <span className="confluence-node-state"><span className={`tone-${checks.tone}`} title={checks.label}><CheckIcon size={13}/>{checks.label}</span><span className={`confluence-review-tag tone-${review.tone}`} title={review.label}><ShieldCheck size={12}/>{review.tone === 'unread' ? '待审查' : review.tone === 'stale' ? '需重审' : review.open ? `${review.open} 条待确认` : '已有报告'}</span></span>
              <span className="confluence-node-files"><FileCode2 size={12}/><span>{count === undefined ? '规模待读取' : `${count}${changes.partial && changes.total === undefined ? '+' : ''} 文件`}</span>{changes.read && <span className="confluence-line-delta" title={changes.partial ? '已读取部分文件的增删行数' : '已读取文件的增删行数'}><b>+{changes.additions}</b><i>−{changes.deletions}</i></span>}<code title={item.headSha}>{item.headSha?.slice(0,7) || '提交未知'}</code></span>
            </button>;
          })}
        </section>)}
      </div>
      {preview && <div className="confluence-hover-readout" aria-hidden="true"><b>#{preview.number} · {preview.isDraft ? '草稿' : pullTypes[pullClassification(preview)]}</b><strong>{preview.title}</strong><span>{pullCheckSignal(preview, preview.files !== undefined).label} · {pullReviewSignal(preview).label}</span><small>{preview.author || '未知作者'} · {inboxDate(preview.updatedAt)} · 点击查看完整信息</small></div>}
    </div>
    <footer className="confluence-map-caption"><span>{dense ? '编号总览 · 悬停读摘要 · 点击审阅' : summary ? '摘要总览 · 点击查看完整信息' : '详细视图 · 滚轮缩放 · 拖动平移'}</span><details className="confluence-locator"><summary>定位 PR（{items.length}）</summary><div>{items.map(item => <button type="button" key={item.number} onClick={() => locate(item.number)}>#{item.number}</button>)}</div></details><details><summary>图例与操作</summary><div><p>色标与图标表示标题 / 标签中的变更类型线索。外环：绿为可见检查完成、红为失败、黄为进行中、灰色虚线为未知。</p><p>超过12条默认摘要总览；缩小后减少节点文字，悬停显示固定字号摘要，点击查看完整信息。展开信息可恢复详细布局与原始字号。</p><p>默认仅显示聚焦 PR 或类别的连线，可主动打开全部连线。连线指向真实目标分支，不代表已经合并；未知检查与规模继续保持未知。</p><p>+ / − 缩放，0 / Home 适应全部，方向键平移。</p></div></details></footer>
  </div>;
}
