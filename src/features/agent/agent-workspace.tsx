'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Bot, Check, ChevronRight, Circle, FileCode2, GitBranch, LoaderCircle, Plus, Send, ShieldCheck, Square, BookOpen, Download, ExternalLink } from 'lucide-react';
import type { AgentArtifact, AgentWorkspaceData, MaintenanceKind, MaintenanceStatus, MaintenanceTask } from '@/contracts/agent';
import type { ReproductionJob, ReproductionStep } from '@/contracts/workbench';
import { api, changed, useWorkbench } from '../workbench/client';
import './agent.css';

const statuses:Record<MaintenanceStatus,string>={queued:'排队中',running:'调查中','waiting-input':'需要补充','awaiting-confirmation':'交付待审阅',completed:'本阶段完成',paused:'已暂停',failed:'未完成',cancelled:'已取消'};
const kinds:Record<MaintenanceKind,string>={repository:'仓库调查',issue:'Issue 调查',pr:'PR 调查',docs:'文档改进'};
const examples=[{kind:'repository' as const,title:'摸清贡献路径',goal:'调查这个项目的安装、开发和贡献路径，找出有源码或文档依据的阻塞点，给出可执行的改进建议。'},{kind:'docs' as const,title:'核对文档与代码',goal:'对照 README、贡献文档和项目实际脚本，找出会误导新贡献者的说明，准备有源码依据的文档补丁。'}];
export function AgentWorkspace(){
  const {data,error}=useWorkbench();
  if(!data)return <div className="ma-empty" role="status">{error||'正在连接维护工作区…'}</div>;
  if(!data.project)return <div className="ma-empty"><Bot size={30}/><h1>给 Agent 一个项目上下文</h1><p>连接仓库后，就能让它围绕真实源码开展维护任务。</p><Link href="/projects" className="button button-primary">连接项目</Link></div>;
  return <MaintenanceDesk key={`${data.project.repoUrl}:${data.project.branch||''}`} project={data.project}/>;
}
function MaintenanceDesk({project}:{project:{repoUrl:string;branch?:string;fullName:string}}){
  const [data,setData]=useState<AgentWorkspaceData|null>(null),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
  const [error,setError]=useState(''),[fetchError,setFetchError]=useState(''),[busy,setBusy]=useState(false),[goal,setGoal]=useState(''),[kind,setKind]=useState<MaintenanceKind>('repository'),[number,setNumber]=useState(''),[message,setMessage]=useState('');
  const [tab,setTab]=useState<'results'|'activity'|'knowledge'>('results');
  useEffect(()=>{const query=new URLSearchParams(window.location.search),k=query.get('kind');if(k&&Object.hasOwn(kinds,k))setKind(k as MaintenanceKind);const n=query.get('number');if(n&&/^\d+$/.test(n)){setNumber(n);if(k==='issue')setGoal(`调查 Issue #${n}，结合真实源码判断问题，必要时准备复现计划与可审阅补丁，并生成有依据的回复草稿。`);if(k==='pr')setGoal(`调查 PR #${n} 的变更，结合源码和实际提交检查指出需要关注的问题，区分已有依据与待验证的判断。`);}const id=query.get('task');if(id)setSelected(id);},[]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{try{const response=await fetch(`/api/workbench/agent${selected?`?id=${encodeURIComponent(selected)}`:''}`,{cache:'no-store',signal:controller.signal});const value=await response.json();if(!response.ok)throw new Error(value.error||'无法读取任务。');if(!controller.signal.aborted){setData(value);setFetchError('');}}catch(cause){if(!controller.signal.aborted)setFetchError(cause instanceof Error?cause.message:'读取失败。');}finally{if(!controller.signal.aborted)timer=setTimeout(refresh,3000);}};
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[selected,revision]);
  const task=data?.task?.id===selected?data.task:undefined;
  const active=task&&['queued','running'].includes(task.status);
  async function action(body:unknown){setBusy(true);setError('');try{const result=await api<{task?:MaintenanceTask}>('/api/workbench/agent',body);if(result.task?.id){setSelected(result.task.id);const url=new URL(window.location.href);url.searchParams.set('task',result.task.id);window.history.replaceState(null,'',url);}setRevision(v=>v+1);changed();return true;}catch(cause){setError(cause instanceof Error?cause.message:'操作未完成。');return false;}finally{setBusy(false);}}
  const choose=(id:string)=>{setSelected(id);setError('');setMessage('');setTab('results');const url=new URL(window.location.href);if(id)url.searchParams.set('task',id);else url.searchParams.delete('task');window.history.replaceState(null,'',url);};
  return <section className="ma-workspace">
    <header className="ma-heading"><div><span className="ma-kicker"><Bot size={16}/> REPOSITORY AGENT</span><h1>项目维护 Agent</h1></div><div className="ma-connection"><i className={data?.workerOnline?'is-online':''}/>{data?.workerOnline?'Agent 已就绪':'Agent Worker 未连接'}<span>·</span><GitBranch size={14}/>{project.branch||'默认分支'}</div></header>
    {(error||fetchError)&&<div className="ma-alert" role="alert">{error||fetchError}<button type="button" onClick={()=>setRevision(v=>v+1)}>重新读取</button></div>}
    <div className="ma-desk">
      <aside className="ma-sidebar" aria-label="维护任务"><div className="ma-sidebar-title"><span>任务记录 <small>{data?.tasks.length||0}</small></span><button type="button" aria-label="新建任务" title="新建任务" disabled={busy} onClick={()=>choose('')}><Plus size={17}/></button></div>
        <button type="button" disabled={busy} className={`ma-new ${!selected?'is-selected':''}`} onClick={()=>choose('')}><Plus size={16}/>发起维护任务</button>
        <div className="ma-task-list">{data?.tasks.map(item=><button type="button" key={item.id} disabled={busy} className={`ma-task-link ${selected===item.id?'is-selected':''}`} onClick={()=>choose(item.id)} aria-current={selected===item.id?'true':undefined}><span><i className={`ma-status-dot status-${item.status}`}/>{statuses[item.status]}<small>{kinds[item.kind]}{item.number?` #${item.number}`:''}</small></span><strong>{item.goal}</strong><time>{new Date(item.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</time></button>)}{data&&!data.tasks.length&&<p className="ma-sidebar-note">你的任务、调查依据和交付物会保存在这里。</p>}</div>
        <div className="ma-sidebar-foot"><ShieldCheck size={17}/><span>固定提交 · 依据可追溯<br/>执行与发布由你确认</span></div>
      </aside>
      <div className="ma-main">
        {!selected?<div className="ma-compose"><div className="ma-intro"><span className="ma-intro-icon"><Bot size={26}/></span><span className="ma-kicker">从一个维护目标开始</span><h2>让调查走到可交付。</h2><p>读源码、查反馈、提出补丁。每一步都有进度，每个结论都能回到依据。</p></div>
          <form onSubmit={async e=>{e.preventDefault();await action({action:'create',repoUrl:project.repoUrl,branch:project.branch,kind,...(['issue','pr'].includes(kind)?{number:Number(number)}:{}),goal});}}>
            <div className="ma-form-row"><label>任务类型<select value={kind} onChange={e=>setKind(e.target.value as MaintenanceKind)}>{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{['issue','pr'].includes(kind)&&<label>编号<input type="number" min="1" required value={number} onChange={e=>setNumber(e.target.value)} placeholder="例如 224"/></label>}</div>
            <label className="ma-goal-label" htmlFor="agent-goal">这次想解决什么？</label><textarea id="agent-goal" required minLength={8} maxLength={4000} value={goal} onChange={e=>setGoal(e.target.value)} placeholder={kind==='issue'?'调查这条 Issue，结合源码判断原因。必要时准备复现计划，提出可审阅的修复补丁。':'描述一个具体目标，或从下面的任务开始…'}/>
            <div className="ma-compose-footer"><span>使用当前默认模型；启动后会产生模型调用。</span><button className="button button-primary" disabled={busy||!data?.workerOnline||goal.trim().length<8} type="submit">{busy?<LoaderCircle size={15} className="ma-spin"/>:<ArrowRight size={16}/>}开始任务</button></div>
          </form>
          <div className="ma-example-grid">{examples.map(example=><button type="button" key={example.title} onClick={()=>{setKind(example.kind);setGoal(example.goal);}}><span>{example.kind==='docs'?<FileCode2 size={18}/>:<GitBranch size={18}/>}</span><strong>{example.title}</strong><p>{example.goal}</p><ChevronRight size={16}/></button>)}</div>
          <div className="ma-capabilities"><span><Check size={14}/>按需读取真实源码</span><span><Check size={14}/>调查可中断后继续</span><span><Check size={14}/>补丁与验证分开审阅</span></div>
        </div>:!task?<div className="ma-empty" role="status">{error||fetchError||'正在打开任务…'}</div>:<>
          <div className="ma-task-header"><div className="ma-task-meta"><span className={`ma-state status-${task.status}`}>{task.status==='running'&&<LoaderCircle size={13} className="ma-spin"/>}{statuses[task.status]}</span><span>{kinds[task.kind]}{task.number?` #${task.number}`:''}</span><code title={task.commitSha}>{task.commitSha?.slice(0,10)||'等待固定提交'}</code></div><h2>{task.goal}</h2><div className="ma-task-sub"><span title={task.model.modelId}>{task.model.name} · {task.model.modelId}</span><span>{task.branch||project.branch||'默认分支'}</span>{active?<button type="button" disabled={busy} onClick={()=>action({action:'cancel',id:task.id})}><Square size={12}/>停止调查</button>:<button type="button" disabled={busy} onClick={()=>action({action:'resume',id:task.id})}>继续调查<ArrowRight size={13}/></button>}</div></div>
          {task.notice&&<p className="ma-notice" role="status">{task.notice}</p>}
          {task.plan.length>0&&<ol className="ma-plan" aria-label="任务步骤">{task.plan.map((step,index)=><li key={index} className={`is-${step.status}`}><span>{step.status==='done'?<Check size={13}/>:step.status==='active'?<LoaderCircle size={13} className="ma-spin"/>:index+1}</span>{step.title}</li>)}</ol>}
          <div className="ma-tabs" role="tablist" aria-label="任务内容">{([['results','调查与交付'],['activity','执行记录'],['knowledge','项目知识']] as const).map(([key,label])=><button role="tab" aria-selected={tab===key} aria-controls={`ma-panel-${key}`} id={`ma-tab-${key}`} type="button" key={key} onClick={()=>setTab(key)}>{label}{key==='results'&&task.artifacts.length>0&&<small>{task.artifacts.length}</small>}</button>)}<span>{task.evidence.length} 项依据</span></div>
          <div className="ma-task-body" role="tabpanel" id={`ma-panel-${tab}`} aria-labelledby={`ma-tab-${tab}`}>
            {tab==='results'&&<>
              {!task.report&&<div className="ma-investigating"><span>{active?<LoaderCircle size={22} className="ma-spin"/>:<Bot size={22}/>}</span><div><h3>{active?'正在建立调查依据':'等待继续调查'}</h3><p>{task.events.at(-1)?.message||'先读取项目与任务上下文，再按需查看相关源码。'}</p></div></div>}
              {task.report&&<div className="ma-report"><span className="ma-section-label">{active?'上次阶段结论':'阶段结论'}</span><p className="ma-summary">{task.report.summary}</p>{task.report.findings.map((finding,index)=><article className="ma-finding" key={index}><div><span className={finding.certainty==='supported'?'ma-supported':'ma-hypothesis'}>{finding.certainty==='supported'?'有依据':'待验证'}</span><h3>{finding.title}</h3></div><p>{finding.detail}</p><EvidenceLinks task={task} ids={finding.evidenceIds}/></article>)}{task.report.missingInformation.length>0&&<div className="ma-questions"><h3>需要你补充</h3><ul>{task.report.missingInformation.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}{task.report.nextSteps.length>0&&<div className="ma-next"><h3>下一步</h3><ul>{task.report.nextSteps.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}</div>}
              {task.artifacts.length>0&&<section className="ma-deliverables"><h3>待审阅的交付物 <small>{task.artifacts.length}</small></h3>{task.artifacts.slice().reverse().map(artifact=><Artifact key={artifact.id} artifact={artifact} task={task} data={data!} busy={busy} action={action}/>)}</section>}
              {task.evidence.length>0&&<section className="ma-evidence"><h3>调查依据 <small>{task.evidence.length}</small></h3><p>以下是实际读取的内容；引用核验不代表结论已被运行验证。</p>{task.evidence.map(e=><details id={`evidence-${e.id}`} key={e.id}><summary><code>{e.id}</code><strong>{e.label}</strong><span>{e.kind==='execution'?'隔离执行':e.kind==='checks'?'GitHub检查':e.kind==='file'?'源码':'协作反馈'}</span></summary><div className="ma-evidence-meta">提交 {e.commitSha.slice(0,10)} · {new Date(e.capturedAt).toLocaleString('zh-CN')}{e.url&&<a href={e.url} target="_blank" rel="noreferrer">查看来源<ExternalLink size={12}/></a>}</div><pre tabIndex={0}>{e.excerpt}</pre></details>)}</section>}
            </>}
            {tab==='activity'&&<section className="ma-activity"><h3>可回溯的执行记录</h3><p>记录工具与进度，保留已完成的检查点。</p><ol>{task.events.map((event,index)=><li key={index} className={event.failed?'is-failed':''}><Circle size={9}/><time>{new Date(event.at).toLocaleTimeString('zh-CN',{hour12:false})}</time><span>{event.message}<small>{event.tool}</small></span></li>)}</ol><h3>对话记录</h3>{task.dialogue.map(item=><div className={`ma-dialogue role-${item.role}`} key={item.id}><small>{item.role==='user'?'你':'Agent'}</small><p>{item.content}</p></div>)}</section>}
            {tab==='knowledge'&&<Knowledge task={task} data={data!} busy={busy} action={action}/>}
          </div>
          <div className="ma-budget" title="token来自服务商实际用量；上下文压缩使用应用字节预算，不是精确token计数。"><span>模型轮次 <b>{task.budget.turns}/{task.budget.maxTurns}</b></span><span>工具 <b>{task.budget.tools}/{task.budget.maxTools}</b></span><span>输入/输出 <b>{task.budget.inputTokens.toLocaleString()} / {task.budget.outputTokens.toLocaleString()} tokens</b></span>{task.budget.compactions>0&&<span>上下文已整理 {task.budget.compactions} 次</span>}</div>
          <form className="ma-message" onSubmit={async e=>{e.preventDefault();if(await action({action:'message',id:task.id,content:message}))setMessage('');}}><textarea aria-label="补充任务信息" rows={2} maxLength={4000} required value={message} onChange={e=>setMessage(e.target.value)} placeholder={active?'补充信息，会在当前一轮完成后送达…':'补充线索，或让 Agent 读取执行结果后继续…'}/><button type="submit" className="button button-primary" disabled={busy||!message.trim()||!data?.workerOnline}><Send size={15}/>{active?'补充信息':'发送并继续'}</button></form>
        </>}
      </div>
    </div>
  </section>;
}
function EvidenceLinks({task,ids}:{task:MaintenanceTask;ids:string[]}){return <div className="ma-refs">{ids.map(id=><a key={id} href={`#evidence-${id}`} onClick={()=>{const element=document.getElementById(`evidence-${id}`);if(element instanceof HTMLDetailsElement)element.open=true;}}>{task.evidence.find(e=>e.id===id)?.label||id}<ChevronRight size={11}/></a>)}</div>;}
type ArtifactProps={artifact:AgentArtifact;task:MaintenanceTask;data:AgentWorkspaceData;busy:boolean;action:(body:unknown)=>Promise<boolean>};
function Artifact(props:ArtifactProps){return props.artifact.superseded?<details className="ma-history"><summary>历史方案 · {props.artifact.title} · 第 {props.artifact.revision||1} 版</summary><ArtifactBody {...props}/></details>:<ArtifactBody {...props}/>;}
function ArtifactBody({artifact,task,data,busy,action}:{artifact:AgentArtifact;task:MaintenanceTask;data:AgentWorkspaceData;busy:boolean;action:(body:unknown)=>Promise<boolean>}){
  const download=()=>{const url=URL.createObjectURL(new Blob([artifact.diff||''],{type:'text/x-diff;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`repocare-${task.id.slice(0,8)}.patch`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <article className="ma-artifact"><div className="ma-artifact-heading"><FileCode2 size={18}/><h4>{artifact.title} <small>第 {artifact.revision||1} 版{artifact.superseded?' · 历史方案':''}</small></h4>{artifact.draftId&&<Link href={`/improvements?draft=${artifact.draftId}`}>审阅草稿<ArrowRight size={13}/></Link>}{artifact.diff&&<button type="button" onClick={download}><Download size={13}/>下载补丁</button>}</div><EvidenceLinks task={task} ids={artifact.evidenceIds}/>{artifact.diff&&<details><summary>查看 {artifact.files?.length} 个文件的差异 <small>基于 {task.commitSha?.slice(0,10)}</small></summary><pre tabIndex={0} className="ma-diff">{artifact.diff.split('\n').map((line,i)=><span key={i} className={line.startsWith('+')?'is-add':line.startsWith('-')?'is-remove':''}>{line}{'\n'}</span>)}</pre><p>补丁尚未应用或提交。下载后可在对应提交的本地分支审阅。</p></details>}{artifact.kind==='verification'&&<Comparison jobs={(artifact.jobIds||[]).map(id=>data.jobs.find(j=>j.id===id)).filter((j):j is ReproductionJob=>!!j)}/>} {artifact.jobIds?.map((id,index)=>{const job=data.jobs.find(j=>j.id===id);return job?<ExecutionPlan key={id} task={task} job={job} historical={artifact.superseded} label={artifact.kind==='verification'?(index===0?'原始版本':'应用补丁后'):'复现计划'} data={data} busy={busy} action={action}/>:<p key={id}>执行记录暂不可用</p>;})}</article>;
}
function Comparison({jobs}:{jobs:ReproductionJob[]}){
  const baseline=jobs.find(j=>j.verificationRole==='baseline'),patched=jobs.find(j=>j.verificationRole==='patched');
  if(!baseline||!patched)return null;
  const label=(job:ReproductionJob)=>job.status==='reproduced'?'计划内命令通过':job.status==='not-reproduced'?'命令未全部通过':job.status==='awaiting-confirmation'?'等待你确认':['queued','running'].includes(job.status)?'等待执行结果':'执行未完成';
  const bothPassed=baseline.status==='reproduced'&&patched.status==='reproduced';
  const changed=baseline.status==='not-reproduced'&&patched.status==='reproduced';
  return <div className="ma-comparison"><div><span>原始版本</span><strong>{label(baseline)}</strong></div><ArrowRight size={17}/><div><span>应用补丁后</span><strong>{label(patched)}</strong></div><p>{bothPassed?'两组均通过：当前验证不能证明补丁解决了目标问题。':changed?'观察到计划内命令的通过差异，请结合日志核对补丁是否解决目标问题。':'同一提交、相同验证命令，分别记录两个版本的结果。'}</p></div>;
}
function PlanSteps({steps}:{steps:ReproductionStep[]}){
  return <ol className="ma-plan-steps">{steps.map((step,index)=><li key={index}><span>{index+1}</span><div><strong>{step.command||step.path||step.target||step.type}</strong>{step.background&&<small>后台服务</small>}{step.expected&&<p>{step.expected}</p>}{step.type==='create-file'&&<details><summary>查看要写入沙箱的文件内容</summary><pre tabIndex={0}>{step.content}</pre></details>}{step.value&&<p>输入 / 期望值：{step.value}</p>}{step.method&&<p>{step.method} {step.body}</p>}</div></li>)}</ol>;
}
function ExecutionPlan({task,job,label,data,busy,action,historical}:{task:MaintenanceTask;job:ReproductionJob;label:string;data:AgentWorkspaceData;busy:boolean;action:(body:unknown)=>Promise<boolean>;historical?:boolean}){
  const [confirmed,setConfirmed]=useState(false);
  const waiting=job.status==='awaiting-confirmation';
  const status=waiting?'待确认':job.status==='reproduced'?job.plan.oracle.type==='all-steps-pass'?'计划内命令通过':'命中复现判据':job.status==='not-reproduced'?'未命中判据':({queued:'排队中',running:'执行中',blocked:'环境阻塞',failed:'执行失败',unsafe:'计划被阻止',cancelled:'已取消',draft:'准备中'} as Record<string,string>)[job.status]||job.status;
  return <div className="ma-execution">
    <div><strong>{label}</strong><span>{status}</span></div><p>{job.progress||job.plan.summary}</p>
    <details><summary>审阅完整计划、环境与风险</summary><p>{job.plan.summary}</p><p>固定提交 <code>{job.commitSha}</code> · 分支 {job.branch} · 独立执行 {job.totalAttempts||3} 次</p>
      <dl className="ma-plan-environment"><dt>环境</dt><dd>{[job.plan.environment.language,job.plan.environment.version,job.plan.environment.os].filter(Boolean).join(' · ')||'未指定'}</dd><dt>依赖</dt><dd>{job.plan.environment.dependencies.join('、')||'未列出额外依赖'}</dd><dt>机器判据</dt><dd><code>{job.plan.oracle.type}: {job.plan.oracle.value}</code></dd><dt>期望</dt><dd>{job.plan.expected}</dd></dl>
      {job.plan.setup.length>0&&<><h5>准备步骤</h5><PlanSteps steps={job.plan.setup}/></>}<h5>验证步骤</h5><PlanSteps steps={job.plan.steps}/>
      {job.plan.risks.length>0&&<div className="ma-plan-risks"><h5>需要注意</h5><ul>{job.plan.risks.map((risk,i)=><li key={i}>{risk}</li>)}</ul></div>}
      {job.plan.missingInformation.length>0&&<><h5>缺失信息</h5><ul>{job.plan.missingInformation.map((item,i)=><li key={i}>{item}</li>)}</ul></>}
      <details><summary>查看计划原始数据</summary><pre tabIndex={0}>{JSON.stringify(job.plan,null,2)}</pre></details>
    </details>
    {job.attemptHistory?.length>0&&<details><summary>执行结果与尝试记录</summary><pre tabIndex={0}>{JSON.stringify({status:job.status,attempts:job.attemptHistory,steps:job.verificationSteps},null,2)}</pre></details>}
    {job.artifacts.length>0&&<div className="ma-artifact-downloads">{job.artifacts.map(artifact=><a key={artifact.id} href={`/api/workbench/reproduction/artifacts/${artifact.id}?job=${job.id}`} title={`SHA-256 ${artifact.sha256}`}><Download size={12}/>{artifact.kind}<small>{Math.max(1,Math.round(artifact.size/1024))}KB</small></a>)}</div>}
    {waiting&&<><label className="ma-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已审阅此计划，同意在隔离环境执行仓库代码</label><button type="button" className="button button-secondary" disabled={busy||historical||!confirmed||!data.sandboxConfigured||!data.reproductionWorkerOnline||!!job.plan.missingInformation.length||task.status==='cancelled'} onClick={()=>action({action:'confirm',id:task.id,jobId:job.id,confirmed:true})}>确认执行此计划<ArrowRight size={14}/></button>{(!data.sandboxConfigured||!data.reproductionWorkerOnline)&&<small className="ma-execution-note">需要启用 Docker 沙箱并启动复现 Worker。</small>}{job.plan.missingInformation.length>0&&<p className="ma-notice">计划仍有缺失信息，请补充后让 Agent 修订方案。</p>}</>}
    {!waiting&&!['queued','running'].includes(job.status)&&<button type="button" className="button button-secondary" disabled={busy||!data.workerOnline} onClick={()=>action({action:'message',id:task.id,content:`请用 read_execution 读取执行记录 ${job.id}，根据实际结果继续调查。不要把命令通过等同于全部问题已修复。`})}>读取结果并继续<ArrowRight size={14}/></button>}
  </div>;
}
function Knowledge({task,data,busy,action}:{task:MaintenanceTask;data:AgentWorkspaceData;busy:boolean;action:(body:unknown)=>Promise<boolean>}){
  const [content,setContent]=useState(''),[ids,setIds]=useState<string[]>([]);
  return <section className="ma-knowledge"><BookOpen size={23}/><h3>由你确认的项目知识</h3><p>保存稳定的项目约定与源码依据，后续任务可以读取。提交变化后会标记为历史知识，需要重新核对。</p><form onSubmit={async e=>{e.preventDefault();if(await action({action:'remember',id:task.id,content,evidenceIds:ids})){setContent('');setIds([]);}}}><label htmlFor="agent-memory">知识内容</label><textarea id="agent-memory" required maxLength={2000} value={content} onChange={e=>setContent(e.target.value)} placeholder="例如：贡献者应使用哪个测试入口，以及它适用的目录。"/><label htmlFor="agent-memory-evidence">关联依据（可多选）</label><select id="agent-memory-evidence" multiple value={ids} onChange={e=>setIds([...e.target.selectedOptions].map(o=>o.value))}>{task.evidence.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select><button type="submit" className="button button-primary" disabled={busy||!content.trim()||!ids.length}>确认并保存知识</button></form>{data.memories.map(memory=><article key={memory.id}><small>{memory.commitSha===task.commitSha?'同一提交':'历史知识 · 请重新核对'} · {memory.commitSha.slice(0,10)}</small><p>{memory.content}</p><button type="button" disabled={busy} onClick={()=>action({action:'archive-memory',memoryId:memory.id})}>归档此条</button></article>)}</section>;
}
