"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, CheckCheck, CircleHelp, CircleDot, FileText, GitPullRequest, ScanLine, Sparkles } from "lucide-react";
import { ProjectShowcase, type ShowcaseProject } from "./project-showcase";
import { useOverview } from "./use-overview";
import "./overview.css";
import type { CheckResult } from "@/contracts/audit";

type Filter = "all" | "attention" | "unknown" | "pass";
const filterLabels: Record<Filter, string> = { all: "全部", attention: "待完善", unknown: "无法判断", pass: "已通过" };
const icons = { attention: CircleDot, unknown: CircleHelp, pass: CheckCheck };

function taskFor(check: CheckResult) {
  const displayStatus = check.status === "needs_attention" ? "attention" : check.status;
  const Icon = icons[displayStatus as keyof typeof icons] || FileText;
  return { ...check, displayStatus, Icon };
}

export function OverviewView({ onNotify }: { onNotify: (message: string) => void }) {
  const { overview, error, retry, counts: loadedCounts, countsLoading } = useOverview();
  const counts = loadedCounts || { issues: null, pulls: null };
  const [filter, setFilter] = useState<Filter>("all");
  const [dismissed, setDismissed] = useState(false);
  const report = overview?.report;
  if (error) return <section className="overview-empty" role="alert"><h1>暂时无法读取项目概览</h1><p>{error}</p><button className="button button-primary" onClick={retry}>重新读取</button></section>;
  if (!overview) return <div className="overview-empty"><span className="aw-spin" aria-hidden="true" />正在读取项目概览…</div>;
  if (!overview.project || !report) {
    const active = overview.latestRun && ["queued", "running"].includes(overview.latestRun.status);
    const primaryHref = active ? `/audit?run=${overview.latestRun!.id}` : overview.project ? "/audit?new=1" : "/projects";
    const primaryLabel = active ? "查看执行进度" : overview.project ? "开始项目体检" : "连接 GitHub 项目";
    return <section className="workspace-onboarding overview-onboarding"><div className="workspace-onboarding-copy"><span className="workspace-onboarding-icon"><ScanLine size={23} /></span><div className="eyebrow"><span className="tiny-square" /> 项目概览</div><h1>{active ? "项目体检正在进行中" : overview.project ? "项目已连接，下一步建立可信快照" : "从一个真实项目开始维护"}</h1><p>{active ? "执行完成后，这里会自动整理项目状态、检查证据与后续建议。" : overview.project ? `${overview.project.fullName} 已连接。先在固定提交上完成体检，再进入 Issue、PR 与交付流程。` : "连接 GitHub 仓库后，RepoCare 会把项目体检、协作审阅和改进草稿组织在同一个工作流中。"}</p><div className="workspace-onboarding-actions"><Link className="button button-primary" href={primaryHref}>{primaryLabel}<ArrowRight size={15} /></Link>{overview.project && !active && <Link className="button button-secondary" href="/issues">查看协作收件箱</Link>}</div></div><aside className="workspace-onboarding-flow" aria-label="维护工作流"><span>MAINTENANCE FLOW</span><ol><li><span>01</span><div><strong>连接项目</strong><p>选择仓库与分支，建立本次工作上下文。</p></div></li><li><span>02</span><div><strong>固定提交并体检</strong><p>在同一提交上检查文档、协作规范与工程基础。</p></div></li><li><span>03</span><div><strong>审阅并交付</strong><p>核对 Issue、PR 和草稿证据，由维护者做最终决定。</p></div></li></ol></aside></section>;
  }
  const checks = report.checks.map(taskFor);
  const filtered = checks.filter(check => filter === "all" || check.displayStatus === filter);
  const pass = checks.filter(check => check.status === "pass").length, attention = checks.filter(check => check.status === "needs_attention").length, unknown = checks.filter(check => check.status === "unknown").length;
  const project: ShowcaseProject = { fullName: report.repository.fullName, branch: report.repository.branch, sha: report.repository.sha, runId: report.runId, draftCount: overview.draftCount, issues: counts.issues, pulls: counts.pulls, countsLoading, checks: { pass, needsAttention: attention, unknown, docsNeedsAttention: checks.filter(check => check.category === "文档" && check.status === "needs_attention").length } };
  return <>
    <div className="overview-heading"><div><div className="eyebrow"><span className="tiny-square" /> 项目概览</div><h1>{report.repository.name}</h1><p>{report.repository.fullName} · {report.repository.branch} · {report.repository.sha.slice(0, 7)}</p></div><Link href="/audit?new=1" className="button button-secondary"><ScanLine size={16} />重新体检<ArrowUpRight size={15} /></Link></div>
    {overview.latestRun && overview.latestRun.id !== report.runId && <div className="overview-run-status" role="status"><span>{["queued", "running"].includes(overview.latestRun.status) ? "新体检正在进行，当前展示上一份成功报告。" : overview.latestRun.status === "cancelled" ? "最新体检已取消，已保留上一份成功报告。" : "最新体检未完成，已保留上一份成功报告。"}</span><Link href={`/audit?run=${overview.latestRun.id}`}>查看执行记录<ArrowRight size={14} /></Link></div>}
    <ProjectShowcase project={project} />
    <p className="overview-data-note">报告对应提交 {report.repository.sha.slice(0, 7)}；Issue / PR 为 GitHub 当前开放数量。{report.agentStatus === "disabled" ? "本次为基础规则体检，未包含 AI 内容分析。" : report.agentStatus === "failed" ? "本次 AI 分析未完成，已保留规则检查结果。" : ""}</p>
    <section className="overview-metrics" aria-label="项目概况"><Link href={`/audit?run=${report.runId}`} className="metric"><div className="metric-label"><ScanLine size={16} />维护基础<ArrowUpRight size={14} /></div><div className="metric-number">{pass}<span>/ {checks.length}</span></div><small>项检查通过<span>{attention} 项待完善</span></small></Link><Link href="/issues" className="metric"><div className="metric-label"><CircleDot size={16} />Issue 分诊<ArrowUpRight size={14} /></div><div className="metric-number">{counts.issues ?? '—'}{counts.issues !== null && <span className="metric-unit">条</span>}</div><small>{countsLoading ? '正在读取…' : counts.issues === null ? '暂时无法读取' : '当前开放 Issue 数'}</small></Link><Link href="/pull-requests" className="metric"><div className="metric-label"><GitPullRequest size={16} />PR 检查<ArrowUpRight size={14} /></div><div className="metric-number">{counts.pulls ?? '—'}{counts.pulls !== null && <span className="metric-unit">项</span>}</div><small>{countsLoading ? '正在读取…' : counts.pulls === null ? '暂时无法读取' : '当前开放 PR 数'}</small></Link><Link href="/improvements" className="metric"><div className="metric-label"><FileText size={16} />草稿与交付<ArrowUpRight size={14} /></div><div className="metric-number">{overview.draftCount}<span className="metric-unit">份待确认</span></div><small>根据体检生成的文件草稿</small></Link></section>
    {!countsLoading && (counts.issues === null || counts.pulls === null) && <p className="overview-data-note" role="status">部分 GitHub 数量暂不可用，体检报告仍可查看。<button type="button" onClick={retry}>重新读取</button></p>}
    <div className="overview-lower"><section className="task-section"><div className="section-heading"><div><span className="section-index">01</span><h2>体检检查项</h2><span className="count-pill">{filtered.length}</span></div><span className="section-note">固定提交 · 有据可查</span></div><div className="task-tabs" aria-label="筛选检查结果">{(Object.keys(filterLabels) as Filter[]).map(item => <button type="button" aria-pressed={filter === item} key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{filterLabels[item]}<span>{checks.filter(check => item === "all" || check.displayStatus === item).length}</span></button>)}</div><div className="task-list">{filtered.map(check => <Link className="task-row" key={check.id} href={`/audit?run=${report.runId}`}><span className={`task-icon ${check.displayStatus}`}><check.Icon size={18} strokeWidth={1.6} /></span><div className="task-content"><div className="task-title"><span>{check.title}</span><small>{check.category}</small></div><p>{check.summary}</p></div><div className="task-end"><span className={`status-tag ${check.displayStatus}`}>{checkLabels[check.status]}</span></div><ArrowRight size={16} className="task-chevron" /></Link>)}{!filtered.length && <div className="empty-state"><CheckCheck size={24} /><p>没有符合此筛选的检查项。</p></div>}</div><div className="task-list-footer"><span><CheckCheck size={14} />只读检查，不修改仓库</span><Link href={`/audit?run=${report.runId}`}>打开完整报告<ArrowRight size={14} /></Link></div></section><aside className="project-aside"><div className="section-heading"><div><span className="section-index">02</span><h2>项目一瞥</h2></div><ScanLine size={16} /></div><div className="project-brief"><div className="repo-heading"><span className="repo-monogram">{report.repository.name.slice(0, 1).toUpperCase()}</span><div><h3>{report.repository.name}</h3><span>{report.repository.fullName}</span></div><span className="public-label">{report.repository.language || "Repo"}</span></div><p>{report.repository.description || "已完成固定提交体检，可从检查项继续处理改进。"}</p><div className="repo-meta"><span><i />{report.repository.branch}</span><span>{report.repository.sha.slice(0, 7)}</span></div></div><div className="project-checks"><div><span>检查通过</span><span className="check-label"><CheckCheck size={13} />{pass} 项</span></div><div><span>待完善</span><Link href={`/audit?run=${report.runId}`}>{attention} 项<ArrowUpRight size={12} /></Link></div><div><span>无法判断</span><span>{unknown} 项</span></div></div></aside></div>
    {!dismissed && <section className="insight-strip"><div className="insight-icon"><Sparkles size={20} strokeWidth={1.5} /></div><div><h3>报告已经准备好。</h3><p>先查看待完善项，再决定是否生成可编辑的改进草稿。</p></div><Link href="/improvements">生成改进草稿<ArrowRight size={16} /></Link><button className="icon-button" type="button" aria-label="暂时隐藏建议" onClick={() => { setDismissed(true); onNotify("建议已隐藏，仍可在草稿与交付中查看。"); }}><CheckCheck size={16} /></button></section>}
  </>;
}

const checkLabels = { pass: "已通过", needs_attention: "待完善", unknown: "无法判断" } as const;
