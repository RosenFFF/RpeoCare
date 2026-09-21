"use client";

import Link from "next/link";
import { useState } from "react";
import { RepoExhibit, maintenanceSections as sections } from "./repo-exhibit";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "../../shared/components/brand-mark";
import { useDemoCounts } from "@/shared/lib/use-demo-counts";
import "./project-showcase.css";

export function ProjectShowcase() {
  const counts=useDemoCounts();
  const [selected,setSelected]=useState(0);
  const active=sections[selected];
  const totals=[counts.issues,counts.prs,counts.docs,4];
  return <section className="care-showcase" aria-label="项目维护地图">
    <div className="care-intro"><div className="care-signature"><BrandMark size={22}/><span>RepoCare</span><span className="care-demo">交互演示</span></div><h2>照料日常，<br/>让创造继续。</h2><p>反馈、变更、文档，围绕项目各就其位。<br/>从一个节点，找到清晰的下一步。</p>
      <div className="care-detail" aria-live="polite"><span className="care-detail-label"><active.icon size={15}/>{active.name}</span><div className="care-detail-number">{totals[selected]}<span>{active.unit}</span></div><p>{active.description}</p><Link href={active.href}>打开{active.name}<ArrowUpRight size={16}/></Link></div>
      <p className="care-trust">建议由我们整理，决定始终由你作出。</p>
    </div>
    <RepoExhibit selected={selected} onSelect={setSelected} totals={totals} />
  </section>;
}
