'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUpRight, GitBranch, GitCommitHorizontal, Pause, Play, ShieldCheck, Star } from 'lucide-react';
import type { RepositoryBranch } from '@/contracts/branches';
import './branch-orbit-field.css';

export function BranchOrbitField({ branches, defaultBranch, disabled, active, onSelect, scrollMemory }: {
  branches: RepositoryBranch[]; defaultBranch?: string; disabled: boolean; active: boolean;
  onSelect: (name: string) => void; scrollMemory: RefObject<number>;
}) {
  const field = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

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
  }, [branches, active]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scrollMemory.current; }, [scrollMemory]);

  return <section ref={field} className={`branch-orbit-field${branches.length <= 2 ? ' is-sparse' : ''}`} aria-label="分支可视化导航" aria-busy={disabled} data-running={active && visible && tabVisible && !paused && !reduced}>
    <div className="branch-orbit-caption"><span><GitBranch size={14} />选择目标分支，查看计划合入的 PR</span><button type="button" aria-label={reduced ? '已遵循系统设置，减少动态效果' : paused ? '继续分支动效' : '暂停分支动效'} aria-pressed={paused || reduced} disabled={reduced} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={13} /> : <Pause size={13} />}{reduced ? '静态展示' : paused ? '继续动效' : '暂停动效'}</button></div>
    <div className="branch-orbit-viewport">
      <div className={`branch-orbit-space${branches.length <= 2 ? ' is-sparse' : ''}`} ref={scroller} onScroll={event => { scrollMemory.current = event.currentTarget.scrollTop; }}>
        <div className="branch-orbit-layout">
          {branches.map(branch => {
            const isDefault = branch.name === defaultBranch;
            const tone = isDefault ? 'default' : branch.protected ? 'protected' : 'regular';
            return <button key={branch.name} className={`branch-portal branch-portal-${tone}`} type="button" disabled={disabled} onClick={() => onSelect(branch.name)} aria-label={`展开 ${branch.name} 分支的开放 PR${isDefault ? '，默认分支' : ''}${branch.protected ? '，受保护' : ''}`}>
              <span className="branch-portal-art" aria-hidden="true">
                <svg className="branch-portal-dial" viewBox="0 0 160 144" fill="none">
                  <path className="branch-dial-ticks" d="M80 8v5m0 118v5M16 72h5m118 0h5M35 27l4 4m82 82 4 4M35 117l4-4m82-82 4-4" />
                  <circle className="branch-dial-track" cx="80" cy="72" r="51" />
                  <circle className="branch-dial-trace" cx="80" cy="72" r="51" pathLength="100" />
                  <circle className="branch-dial-inner" cx="80" cy="72" r="40" />
                  <g className="branch-dial-signal"><circle cx="80" cy="21" r="3" /><circle cx="80" cy="123" r="2" /></g>
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
    <div className="branch-orbit-legend"><span><i className="tone-default" /><Star size={12} />默认分支</span><span><i className="tone-protected" /><ShieldCheck size={12} />受保护分支</span><span><i className="tone-regular" /><GitBranch size={12} />普通分支</span><small>图形用于区分分支，PR 状态在进入后读取</small></div>
  </section>;
}
