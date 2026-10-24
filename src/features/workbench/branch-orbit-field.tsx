'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Copy, LocateFixed, Pause, Play, ShieldCheck, Star } from 'lucide-react';
import type { RepositoryBranch } from '@/contracts/branches';
import { groupBranches, layoutStarSky, starLabel, type SkyConstellation, type StarSky } from './branch-field-layout';
import './branch-orbit-field.css';

const spark = (x: number, y: number, outer: number, inner: number) =>
  Array.from({ length: 8 }, (_, index) => {
    const radius = index % 2 ? inner : outer;
    const angle = index * Math.PI / 4 - Math.PI / 2;
    return `${index ? 'L' : 'M'}${(x + Math.cos(angle) * radius).toFixed(2)} ${(y + Math.sin(angle) * radius).toFixed(2)}`;
  }).join('') + 'Z';
const route = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2, dx = to.x - from.x, dy = to.y - from.y;
  return `M${from.x} ${from.y} Q${(mx - dy * .18).toFixed(1)} ${(my + dx * .18).toFixed(1)} ${to.x} ${to.y}`;
};
const shortSha = (sha?: string) => sha ? sha.slice(0, 7) : '—';

/** A thumbnail of the constellation's real shape in the sky, drawn beside its card title. */
function ConstellationMark({ group }: { group?: SkyConstellation }) {
  if (!group?.stars.length) return <svg className="star-card-mark" viewBox="0 0 44 26" aria-hidden="true"><circle cx="22" cy="13" r="2" /></svg>;
  const xs = group.stars.map(star => star.x), ys = group.stars.map(star => star.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), spanX = Math.max(1, Math.max(...xs) - minX), spanY = Math.max(1, Math.max(...ys) - minY);
  const scale = Math.min(36 / spanX, 18 / spanY, 1.2);
  const map = (x: number, y: number) => [22 + (x - minX - spanX / 2) * scale, 13 + (y - minY - spanY / 2) * scale];
  return <svg className="star-card-mark" viewBox="0 0 44 26" aria-hidden="true">
    {group.edges.map(([x1, y1, x2, y2], index) => { const [a, b] = map(x1, y1), [c, d] = map(x2, y2); return <line key={index} x1={a} y1={b} x2={c} y2={d} />; })}
    {group.stars.slice(0, 40).map(star => { const [x, y] = map(star.x, star.y); return <circle key={star.branch.name} cx={x} cy={y} r={star.branch.protected ? 1.9 : 1.3} />; })}
  </svg>;
}

function RowGlyph({ kind }: { kind: 'pole' | 'protected' | 'regular' }) {
  return <svg className={`star-glyph is-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
    {kind === 'pole' ? <path d={spark(8, 8, 7, 2)} /> : kind === 'protected' ? <><circle className="ring" cx="8" cy="8" r="5.4" /><circle cx="8" cy="8" r="2.4" /></> : <circle cx="8" cy="8" r="2.4" />}
  </svg>;
}

export function BranchOrbitField({ branches, defaultBranch, disabled, active, onSelect, scrollMemory, actionsHost }: {
  branches: RepositoryBranch[]; defaultBranch?: string; disabled: boolean; active: boolean;
  onSelect: (name: string) => void; scrollMemory: RefObject<{ top: number; left: number } | null>;
  actionsHost: HTMLDivElement | null;
}) {
  const field = useRef<HTMLElement>(null);
  const skyHost = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [skyWidth, setSkyWidth] = useState(0);
  const [skyFill, setSkyFill] = useState(0);
  const [maximumHeight, setMaximumHeight] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [focusGroup, setFocusGroup] = useState<string>();
  const [copyResult, setCopyResult] = useState<{ name: string; success: boolean }>();

  const grouping = useMemo(() => groupBranches(branches, defaultBranch), [branches, defaultBranch]);
  const skyHeight = skyWidth && skyWidth < 520 ? 250 : Math.max(250, Math.min(360, Math.round((skyWidth || 900) * .4)));
  const sky: StarSky = useMemo(() => layoutStarSky(grouping.groups, grouping.pole, skyWidth || 900, Math.max(skyHeight, skyFill)), [grouping, skyWidth, skyHeight, skyFill]);
  const starOf = useMemo(() => new Map(sky.constellations.flatMap(group => group.stars.map(star => [star.branch.name, star] as const))), [sky]);
  const constellationOf = useMemo(() => new Map(sky.constellations.map(group => [group.key, group] as const)), [sky]);
  const selectedBranch = branches.find(branch => branch.name === selected) ?? grouping.pole ?? branches[0];
  const lit = hovered ?? selectedBranch?.name;
  const litStar = lit ? starOf.get(lit) : undefined;
  const activeFocus = focusGroup !== undefined && grouping.groups.some(group => group.key === focusGroup) ? focusGroup : undefined;
  const selectedGroup = selectedBranch && selectedBranch !== grouping.pole ? grouping.groups.find(group => group.members.includes(selectedBranch)) : undefined;

  useEffect(() => {
    const element = skyHost.current, list = scroller.current;
    if (!element || !list) return;
    const atlas = field.current?.parentElement;
    const resize = () => {
      if (!element.getClientRects().length) return;
      if (element.clientWidth) setSkyWidth(element.clientWidth);
      setSkyFill(element.clientHeight);
      const footer = atlas?.querySelector('.branch-atlas-footer')?.getBoundingClientRect().height ?? 0;
      setMaximumHeight(Math.max(260, Math.min(900, Math.floor(window.innerHeight - list.getBoundingClientRect().top - footer - 20))));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element); if (atlas) observer.observe(atlas);
    window.addEventListener('resize', resize); resize();
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
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
    const element = scroller.current;
    if (!element) return;
    element.scrollTo(scrollMemory.current ?? { left: 0, top: 0 });
  }, [scrollMemory]);

  function reveal(name: string) {
    const row = scroller.current?.querySelector<HTMLElement>(`[data-branch="${CSS.escape(name)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
  function choose(name: string) { setSelected(name); reveal(name); }
  function locateDefault() {
    if (!grouping.pole || !scroller.current) return;
    scroller.current.scrollTo({ top: 0 });
    scroller.current.querySelector<HTMLButtonElement>('.star-card.is-pole .star-select')?.focus({ preventScroll: true });
    setSelected(grouping.pole.name);
  }
  async function copyBranch(name: string) {
    try { await navigator.clipboard.writeText(name); setCopyResult({ name, success: true }); }
    catch { setCopyResult({ name, success: false }); }
  }

  const running = active && visible && tabVisible && !paused && !reduced;
  const dim = (key: string) => activeFocus !== undefined && activeFocus !== key;
  const kindOf = (branch: RepositoryBranch) => branch === grouping.pole ? 'pole' : branch.protected ? 'protected' : 'regular';
  const tipStar = hovered ? starOf.get(hovered) : undefined;

  function row(branch: RepositoryBranch, group: string, hue: number) {
    const name = branch.name;
    const isSelected = selectedBranch?.name === name;
    const kind = kindOf(branch);
    return <div key={name} data-branch={name} className={`star-row hue-${hue}${isSelected ? ' is-selected' : ''}${lit === name ? ' is-lit' : ''}`} onFocus={() => setSelected(name)} onPointerEnter={() => setHovered(name)} onPointerLeave={() => setHovered(undefined)}>
      <button className="star-select" type="button" disabled={disabled} aria-pressed={isSelected} aria-label={`查看 ${name} 分支详情`} title={name} onClick={() => setSelected(name)}>
        <RowGlyph kind={kind} />
        <span className="star-label">{starLabel(name, group)}</span>
        {branch.protected && kind !== 'pole' && <ShieldCheck className="star-shield" size={13} aria-hidden="true" />}
        <code className="star-sha">{shortSha(branch.commitSha)}</code>
      </button>
      <button type="button" className="star-action" disabled={disabled} onClick={() => onSelect(name)} aria-label={`展开 ${name} 分支的开放 PR${kind === 'pole' ? '，默认分支' : ''}${branch.protected ? '，受保护' : ''}`} title="展开开放 PR">PR<ArrowUpRight size={13} aria-hidden="true" /></button>
    </div>;
  }

  return <section ref={field} className="branch-orbit-field star-chart" aria-label="分支可视化导航" aria-busy={disabled} data-running={running}>
    {actionsHost && createPortal(<>{grouping.pole && <button type="button" className="branch-map-control" title="定位默认分支" aria-label="定位默认分支" onClick={locateDefault}><LocateFixed size={15} /></button>}<button type="button" className="branch-map-control" title={reduced ? '已遵循系统设置，减少动态效果' : paused ? '继续星图动效' : '暂停星图动效'} aria-label={reduced ? '已遵循系统设置，减少动态效果' : paused ? '继续分支动效' : '暂停分支动效'} aria-pressed={paused || reduced} disabled={reduced} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={15} /> : <Pause size={15} />}</button></>, actionsHost)}

    <div className="star-observatory">
      <div className="star-sky" ref={skyHost} style={{ minHeight: skyHeight }}>
        <svg width={sky.width} height={sky.height} viewBox={`0 0 ${sky.width} ${sky.height}`} aria-hidden="true" data-focus={activeFocus !== undefined}>
          <defs>
            <radialGradient id="sky-pole-glow"><stop offset="0" stopColor="var(--sky-pole)" stopOpacity=".55" /><stop offset="1" stopColor="var(--sky-pole)" stopOpacity="0" /></radialGradient>
            <linearGradient id="sky-milky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9fd6d1" stopOpacity="0" /><stop offset=".45" stopColor="#9fd6d1" stopOpacity=".055" /><stop offset=".6" stopColor="#c7b6e6" stopOpacity=".045" /><stop offset="1" stopColor="#c7b6e6" stopOpacity="0" /></linearGradient>
          </defs>
          <ellipse className="sky-milky" cx={sky.center.x} cy={sky.center.y} rx={sky.rx * 1.15} ry={sky.ry * .32} transform={`rotate(-16 ${sky.center.x} ${sky.center.y})`} fill="url(#sky-milky)" />
          <g className="sky-orbits">{[.4, .68, .97].map(scale => <ellipse key={scale} cx={sky.center.x} cy={sky.center.y} rx={sky.rx * scale} ry={sky.ry * scale} />)}</g>
          <g className="sky-dust">{sky.dust.map((dot, index) => <circle key={index} className={dot.twinkle ? 'is-twinkle' : undefined} cx={dot.x} cy={dot.y} r={dot.r} style={{ opacity: dot.o, '--delay': `${index * 397 % 6000}ms` } as CSSProperties} />)}</g>
          {sky.pole && litStar && <path className={`sky-route hue-${litStar.hue}`} d={route(sky.pole, litStar)} />}
          {sky.constellations.map(group => <g key={group.key} className={`sky-constellation hue-${group.hue}${dim(group.key) ? ' is-dim' : ''}${litStar?.group === group.key ? ' is-lit' : ''}`}>
            {group.edges.map(([x1, y1, x2, y2], index) => <line key={index} className="sky-line" x1={x1} y1={y1} x2={x2} y2={y2} />)}
            {group.stars.map(star => {
              const isLit = star.branch.name === lit, isSelected = star.branch.name === selectedBranch?.name;
              return <g key={star.branch.name} className={`sky-star${isLit ? ' is-lit' : ''}`} onPointerEnter={() => setHovered(star.branch.name)} onPointerLeave={() => setHovered(undefined)} onClick={() => !disabled && choose(star.branch.name)}>
                <circle className="sky-hit" cx={star.x} cy={star.y} r={9} />
                <circle className="sky-halo" cx={star.x} cy={star.y} r={isLit ? star.r * 5 : star.r * 3} />
                {star.branch.protected && <circle className="sky-ring" cx={star.x} cy={star.y} r={star.r + 3.2} />}
                {isSelected && <circle className="sky-pulse" cx={star.x} cy={star.y} r={star.r + 6} />}
                {isLit ? <path className="sky-core" d={spark(star.x, star.y, star.r * 3, star.r * .8)} /> : <circle className="sky-core" cx={star.x} cy={star.y} r={star.r} />}
              </g>;
            })}
            <text className="sky-label" x={group.label.x} y={group.label.y} textAnchor={group.label.anchor}>{group.title}<tspan dx="5">{group.stars.length}</tspan></text>
          </g>)}
          {sky.pole && <g className={`sky-pole${lit === sky.pole.branch.name ? ' is-lit' : ''}`} onPointerEnter={() => setHovered(sky.pole?.branch.name)} onPointerLeave={() => setHovered(undefined)} onClick={() => !disabled && sky.pole && choose(sky.pole.branch.name)}>
            <circle cx={sky.pole.x} cy={sky.pole.y} r={44} fill="url(#sky-pole-glow)" />
            <circle className="sky-pole-orbit" cx={sky.pole.x} cy={sky.pole.y} r={22} />
            <g className="sky-pole-rays"><path d={spark(sky.pole.x, sky.pole.y, 19, 2.6)} /></g>
            <path className="sky-pole-core" d={spark(sky.pole.x, sky.pole.y, 12, 3.2)} />
            <text className="sky-pole-name" x={sky.pole.x} y={sky.pole.y + 38} textAnchor="middle">{sky.pole.branch.name}</text>
          </g>}
          {tipStar && <text className="sky-tip" x={Math.min(sky.width - 8, Math.max(8, tipStar.x))} y={tipStar.y > 34 ? tipStar.y - 14 : tipStar.y + 22} textAnchor={tipStar.x > sky.width - 120 ? 'end' : tipStar.x < 120 ? 'start' : 'middle'}>{tipStar.branch.name}</text>}
        </svg>
        <div className="sky-legend" aria-hidden="true"><span><RowGlyph kind="pole" />默认</span><span><RowGlyph kind="protected" />受保护</span><span><RowGlyph kind="regular" />普通</span><span className="sky-legend-note">星座＝同一名称前缀 · 位置不表示继承</span></div>
      </div>

      {selectedBranch && <section className="branch-selection-detail star-panel" aria-label="选中分支详情">
        <span className="star-panel-eyebrow">{selectedBranch === grouping.pole ? '北极星 · 默认分支' : `观测中 · ${selectedGroup?.title ?? '分支'}`}</span>
        <strong className="star-panel-name">{selectedBranch.name}</strong>
        <div className="star-panel-badges">{selectedBranch === grouping.pole && <em className="is-pole"><Star size={11} aria-hidden="true" />默认分支</em>}{selectedBranch.protected ? <em className="is-protected"><ShieldCheck size={11} aria-hidden="true" />受保护</em> : <em>普通分支</em>}</div>
        <dl className="star-panel-facts"><div><dt>最新提交</dt><dd><code>{selectedBranch.commitSha || '未知'}</code></dd></div></dl>
        {selectedGroup ? <div className="star-panel-siblings"><span>同星座 · {selectedGroup.title}（{selectedGroup.members.length}）</span><div>{selectedGroup.members.filter(branch => branch !== selectedBranch).slice(0, 6).map(branch => <button type="button" key={branch.name} className={`hue-${selectedGroup.hue}`} title={branch.name} aria-label={`切换到 ${branch.name}`} onClick={() => choose(branch.name)}>{starLabel(branch.name, selectedGroup.key)}</button>)}{selectedGroup.members.length === 1 && <small>这个星座只有它一颗星</small>}{selectedGroup.members.length > 7 && <small>另有 {selectedGroup.members.length - 7} 个见下方星表</small>}</div></div>
          : <div className="star-panel-stats"><div><b>{branches.length}</b><span>分支</span></div><div><b>{grouping.groups.length}</b><span>星座</span></div><div><b>{branches.filter(branch => branch.protected).length}</b><span>受保护</span></div></div>}
        <div className="branch-selection-actions"><button type="button" className="button button-primary" disabled={disabled} onClick={() => onSelect(selectedBranch.name)}>查看开放 PR<ArrowUpRight size={14} aria-hidden="true" /></button><button type="button" className="button button-secondary" aria-label="复制分支名" onClick={() => void copyBranch(selectedBranch.name)}>{copyResult?.name === selectedBranch.name && copyResult.success ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}复制名称</button></div>
        <span className="star-panel-status" role="status">{copyResult?.name === selectedBranch.name ? copyResult.success ? '已复制分支名' : '复制失败，请选中名称手动复制' : '点击星星或下方星表切换分支'}</span>
      </section>}
    </div>

    <div className="branch-orbit-space star-catalog-scroll" ref={scroller} style={{ maxHeight: maximumHeight }} tabIndex={0} aria-label="分支星表，可用方向键滚动，Tab 选择分支" onScroll={event => { scrollMemory.current = { top: event.currentTarget.scrollTop, left: 0 }; }}>
      <div className="star-catalog">
        {grouping.pole && <section className="star-card is-pole" aria-label="默认分支">
          <header><svg className="star-card-mark" viewBox="0 0 44 26" aria-hidden="true"><path d={spark(22, 13, 10, 2.6)} /></svg><span>北极星</span><small>默认分支</small></header>
          {row(grouping.pole, '', 0)}
        </section>}
        {grouping.groups.map(group => <section key={group.key} className={`star-card hue-${group.hue}${dim(group.key) ? ' is-dim' : ''}${activeFocus === group.key ? ' is-focus' : ''}`} aria-label={`${group.title} 星座`}>
          <header><button type="button" className="star-card-title" aria-pressed={activeFocus === group.key} aria-label={`${activeFocus === group.key ? '取消突出' : '突出'} ${group.title} 星座，${group.members.length} 个分支`} title={activeFocus === group.key ? '取消突出此星座' : '在星空中突出此星座'} onClick={() => setFocusGroup(value => value === group.key ? undefined : group.key)}>
            <ConstellationMark group={constellationOf.get(group.key)} /><span>{group.title}</span><small>{group.members.length}</small>
          </button></header>
          {group.members.map(branch => row(branch, group.key, group.hue))}
        </section>)}
      </div>
    </div>
  </section>;
}
