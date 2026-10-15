'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { ArrowUpRight, GitBranch, GitCommitHorizontal, LocateFixed, Move, Pause, Play, ShieldCheck, Star } from 'lucide-react';
import type { RepositoryBranch } from '@/contracts/branches';
import { layoutBranchField } from './branch-field-layout';
import './branch-orbit-field.css';

export function BranchOrbitField({ branches, defaultBranch, disabled, active, onSelect, scrollMemory }: {
  branches: RepositoryBranch[]; defaultBranch?: string; disabled: boolean; active: boolean;
  onSelect: (name: string) => void; scrollMemory: RefObject<{ top: number; left: number } | null>;
}) {
  const field = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const layout = useMemo(() => layoutBranchField(branches, width || 1000, defaultBranch), [branches, width, defaultBranch]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const resize = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    change(); preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const change = () => setTabVisible(!document.hidden);
    change(); document.addEventListener('visibilitychange', change);
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (field.current) observer.observe(field.current);
    return () => { document.removeEventListener('visibilitychange', change); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!scroller.current || !active) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { (entry.target as HTMLElement).dataset.visible = String(entry.isIntersecting); });
    }, { root: scroller.current });
    scroller.current.querySelectorAll('.branch-portal').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [branches, active, layout]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !width) return;
    if (scrollMemory.current) { element.scrollTo(scrollMemory.current); return; }
    const node = element.querySelector<HTMLButtonElement>('.branch-portal-default') ?? element.querySelector<HTMLButtonElement>('.branch-portal');
    if (node) element.scrollTo({ left: Math.max(0, node.offsetLeft + node.offsetWidth / 2 - element.clientWidth / 2), top: Math.max(0, node.offsetTop + node.offsetHeight / 2 - element.clientHeight / 2) });
    scrollMemory.current = { top: element.scrollTop, left: element.scrollLeft };
  }, [scrollMemory, width]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (drag.current || event.pointerType === 'touch' || event.button !== 0 || (event.target as Element).closest('button')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX - bounds.left >= event.currentTarget.clientWidth || event.clientY - bounds.top >= event.currentTarget.clientHeight) return;
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (gesture?.id !== event.pointerId) return;
    event.currentTarget.scrollTo(gesture.left + gesture.x - event.clientX, gesture.top + gesture.y - event.clientY);
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function locateDefault() {
    const node = scroller.current?.querySelector<HTMLButtonElement>('.branch-portal-default');
    if (node && scroller.current) {
      scroller.current.scrollTo({ left: Math.max(0, node.offsetLeft + node.offsetWidth / 2 - scroller.current.clientWidth / 2), top: Math.max(0, node.offsetTop + node.offsetHeight / 2 - scroller.current.clientHeight / 2) });
      node.focus({ preventScroll: true });
    }
  }

  return <section ref={field} className="branch-orbit-field" aria-label="分支可视化导航" aria-busy={disabled} data-running={active && visible && tabVisible && !paused && !reduced}>
    <div className="branch-orbit-caption"><span><Move size={14} />拖动空白处浏览，点击分支展开 PR</span><div>{branches.some(branch => branch.name === defaultBranch) && <button type="button" onClick={locateDefault}><LocateFixed size={14} />定位默认分支</button>}<button type="button" aria-label={reduced ? '已遵循系统设置，减少动态效果' : paused ? '继续分支动效' : '暂停分支动效'} aria-pressed={paused || reduced} disabled={reduced} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={13} /> : <Pause size={13} />}{reduced ? '静态展示' : paused ? '继续动效' : '暂停动效'}</button></div></div>
    <div className="branch-orbit-viewport">
      <div className={`branch-orbit-space${dragging ? ' is-dragging' : ''}`} ref={scroller} tabIndex={0} aria-label="分支地图，可用方向键滚动，Tab 选择分支" onScroll={event => { scrollMemory.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }; }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}>
        <div className="branch-orbit-layout" style={{ width: layout.width, height: layout.height }}>
          <svg className="branch-field-contours" width={layout.width} height={layout.height} aria-hidden="true"><path d={`M0 ${layout.height * .38} Q${layout.width * .4} ${layout.height * .06} ${layout.width} ${layout.height * .55} M0 ${layout.height * .5} Q${layout.width * .45} ${layout.height * .14} ${layout.width} ${layout.height * .7}`} /></svg>
          {layout.nodes.map(({ branch, x, y, width: nodeWidth, height }) => {
            const isDefault = branch.name === defaultBranch;
            const tone = isDefault ? 'default' : branch.protected ? 'protected' : 'regular';
            return <button key={branch.name} className={`branch-portal branch-portal-${tone}`} style={{ left: x, top: y, width: nodeWidth, height }} type="button" disabled={disabled} onClick={() => onSelect(branch.name)} aria-label={`展开 ${branch.name} 分支的开放 PR${isDefault ? '，默认分支' : ''}${branch.protected ? '，受保护' : ''}`}>
              <span className="branch-portal-art" aria-hidden="true">
                <svg className="branch-portal-dial" viewBox="0 0 160 144" fill="none">
                  {isDefault ? <><circle className="branch-dial-track" cx="80" cy="72" r="51" /><circle className="branch-dial-trace" cx="80" cy="72" r="51" pathLength="100" /><circle className="branch-dial-inner" cx="80" cy="72" r="40" /><g className="branch-dial-signal"><circle cx="80" cy="21" r="3" /><circle cx="80" cy="123" r="2" /></g></> : <><path className="branch-dial-track" d="M80 12 139 43v58l-59 31-59-31V43Z" /><path className="branch-dial-trace" d="M80 12 139 43v58l-59 31-59-31V43Z" pathLength="100" /><circle className="branch-dial-inner" cx="80" cy="72" r="33" /></>}
                </svg>
                <span className="branch-portal-glyph">{isDefault ? <Star size={19} /> : branch.protected ? <ShieldCheck size={20} /> : <GitBranch size={20} />}</span>
              </span>
              <span className="branch-portal-identity"><strong title={branch.name}>{branch.name}</strong><span className="branch-portal-badges">{isDefault && <em><Star size={11} />默认分支</em>}{branch.protected && <em><ShieldCheck size={11} />受保护</em>}{!isDefault && !branch.protected && <em><GitBranch size={11} />普通分支</em>}</span></span>
              <span className="branch-portal-commit"><GitCommitHorizontal size={13} />最新提交 <code>{branch.commitSha?.slice(0, 10) || '未知'}</code></span>
              <span className="branch-portal-action">展开 PR<ArrowUpRight size={14} /></span>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="branch-orbit-legend"><span><i className="tone-default" /><Star size={12} />默认分支</span><span><i className="tone-protected" /><ShieldCheck size={12} />受保护分支</span><span><i className="tone-regular" /><GitBranch size={12} />普通分支</span><small>位置仅用于浏览，不表示分支继承关系</small></div>
  </section>;
}
