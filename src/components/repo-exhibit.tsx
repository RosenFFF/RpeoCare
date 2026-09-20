"use client";

import { useEffect, useRef, useState } from "react";
import { CircleDot, Files, GitPullRequest, Move, Pause, Play, RotateCcw, ScanLine } from "lucide-react";
import { BrandMark } from "./brand-mark";
import "./project-showcase.css";

export const maintenanceSections = [
  {name:"Issue 分诊",short:"Issues",icon:CircleDot,description:"把模糊反馈整理清楚，先补齐信息，再作判断。",href:"/issues",unit:"条反馈待整理"},
  {name:"PR 检查",short:"Pull requests",icon:GitPullRequest,description:"把变更、检查依据和待确认事项放到一起审阅。",href:"/pull-requests",unit:"项变更待审阅"},
  {name:"规范改进",short:"Docs",icon:Files,description:"从贡献指南到反馈模板，让下一次协作更顺畅。",href:"/improvements",unit:"份草稿待确认"},
  {name:"项目体检",short:"Health",icon:ScanLine,description:"看清文档与协作规范的缺口，找到值得先做的改进。",href:"/audit",unit:"项基础待完善"},
] as const;
const sections = maintenanceSections;
type Scene = ReturnType<typeof import("./repo-scene").createRepoScene>;

export function RepoExhibit({ selected, onSelect, totals = [3, 2, 3, 4] }: { selected: number; onSelect: (index: number) => void; totals?: number[] }) {
  const [paused,setPaused]=useState(false);
  const [status,setStatus]=useState<"loading"|"ready"|"fallback">("loading");
  const host=useRef<HTMLDivElement>(null);
  const labels=useRef<(HTMLButtonElement|null)[]>([]);
  const scene=useRef<Scene|null>(null);
  const selectRef=useRef(onSelect);
  selectRef.current=onSelect;
  useEffect(()=>{
    let cancelled=false;
    const mq=matchMedia("(prefers-reduced-motion: reduce)");
    setPaused(mq.matches);
    const motionPreference=()=>setPaused(mq.matches);
    mq.addEventListener("change",motionPreference);
    const fail=()=>{scene.current?.dispose();scene.current=null;host.current?.querySelector("canvas")?.remove();labels.current.forEach(label=>label?.removeAttribute("style"));if(!cancelled)setStatus("fallback");};
    import("./repo-scene").then(({createRepoScene})=>{
      if(cancelled||!host.current)return;
      try{scene.current=createRepoScene(host.current,labels.current,index=>selectRef.current(index),fail);scene.current.pause(mq.matches);setStatus("ready");}
      catch{fail();}
    }).catch(fail);
    return()=>{mq.removeEventListener("change",motionPreference);cancelled=true;scene.current?.dispose();scene.current=null;};
  },[]);
  useEffect(()=>{scene.current?.select(selected);},[selected,status]);
  useEffect(()=>{scene.current?.pause(paused);},[paused,status]);
  return <div className="care-exhibit">
      <div className="care-exhibit-heading"><span>csv-kit <span>/ 维护地图</span></span><span className="care-mode">{status==="ready"?"3D 交互":status==="loading"?"正在准备场景":"简洁视图"}</span></div>
      <div ref={host} className={`care-stage ${status!=="ready"?"care-stage-fallback":""}`}>
        {status!=="ready"&&<div className="care-fallback-core" aria-hidden="true"><BrandMark size={58}/><span>csv-kit</span></div>}
        {sections.map((item,i)=><button type="button" ref={el=>{labels.current[i]=el;}} key={item.name} className={`care-node care-node-${i} ${selected===i?"is-selected":""}`} aria-pressed={selected===i} aria-label={`查看${item.name}`} onClick={()=>onSelect(i)}><item.icon size={14}/><span>{item.short}</span><b>{totals[i]}</b></button>)}
      </div>
      <div className="care-exhibit-bottom"><span><Move size={13}/>{status==="ready"?"拖动旋转 · 点击节点探索":"点击节点查看维护任务"}</span><div><button type="button" className="icon-button" disabled={status!=="ready"} title={paused?"继续场景动效":"暂停场景动效"} aria-label={paused?"继续场景动效":"暂停场景动效"} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><button type="button" className="icon-button" disabled={status!=="ready"} title="复位视角" aria-label="复位视角" onClick={()=>scene.current?.reset()}><RotateCcw size={15}/></button></div></div>
      <div className="care-legend" aria-label="选择维护模块">{sections.map((item,i)=><button type="button" key={item.name} aria-pressed={selected===i} onClick={()=>onSelect(i)}><span className={`care-dot care-dot-${i}`}/>{item.name}</button>)}</div>
    </div>;
}
