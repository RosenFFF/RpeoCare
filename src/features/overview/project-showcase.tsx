"use client";

import Link from "next/link";
import { useState } from "react";
import { RepoExhibit, maintenanceSections as sections } from "./repo-exhibit";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "../../shared/components/brand-mark";
import "./project-showcase.css";

export interface ShowcaseProject {
  fullName: string;
  branch: string;
  sha: string;
  runId: string;
  draftCount: number;
  issues: number | null;
  pulls: number | null;
  countsLoading: boolean;
  checks: { pass: number; needsAttention: number; unknown: number; docsNeedsAttention: number };
}

export function ProjectShowcase({ project }: { project: ShowcaseProject }) {
  const [selected,setSelected]=useState(3);
  const active=sections[selected];
  const totals=[project.issues, project.pulls, project.draftCount, project.checks.needsAttention];
  return <section className="care-showcase" aria-label="项目维护地图">
    <div className="care-intro"><div className="care-signature"><BrandMark size={22}/><span>RepoCare</span><span className="care-demo">体检报告</span></div><h2>看清现状，<br/>再决定下一步。</h2><p>{project.fullName} 的维护地图。<br/>体检结论对应本次固定提交。</p>
      <div className="care-detail" aria-live="polite"><span className="care-detail-label"><active.icon size={15}/>{active.name}</span><div className="care-detail-number">{totals[selected] ?? '—'}<span>{totals[selected] === null ? project.countsLoading ? '正在读取' : '暂不可用' : selected < 2 ? selected === 0 ? '条开放 Issue' : '项开放 PR' : active.unit}</span></div><p>{active.description}</p><Link href={selected === 3 ? `/audit?run=${project.runId}` : active.href}>打开{active.name}<ArrowUpRight size={16}/></Link></div>
      <p className="care-trust">提交 <code>{project.sha.slice(0, 7)}</code> · {project.branch}</p>
    </div>
    <RepoExhibit selected={selected} onSelect={setSelected} totals={totals} projectName={project.fullName} branch={project.branch} />
  </section>;
}
