'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUpRight, GitBranch, GitCommitHorizontal, Pause, Play, ShieldCheck, Star } from 'lucide-react';
import type { RepositoryBranch } from '@/contracts/branches';
import './branch-orbit-field.css';

type Scene = ReturnType<typeof import('./branch-orbit-scene').createBranchOrbitScene>;

export function BranchOrbitField({ branches, defaultBranch, disabled, active, onSelect, scrollMemory }: {
  branches: RepositoryBranch[]; defaultBranch?: string; disabled: boolean; active: boolean;
  onSelect: (name: string) => void; scrollMemory: RefObject<number>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    change(); preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!active || !branches.length) return;
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      scene.current?.dispose(); scene.current = null;
      setStatus('fallback');
    };
    setStatus('loading');
    import('./branch-orbit-scene').then(({ createBranchOrbitScene }) => {
      if (cancelled || !host.current || !scroller.current) return;
      try {
        scene.current = createBranchOrbitScene(host.current, scroller.current, fail);
        scene.current.pause(true); setStatus('ready');
      } catch { fail(); }
    }).catch(fail);
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; };
  }, [active, branches]);

  useEffect(() => { scene.current?.pause(paused || reduced); }, [paused, reduced, status]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scrollMemory.current; }, [scrollMemory]);

  return <section className="branch-orbit-field" aria-label="分支星港">
    <div className="branch-orbit-caption"><span><GitBranch size={14} />点击分支，展开 PR 汇流图</span><button type="button" aria-label={paused ? '继续分支动效' : '暂停分支动效'} aria-pressed={paused || reduced} disabled={status !== 'ready' || reduced} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={13} /> : <Pause size={13} />}{reduced ? '静态展示' : paused ? '继续动效' : '暂停动效'}</button></div>
    <div className="branch-orbit-viewport" ref={host}>
      <div className={`branch-orbit-space${branches.length <= 2 ? ' is-sparse' : ''}`} ref={scroller} onScroll={event => { scrollMemory.current = event.currentTarget.scrollTop; }}>
        <div className="branch-orbit-layout">
          {branches.map(branch => {
            const isDefault = branch.name === defaultBranch;
            const tone = isDefault ? 'default' : branch.protected ? 'protected' : 'regular';
            return <button key={branch.name} className={`branch-portal branch-portal-${tone}`} type="button" disabled={disabled} onClick={() => onSelect(branch.name)} aria-label={`展开 ${branch.name} 分支的开放 PR${isDefault ? '，默认分支' : ''}${branch.protected ? '，受保护' : ''}`}>
              <span className="branch-portal-art" data-branch-portal={branch.name} data-tone={tone} aria-hidden="true">
                <svg className="branch-portal-fallback" viewBox="0 0 180 150" fill="none"><ellipse cx="90" cy="75" rx="61" ry="36" transform="rotate(-28 90 75)" /><ellipse cx="90" cy="75" rx="57" ry="39" transform="rotate(48 90 75)" /><circle cx="90" cy="75" r="45" strokeDasharray="3 8" /><path d="m90 54 19 11v22L90 98 71 87V65Z M71 65l19 11 19-11M90 76v22M90 54v22" /></svg>
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
    <div className="branch-orbit-legend"><span><i className="tone-default" /><Star size={12} />默认分支</span><span><i className="tone-protected" /><ShieldCheck size={12} />受保护分支</span><span><i className="tone-regular" /><GitBranch size={12} />普通分支</span><small>{status === 'fallback' ? '已切换静态图形，分支仍可正常打开' : '环形仅作分支标识，不表示合并关系或活跃程度'}</small></div>
  </section>;
}
