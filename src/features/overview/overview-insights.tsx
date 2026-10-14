'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, ChevronRight, CircleHelp, FileText, ListFilter, RotateCcw, ScanLine } from 'lucide-react';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AuditReport, Category, CheckStatus } from '@/contracts/audit';
import type { AuditHistoryPoint } from '@/contracts/overview';
import './overview-insights.css';

const statuses: { id: CheckStatus; label: string; color: string }[] = [
  { id: 'pass', label: '已通过', color: 'var(--oi-pass)' },
  { id: 'needs_attention', label: '待完善', color: 'var(--oi-attention)' },
  { id: 'unknown', label: '无法判断', color: 'var(--oi-unknown)' },
];
const categories: Category[] = ['文档', '协作', '工程'];
const percentage = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const statusLabel = (status: CheckStatus) => statuses.find(item => item.id === status)!.label;
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function reportHref(runId: string, category?: Category | null, status?: CheckStatus | null, check?: string) {
  const query = new URLSearchParams({ run: runId, tab: 'report' });
  if (category) query.set('category', category);
  if (status) query.set('status', status);
  if (check) query.set('check', check);
  return `/audit?${query}`;
}

function History({ points, report }: { points: AuditHistoryPoint[]; report: AuditReport }) {
  const [metric, setMetric] = useState<CheckStatus>('pass');
  const chartData = points.map((point, index) => ({ ...point, order: index + 1 }));
  const latest = points.at(-1);
  const comparable = points.length > 1 && points.every(point => point.checkSet === latest?.checkSet && point.agentStatus === latest?.agentStatus);
  const delta = comparable ? latest![metric] - points[0][metric] : null;
  return <section className="oi-panel oi-history" aria-labelledby="oi-history-title">
    <header className="oi-panel-heading"><div><h3 id="oi-history-title">维护变化</h3><p>最近 {points.length} 次成功体检 · 按任务创建顺序</p></div>{delta !== null && <span className="oi-delta">{delta > 0 ? <ArrowUpRight size={15} /> : delta < 0 ? <ArrowDownRight size={15} /> : null}{delta > 0 ? '+' : ''}{delta} 项<span>较首个快照</span></span>}</header>
    <div className="oi-series-tabs" aria-label="选择趋势指标">{statuses.map(item => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}><i className={`oi-dot is-${item.id}`} />{item.label}</button>)}</div>
    {points.length ? <div className="oi-line-chart" aria-label={`${statusLabel(metric)}数量，${points.map((point, index) => `第${index + 1}次${point[metric]}项`).join('，')}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={chartData} margin={{ top: 14, right: 18, bottom: 0, left: -28 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis dataKey="order" type="category" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={value => `第 ${value} 次`} minTickGap={14} dy={8} />
          <YAxis allowDecimals={false} domain={[0, 'auto']} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
          <Tooltip cursor={{ stroke: 'var(--accent-border)', strokeDasharray: '3 3' }} content={({ active, payload }) => {
            const point = payload?.[0]?.payload as AuditHistoryPoint | undefined;
            return active && point ? <div className="oi-tooltip" role="status"><strong>{timestamp(point.generatedAt)}</strong><span>提交 {point.sha.slice(0, 7)}</span><b>{statusLabel(metric)} {point[metric]} / {point.total} 项</b><span>{point.agentStatus === 'completed' ? '包含 AI 内容分析' : point.agentStatus === 'failed' ? 'AI 未完成，保留规则结果' : '基础规则检查'}</span></div> : null;
          }} />
          <Line type="stepAfter" dataKey={metric} name={statusLabel(metric)} stroke={statuses.find(item => item.id === metric)!.color} strokeWidth={2.5} strokeDasharray={metric === 'unknown' ? '5 4' : undefined} dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 6, strokeWidth: 3, fill: 'var(--surface)' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div> : <div className="oi-chart-empty"><ScanLine size={24} /><p>尚无历史快照</p></div>}
    <footer className="oi-history-footer"><p>{!points.length ? '历史快照暂不可用，当前报告仍可查看。' : points.length === 1 ? '当前仅有一个快照，再次体检后可观察变化。' : !comparable ? '检查范围或 AI 分析状态不同，数量仅供逐次查看。' : '每个点对应一份真实报告，折线仅连接相邻快照。'}</p><Link href={reportHref(report.runId)}>查看报告<ArrowUpRight size={13} /></Link></footer>
    <details className="oi-history-data"><summary>查看快照数据</summary><div><table><caption className="visually-hidden">当前仓库与分支的体检快照</caption><thead><tr><th>快照</th><th>已通过</th><th>待完善</th><th>未知</th><th>报告</th></tr></thead><tbody>{points.map((point, index) => <tr key={point.runId}><th scope="row">{index + 1}<span>{timestamp(point.generatedAt)}</span></th><td>{point.pass}</td><td>{point.needs_attention}</td><td>{point.unknown}</td><td><Link href={reportHref(point.runId)} aria-label={`打开第 ${index + 1} 次体检报告`}>{point.sha.slice(0, 7)}<ArrowUpRight size={12} /></Link></td></tr>)}</tbody></table></div></details>
  </section>;
}

export function OverviewInsights({ report, history = [] }: { report: AuditReport; history?: AuditHistoryPoint[] }) {
  const [status, setStatus] = useState<CheckStatus | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const patternId = `oi-unknown-${useId().replace(/:/g, '')}`;
  const counts = { pass: 0, needs_attention: 0, unknown: 0 };
  for (const check of report.checks) counts[check.status] += 1;
  const total = report.checks.length;
  const slices = statuses.map(item => ({ ...item, value: counts[item.id] })).filter(item => item.value > 0);
  const visible = report.checks.filter(check => (!status || check.status === status) && (!category || check.category === category));
  const actionable = visible.filter(check => check.status !== 'pass').sort((a, b) => Number(a.status === 'unknown') - Number(b.status === 'unknown'));
  const actions = (status === 'pass' ? visible : actionable).slice(0, 3);
  const selectStatus = (next: CheckStatus) => setStatus(previous => previous === next ? null : next);
  const selectedStatus = statuses.find(item => item.id === status);

  return <section className="oi-observatory" aria-labelledby="oi-title">
    <header className="oi-heading"><div><h2 id="oi-title">维护观测</h2><p>从整体状态，定位到每一项检查。</p></div><span><i />提交 <code>{report.repository.sha.slice(0, 7)}</code><time dateTime={report.generatedAt}>{timestamp(report.generatedAt)}</time></span></header>
    <div className="oi-grid">
      <section className="oi-panel oi-composition" aria-labelledby="oi-composition-title">
        <header className="oi-panel-heading"><div><h3 id="oi-composition-title">检查结果构成</h3><p>本次固定提交的 {total} 项检查</p></div><ScanLine size={17} aria-hidden="true" /></header>
        <div className="oi-composition-body"><div className="oi-donut" aria-label={statuses.map(item => `${item.label}${counts[item.id]}项`).join('，')}>
          {total > 0 ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><defs><pattern id={patternId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--oi-unknown)" /><line x1="0" y1="0" x2="0" y2="7" stroke="var(--surface)" strokeWidth="2" /></pattern></defs><Pie data={slices} dataKey="value" nameKey="label" innerRadius="72%" outerRadius="94%" paddingAngle={slices.length > 1 ? 4 : 0} cornerRadius={4} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false} onClick={(_, index) => selectStatus(slices[index].id)}>{slices.map(item => <Cell key={item.id} fill={item.id === 'unknown' ? `url(#${patternId})` : item.color} opacity={!status || status === item.id ? 1 : 0.25} cursor="pointer" />)}</Pie></PieChart></ResponsiveContainer> : <div className="oi-empty-ring" />}
          <div className="oi-donut-label" aria-hidden="true"><strong>{status ? counts[status] : total}</strong><span>{selectedStatus?.label || '项检查'}</span></div>
        </div><div className="oi-legend" aria-label="按检查状态筛选">{statuses.map(item => <button type="button" key={item.id} aria-pressed={status === item.id} onClick={() => selectStatus(item.id)}><i className={`oi-dot is-${item.id}`} /><span>{item.label}</span><strong>{counts[item.id]}</strong><small>{total ? percentage.format(counts[item.id] / total * 100) : 0}%</small></button>)}</div></div>
        <p className="oi-footnote"><CircleHelp size={13} />未知表示证据不足；检查构成不等于项目质量评分。</p>
      </section>

      <section className="oi-panel oi-categories" aria-labelledby="oi-categories-title">
        <header className="oi-panel-heading"><div><h3 id="oi-categories-title">维护基础分布</h3><p>按类别比较，点击色块查看对应结论</p></div><span className="oi-unit">单位：检查项</span></header>
        <div className="oi-category-chart">{categories.map(item => {
          const checks = report.checks.filter(check => check.category === item);
          const max = Math.max(1, ...categories.map(value => report.checks.filter(check => check.category === value).length));
          return <div className={`oi-category-row${category && category !== item ? ' is-muted' : ''}`} key={item}>
            <div className="oi-category-label"><button type="button" aria-pressed={category === item} onClick={() => setCategory(previous => previous === item ? null : item)}>{item}<ChevronRight size={12} /></button><span>{checks.length} 项</span></div>
            <div className="oi-category-track"><div className="oi-category-bar" style={{ width: `${checks.length / max * 100}%` }}>{statuses.map(state => {
              const count = checks.filter(check => check.status === state.id).length;
              return count ? <button className={`oi-segment is-${state.id}${status && status !== state.id ? ' is-muted' : ''}`} type="button" key={state.id} style={{ flexGrow: count }} aria-label={`${item}，${state.label} ${count} 项`} aria-pressed={category === item && status === state.id} onClick={() => { setCategory(item); setStatus(state.id); }}><span>{count}</span></button> : null;
            })}</div>{!checks.length && <span className="oi-no-category">本次无检查项</span>}</div>
          </div>;
        })}</div>
        <div className="oi-category-legend" aria-hidden="true">{statuses.map(item => <span key={item.id}><i className={`oi-dot is-${item.id}`} />{item.label}</span>)}<span>同一刻度 · 0 起点</span></div>
      </section>

      <History points={history} report={report} />

      <section className="oi-panel oi-actions" aria-labelledby="oi-actions-title">
        <header className="oi-panel-heading"><div><h3 id="oi-actions-title">{status === 'pass' ? '已通过的检查' : '接下来处理'}</h3><p aria-live="polite">{category || '全部类别'} · {status ? statusLabel(status) : '待完善优先，随后核实未知项'}</p></div>{status || category ? <button className="oi-reset" type="button" aria-label="清除图表筛选" onClick={() => { setStatus(null); setCategory(null); }}><RotateCcw size={15} /></button> : <ListFilter size={17} aria-hidden="true" />}</header>
        <div className="oi-action-list">{actions.map(check => <Link className="oi-action" key={check.id} href={reportHref(report.runId, category, status, check.id)}><span className={`oi-action-icon is-${check.status}`}>{check.status === 'pass' ? <Check size={16} /> : check.status === 'unknown' ? <CircleHelp size={16} /> : <FileText size={16} />}</span><div><h4>{check.title}</h4><p>{check.summary}</p><span>{check.category}<i />{statusLabel(check.status)}</span></div><ArrowUpRight size={15} /></Link>)}{!actions.length && <div className="oi-action-empty"><Check size={22} /><strong>{total === 0 ? '本次没有检查结果' : visible.length ? '当前范围无需补充改进' : '没有匹配的检查项'}</strong><p>{status || category ? '可清除筛选查看其他类别。' : total ? '可在完整报告中核对通过依据。' : '可重新发起体检获取检查结果。'}</p></div>}</div>
        <Link className="oi-report-link" href={reportHref(report.runId, category, status)}>{status || category ? `查看筛选结果（${visible.length}）` : '打开完整体检报告'}<ArrowUpRight size={14} /></Link>
      </section>
    </div>
  </section>;
}
