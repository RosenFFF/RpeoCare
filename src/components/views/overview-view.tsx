"use client";

import Link from "next/link";
import { ProjectShowcase } from "../project-showcase";
import { useDemoCounts } from "@/lib/use-demo-counts";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleDot, FileText, GitBranch, GitPullRequest, Globe2, ScanLine, ShieldCheck, Sparkles } from "lucide-react";

type Filter = "all" | "issue" | "pr" | "docs";
const tasks = [
  { id: "42", type: "issue", title: "Empty CSV raises IndexError", description: "Bug 反馈 · 待补充错误堆栈与复现文件", label: "需要分诊", meta: "中英混合", icon: CircleDot, href: "/issues?issue=42", date: "#42", tag: "amber" },
  { id: "45", type: "pr", title: "Handle empty CSV input gracefully", description: "2 个文件变更 · 建议核对边界测试", label: "等待审核", meta: "+14 −1", icon: GitPullRequest, href: "/pull-requests?pr=45", date: "#45", tag: "purple" },
  { id: "doc", type: "docs", title: "为贡献者补充一份清晰的指南", description: "CONTRIBUTING.md · 已准备改进草稿", label: "待确认", meta: "文档", icon: FileText, href: "/improvements?draft=contributing", date: "DOC", tag: "green" },
  { id: "39", type: "issue", title: "Add delimiter detection", description: "功能建议 · 待确认使用场景与预期行为", label: "需要分诊", meta: "English", icon: CircleDot, href: "/issues?issue=39", date: "#39", tag: "amber" },
] as const;

export function OverviewView({ onNotify }: { onNotify: (message: string) => void }) {
  const counts = useDemoCounts();
  const [filter, setFilter] = useState<Filter>("all");
  const [dismissed, setDismissed] = useState(false);
  const pendingTasks = tasks.filter(task => task.type === "issue" ? !counts.reviewedIssues.includes(Number(task.id)) : task.type === "pr" ? !counts.reviewedPRs.includes(Number(task.id)) : !counts.acceptedDocs.includes("contributing"));
  const filtered = pendingTasks.filter(task => filter === "all" || task.type === filter);
  return <>
    <div className="overview-heading"><div><div className="eyebrow"><span className="tiny-square"/> 项目概览</div><h1>你的项目，照料有序。</h1><p>从项目现状到下一步行动，在这里看清维护全貌。</p></div><Link href="/audit" className="button button-secondary"><ScanLine size={16}/>运行项目体检<ArrowUpRight size={15}/></Link></div>

    <ProjectShowcase />

    <section className="overview-metrics" aria-label="项目概况"><Link href="/audit" className="metric"><div className="metric-label"><ScanLine size={16}/>维护基础<ArrowUpRight size={14}/></div><div className="metric-number">8<span>/ 12</span><div className="micro-bars">{Array.from({length:12},(_,i)=><i key={i} className={i<8?"filled":""}/>)}</div></div><small>项检查通过<span>查看 4 项建议</span></small></Link><Link href="/issues" className="metric"><div className="metric-label"><CircleDot size={16}/>待分诊 Issue<ArrowUpRight size={14}/></div><div className="metric-number">{counts.issues}<span className="metric-unit">条</span></div><small>把反馈变成可处理的任务</small></Link><Link href="/pull-requests" className="metric"><div className="metric-label"><GitPullRequest size={16}/>待审阅 PR<ArrowUpRight size={14}/></div><div className="metric-number">{counts.prs}<span className="metric-unit">项</span></div><small>核对变更，确认每一次合入</small></Link><Link href="/improvements" className="metric"><div className="metric-label"><FileText size={16}/>规范改进<ArrowUpRight size={14}/></div><div className="metric-number">{counts.docs}<span className="metric-unit">份待确认</span></div><small>为下一位贡献者铺好路</small></Link></section>

    <div className="overview-lower"><section className="task-section"><div className="section-heading"><div><span className="section-index">01</span><h2>接下来，做这些</h2><span className="count-pill">{pendingTasks.length}</span></div><span className="section-note">每一步都由你确认</span></div><div className="task-tabs" aria-label="筛选待办">{([{id:"all",label:"全部",count:4},{id:"issue",label:"Issues",count:2},{id:"pr",label:"Pull requests",count:1},{id:"docs",label:"文档",count:1}] as const).map(tab=><button type="button" aria-pressed={filter===tab.id} key={tab.id} className={filter===tab.id?"selected":""} onClick={()=>setFilter(tab.id)}>{tab.label}<span>{tab.id === "all" ? pendingTasks.length : pendingTasks.filter(task => task.type === tab.id).length}</span></button>)}</div><div className="task-list">{!filtered.length && <div className="empty-state"><CheckCheck size={24}/><p>这一组待办已处理完毕。</p></div>}{filtered.map(task=><Link className="task-row" key={task.id} href={task.href}><span className={`task-icon ${task.tag}`}><task.icon size={18} strokeWidth={1.6}/></span><div className="task-content"><div className="task-title"><span>{task.title}</span><small>{task.date}</small></div><p>{task.description}</p><div className="task-mobile-meta"><span className={`status-tag ${task.tag}`}>{task.label}</span></div></div><div className="task-end"><span className={`status-tag ${task.tag}`}>{task.label}</span><span className="task-meta">{task.meta}</span></div><ChevronRight size={16} className="task-chevron"/></Link>)}</div><div className="task-list-footer"><span><CheckCheck size={14}/>先审阅，再行动</span><Link href={filter === "pr" ? "/pull-requests" : filter === "docs" ? "/improvements" : "/issues"}>打开工作列表<ArrowRight size={14}/></Link></div></section>

    <aside className="project-aside"><div className="section-heading"><div><span className="section-index">02</span><h2>项目一瞥</h2></div><GitBranch size={16}/></div><div className="project-brief"><div className="repo-heading"><span className="repo-monogram">ck<span>↗</span></span><div><h3>csv-kit</h3><span>repocare-demo</span></div><span className="public-label">演示</span></div><p>一个轻量的 Python CSV 工具包，<br className="desktop-break"/>也是这次维护旅程的起点。</p><div className="repo-meta"><span><i/>Python</span><span><GitBranch size={13}/>main</span><span>MIT</span></div></div><div className="project-checks"><div><span>基础说明</span><span className="check-label"><Check size={13}/>已就绪</span></div><div><span>贡献指南</span><Link href="/improvements">待完善<ArrowUpRight size={12}/></Link></div><div><span>反馈模板</span><Link href="/improvements">待补充<ArrowUpRight size={12}/></Link></div></div><div className="project-aside-footer"><Globe2 size={14}/><span>虚构示例 · 未连接远程仓库</span></div></aside></div>

    {!dismissed && <section className="insight-strip"><div className="insight-icon"><Sparkles size={20} strokeWidth={1.5}/></div><div><h3>小小的规范，让下一次协作更轻松。</h3><p>完善 Bug 反馈模板，帮助提交者一次说清环境、步骤和预期。</p></div><Link href="/improvements">查看改进草稿<ArrowRight size={16}/></Link><button className="icon-button" type="button" aria-label="暂时隐藏建议" onClick={()=>{setDismissed(true);onNotify("建议已隐藏，仍可在规范改进中查看。");}}><Check size={16}/></button></section>}
  </>;
}
