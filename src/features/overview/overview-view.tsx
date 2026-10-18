"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCheck, CircleDot, Clock3, FileText, GitPullRequest, LoaderCircle, Route, ScanLine } from "lucide-react";
import { ProjectShowcase, type ShowcaseProject } from "./project-showcase";
import { useOverview } from "./use-overview";
import "./overview.css";

const OverviewInsights = dynamic(() => import("./overview-insights").then(module => module.OverviewInsights), {
  ssr: false,
  loading: () => <div className="oi-loading" role="status">正在整理维护观测…</div>,
});

export function OverviewView(_props: { onNotify: (message: string) => void }) {
  const [showMap, setShowMap] = useState(false);
  const { overview, error, retry, counts: loadedCounts, countsLoading } = useOverview();
  const counts = loadedCounts || { issues: null, pulls: null };
  const report = overview?.report;
  if (error) return <section className="overview-empty" role="alert"><h1>暂时无法读取项目概览</h1><p>{error}</p><button className="button button-primary" onClick={retry}>重新读取</button></section>;
  if (!overview) return <div className="overview-empty"><span className="aw-spin" aria-hidden="true" />正在读取项目概览…</div>;
  if (!overview.project || !report) {
    const active = overview.latestRun && ["queued", "running"].includes(overview.latestRun.status);
    const primaryHref = active ? `/audit?run=${overview.latestRun!.id}` : overview.project ? "/audit?new=1" : "/projects";
    const primaryLabel = active ? "查看执行进度" : overview.project ? "开始项目体检" : "连接 GitHub 项目";
    return <section className="workspace-onboarding overview-onboarding"><div className="workspace-onboarding-copy"><span className="workspace-onboarding-icon"><ScanLine size={23} /></span><div className="eyebrow"><span className="tiny-square" /> 项目概览</div><h1>{active ? "项目体检正在进行中" : overview.project ? "项目已连接，下一步建立可信快照" : "从一个真实项目开始维护"}</h1><p>{active ? "执行完成后，这里会自动整理项目状态、检查证据与后续建议。" : overview.project ? `${overview.project.fullName} 已连接。先在固定提交上完成体检，再进入 Issue、PR 与交付流程。` : "连接 GitHub 仓库后，RepoCare 会把项目体检、协作审阅和改进草稿组织在同一个工作流中。"}</p><div className="workspace-onboarding-actions"><Link className="button button-primary" href={primaryHref}>{primaryLabel}<ArrowRight size={15} /></Link>{overview.project && !active && <Link className="button button-secondary" href="/issues">查看协作收件箱</Link>}</div></div><aside className="workspace-onboarding-flow" aria-label="维护工作流"><span>MAINTENANCE FLOW</span><ol><li><span>01</span><div><strong>连接项目</strong><p>选择仓库与分支，建立本次工作上下文。</p></div></li><li><span>02</span><div><strong>固定提交并体检</strong><p>在同一提交上检查文档、协作规范与工程基础。</p></div></li><li><span>03</span><div><strong>审阅并交付</strong><p>核对 Issue、PR 和草稿证据，由维护者做最终决定。</p></div></li></ol></aside></section>;
  }
  const checks = report.checks;
  const pass = checks.filter(check => check.status === "pass").length, attention = checks.filter(check => check.status === "needs_attention").length, unknown = checks.filter(check => check.status === "unknown").length;
  const project: ShowcaseProject = { fullName: report.repository.fullName, branch: report.repository.branch, sha: report.repository.sha, runId: report.runId, draftCount: overview.draftCount, issues: counts.issues, pulls: counts.pulls, countsLoading, checks: { pass, needsAttention: attention, unknown, docsNeedsAttention: checks.filter(check => check.category === "文档" && check.status === "needs_attention").length } };
  const journey = overview.journey;
  const journeyStale = Boolean(journey?.commitSha && journey.commitSha !== report.repository.sha);
  const journeyActive = Boolean(journey && ["queued", "running"].includes(journey.status));
  const journeyPassed = Boolean(journey && journey.status === "reproduced" && !journeyStale);
  const journeyBlocked = Boolean(journey && ["not-reproduced", "blocked", "unsafe", "failed"].includes(journey.status) && !journeyStale);
  const journeyReview = Boolean(journey?.status === "awaiting-confirmation" && !journeyStale);
  const journeyLabel = journeyStale ? "需要重新验证" : journeyActive ? "正在验证" : journeyPassed ? "路径已走通" : journeyReview ? "计划待确认" : journey ? ({ "not-reproduced": "发现贡献阻塞", blocked: "Runner 环境阻塞", unsafe: "计划未通过校验", failed: "验证执行失败", cancelled: "验证已取消", draft: "正在准备计划" } as Record<string, string>)[journey.status] || "尚未验证" : "尚未验证";
  const journeyCopy = journeyStale ? "项目提交已经变化，请在当前固定提交上重新演练。" : journey?.progress || "从 README、CONTRIBUTING 和项目脚本生成可审阅的执行计划。";
  return <>
    <div className="overview-heading"><div><div className="eyebrow"><span className="tiny-square" /> 项目概览</div><h1>{report.repository.name}</h1><p>{report.repository.fullName} · {report.repository.branch} · {report.repository.sha.slice(0, 7)}</p></div><Link href="/audit?new=1" className="button button-secondary"><ScanLine size={16} />重新体检<ArrowUpRight size={15} /></Link></div>
    {overview.latestRun && overview.latestRun.id !== report.runId && <div className="overview-run-status" role="status"><span>{["queued", "running"].includes(overview.latestRun.status) ? "新体检正在进行，当前展示上一份成功报告。" : overview.latestRun.status === "cancelled" ? "最新体检已取消，已保留上一份成功报告。" : "最新体检未完成，已保留上一份成功报告。"}</span><Link href={`/audit?run=${overview.latestRun.id}`}>查看执行记录<ArrowRight size={14} /></Link></div>}
    <p className="overview-data-note">报告对应提交 {report.repository.sha.slice(0, 7)}；Issue / PR 为 GitHub 当前开放数量。{report.agentStatus === "disabled" ? "本次为基础规则体检，未包含 AI 内容分析。" : report.agentStatus === "failed" ? "本次 AI 分析未完成，已保留规则检查结果。" : ""}</p>
    <section className="overview-metrics" aria-label="项目概况"><Link href={`/audit?run=${report.runId}&tab=report`} className="metric"><div className="metric-label"><ScanLine size={16} />维护基础<ArrowUpRight size={14} /></div><div className="metric-number">{pass}<span>/ {checks.length}</span></div><small>项检查通过<span>{attention} 项待完善</span></small></Link><Link href="/issues" className="metric"><div className="metric-label"><CircleDot size={16} />Issue 分诊<ArrowUpRight size={14} /></div><div className="metric-number">{counts.issues ?? '—'}{counts.issues !== null && <span className="metric-unit">条</span>}</div><small>{countsLoading ? '正在读取…' : counts.issues === null ? '暂时无法读取' : '当前开放 Issue 数'}</small></Link><Link href="/pull-requests" className="metric"><div className="metric-label"><GitPullRequest size={16} />PR 检查<ArrowUpRight size={14} /></div><div className="metric-number">{counts.pulls ?? '—'}{counts.pulls !== null && <span className="metric-unit">项</span>}</div><small>{countsLoading ? '正在读取…' : counts.pulls === null ? '暂时无法读取' : '当前开放 PR 数'}</small></Link><Link href="/improvements" className="metric"><div className="metric-label"><FileText size={16} />草稿与交付<ArrowUpRight size={14} /></div><div className="metric-number">{overview.draftCount}<span className="metric-unit">份待确认</span></div><small>根据体检生成的文件草稿</small></Link></section>
    <Link className={`overview-journey ${journeyPassed ? "is-passed" : journeyActive ? "is-active" : journeyReview ? "is-review" : journeyBlocked ? "is-blocked" : ""}`} href={`/audit?run=${report.runId}&tab=journey`}><span className="overview-journey-icon">{journeyActive ? <LoaderCircle size={20} className="aw-spin" /> : journeyPassed ? <CheckCheck size={20} /> : journeyBlocked ? <AlertTriangle size={20} /> : journeyReview ? <Clock3 size={20} /> : <Route size={20} />}</span><div><span>贡献路径验证</span><h2>{journeyLabel}</h2><p>{journeyCopy}</p></div><span className="overview-journey-action">{journey ? "查看验证证据" : "生成演练计划"}<ArrowRight size={15} /></span></Link>
    <details className="overview-map-disclosure" onToggle={event => setShowMap(event.currentTarget.open)}><summary>项目维护地图<span>展开查看项目结构与各维护入口</span></summary>{showMap && <ProjectShowcase project={project} />}</details>
    {!countsLoading && (counts.issues === null || counts.pulls === null) && <p className="overview-data-note" role="status">部分 GitHub 数量暂不可用，体检报告仍可查看。<button type="button" onClick={retry}>重新读取</button></p>}
    <OverviewInsights key={report.runId} report={report} history={overview.history} />
  </>;
}
