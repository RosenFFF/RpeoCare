'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight,ChevronRight,Download,ExternalLink,FileCode2,LoaderCircle,Search,Square} from 'lucide-react';
import type {AgentArtifact,AgentWorkspaceData,MaintenanceTask,MaintenanceKind} from '@/contracts/agent';
import type {ReproductionJob,ReproductionStep} from '@/contracts/workbench';
import type {InvestigationTrace} from '@/contracts/investigation';
import {api,changed,useWorkbench} from './client';
import './maintenance-support.css';

export function SourceEvidence({trace}:{trace?:InvestigationTrace}){
  if(!trace)return null;
  return <details className="source-evidence"><summary><Search size={14}/><span>源码核对依据</span><small>{trace.evidence.length} 处引用{trace.commitSha?` · ${trace.commitSha.slice(0,8)}`:' · 源码未补全'}</small></summary><div>{trace.limitations.map((note,index)=><p className="source-limitation" key={index}>{note}</p>)}{trace.evidence.map(e=><details key={e.id}><summary>{e.label}<span>{e.kind==='file'?'源码':e.kind==='checks'?'提交检查':'讨论上下文'}</span></summary><p>{new Date(e.capturedAt).toLocaleString('zh-CN')}{e.url&&<a href={e.url} target="_blank" rel="noreferrer">查看来源<ExternalLink size={11}/></a>}</p><pre tabIndex={0}>{e.excerpt}</pre></details>)}<p className="source-scope">本次补充了实际读取的上下文，未运行代码；结论仍需人工核对。</p></div></details>;
}
interface SupportProps {kind:MaintenanceKind;number?:number;anchor?:string;sourceUpdatedAt?:string;sourceCommitSha?:string;title:string;goal:string;actionLabel:string;disabled?:boolean;repoUrl?:string;branch?:string}
export function MaintenanceSupport(props:SupportProps){
  const {data}=useWorkbench();
  if(!data?.project||props.repoUrl&&props.repoUrl!==data.project.repoUrl||props.branch&&data.project.branch&&props.branch!==data.project.branch)return null;
  return <ContextSupport key={`${data.project.repoUrl}:${data.project.branch||''}:${props.kind}:${props.number||props.anchor||''}`} {...props} project={data.project}/>;
}
function ContextSupport({project,...props}:SupportProps&{project:{repoUrl:string;branch?:string}}){
  const [data,setData]=useState<AgentWorkspaceData|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[message,setMessage]=useState('');
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{let delay=8000;try{const query=new URLSearchParams({repoUrl:project.repoUrl,branch:project.branch||'',kind:props.kind,...(props.number?{number:String(props.number)}:{}),...(props.anchor?{anchor:props.anchor}:{})});const response=await fetch(`/api/workbench/agent?${query}`,{cache:'no-store',signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'处理依据暂时无法读取。');if(!controller.signal.aborted){setData(body);setLoadError('');if(body.task&&['queued','running'].includes(body.task.status)||body.jobs?.some((j:ReproductionJob)=>['queued','running'].includes(j.status)))delay=2500;}}catch(cause){if(!controller.signal.aborted)setLoadError(cause instanceof Error?cause.message:'读取失败。');}finally{if(!controller.signal.aborted)timer=setTimeout(refresh,delay);}};void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[props.kind,props.number,props.anchor,project.repoUrl,project.branch,revision]);
  const task=data?.task;
  const unavailable=busy||!!props.disabled;
  const active=!!task&&['queued','running'].includes(task.status);
  const stale=!!task&&!!((props.sourceUpdatedAt&&task.sourceUpdatedAt&&props.sourceUpdatedAt!==task.sourceUpdatedAt)||(props.sourceCommitSha&&task.commitSha&&props.sourceCommitSha!==task.commitSha));
  async function action(body:unknown){setBusy(true);setError('');try{await api('/api/workbench/agent',body);setRevision(v=>v+1);changed();return true;}catch(cause){setError(cause instanceof Error?cause.message:'操作未完成。');return false;}finally{setBusy(false);}}
  const start=()=>action({action:'create',repoUrl:project.repoUrl,branch:project.branch,kind:props.kind,number:props.number,anchor:props.anchor,sourceCommitSha:props.sourceCommitSha,goal:props.goal});
  return <section className="maintenance-support ma-workspace" aria-label={props.title}>
    <div className="maintenance-support-heading"><div><Search size={16}/><h3>{props.title}</h3>{active&&<span role="status"><LoaderCircle size={12} className="ma-spin"/>正在核对相关实现</span>}</div>{!task||stale&&!active?<button type="button" className="button button-secondary" disabled={unavailable||!data?.workerOnline} onClick={start}>{props.actionLabel}<ArrowRight size={13}/></button>:active?<button type="button" disabled={unavailable} onClick={()=>action({action:'cancel',id:task.id})}><Square size={11}/>停止核对</button>:<button type="button" className="button button-secondary" disabled={unavailable||!data?.workerOnline} onClick={()=>action({action:'resume',id:task.id})}>继续处理<ArrowRight size={13}/></button>}</div>
    {!task&&<p className="maintenance-support-intro">围绕当前内容查阅相关实现，准备有依据的后续方案。点击后会调用已配置的模型。</p>}
    {(error||loadError)&&<p className="ma-notice" role="alert">{error||loadError}</p>}
    {data&&!data.workerOnline&&<p className="maintenance-support-intro">后台处理服务暂未连接；当前页面仍可正常查看和编辑。</p>}
    {stale&&<p className="ma-notice">以下依据属于先前版本，请重新核对当前内容。</p>}
    {!!data?.memories.length&&<details className="maintenance-support-evidence"><summary>已确认的项目约定 · {data.memories.length}</summary>{data.memories.map(memory=><div className="maintenance-memory" key={memory.id}><p>{memory.content}</p><small>依据提交 {memory.commitSha.slice(0,8)} · 后续分析仍需核对当前源码</small><button type="button" disabled={unavailable} onClick={()=>action({action:'archive-memory',memoryId:memory.id})}>停用此约定</button></div>)}</details>}
    {task&&<>
      {task.notice&&<p className="maintenance-support-intro" role="status">{task.notice.replaceAll('Agent','源码核对')}</p>}
      {active&&<p className="maintenance-support-progress">{task.events.at(-1)?.message||'正在读取问题与相关源码…'}</p>}
      {task.report&&<div className="maintenance-support-report"><p>{task.report.summary}</p>{task.report.findings.map((finding,index)=><details key={index}><summary><span className={finding.certainty==='supported'?'ma-supported':'ma-hypothesis'}>{finding.certainty==='supported'?'有依据':'待验证'}</span>{finding.title}</summary><p>{finding.detail}</p><EvidenceLinks task={task} ids={finding.evidenceIds}/>{finding.certainty==='supported'&&finding.evidenceIds.length>0&&<button type="button" disabled={unavailable} onClick={()=>action({action:'remember',id:task.id,content:finding.detail,evidenceIds:finding.evidenceIds})}>确认并记为项目约定</button>}</details>)}{task.report.missingInformation.length>0&&<div className="ma-questions"><h4>还需要补充</h4><ul>{task.report.missingInformation.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}</div>}
      {task.report?.nextSteps.length ? <details className="maintenance-support-evidence"><summary>建议的下一步</summary><ol>{task.report.nextSteps.map((step,index)=><li key={index}>{step}</li>)}</ol></details> : null}
      {task.artifacts.slice().reverse().map(artifact=><Artifact key={artifact.id} artifact={artifact} task={task} data={data!} busy={unavailable||stale} action={action}/>)}
      {task.evidence.length>0&&<details className="maintenance-support-evidence"><summary>查看调查依据 · {task.evidence.length} 处</summary>{task.evidence.map(e=><details key={e.id} id={`maintenance-${task.id}-${e.id}`}><summary>{e.label}</summary>{e.url&&<a href={e.url} target="_blank" rel="noreferrer">查看来源</a>}<pre tabIndex={0}>{e.excerpt}</pre></details>)}</details>}
      {!stale&&<details className="maintenance-supplement" open={task.status==='waiting-input'}><summary>补充线索或调整处理方向</summary><form onSubmit={async e=>{e.preventDefault();if(await action({action:'message',id:task.id,content:message}))setMessage('');}}><textarea aria-label="补充当前问题的线索" required maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="例如：实际运行环境、补充步骤，或需要进一步核对的实现…"/><button className="button button-secondary" type="submit" disabled={unavailable||!message.trim()||!data?.workerOnline}>补充并继续</button></form></details>}
    </>}
  </section>;
}
function EvidenceLinks({task,ids}:{task:MaintenanceTask;ids:string[]}){return <div className="ma-refs">{ids.map(id=><a key={id} href={`#maintenance-${task.id}-${id}`} onClick={()=>{const element=document.getElementById(`maintenance-${task.id}-${id}`);if(element instanceof HTMLDetailsElement){element.open=true;let parent=element.parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}}}}>{task.evidence.find(e=>e.id===id)?.label||id}<ChevronRight size={11}/></a>)}</div>;}
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
    {waiting&&<><label className="ma-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已审阅此计划，同意在隔离环境执行仓库代码</label><button type="button" className="button button-secondary" disabled={busy||historical||!confirmed||!data.sandboxConfigured||!data.reproductionWorkerOnline||!!job.plan.missingInformation.length||task.status==='cancelled'} onClick={()=>action({action:'confirm',id:task.id,jobId:job.id,confirmed:true})}>确认执行此计划<ArrowRight size={14}/></button>{(!data.sandboxConfigured||!data.reproductionWorkerOnline)&&<small className="ma-execution-note">需要启用 Docker 沙箱并启动复现 Worker。</small>}{job.plan.missingInformation.length>0&&<p className="ma-notice">计划仍有缺失信息，请补充后重新核对方案。</p>}</>}
    {!waiting&&!['queued','running'].includes(job.status)&&<button type="button" className="button button-secondary" disabled={busy||!data.workerOnline} onClick={()=>action({action:'message',id:task.id,content:`请用 read_execution 读取执行记录 ${job.id}，根据实际结果继续调查。不要把命令通过等同于全部问题已修复。`})}>读取结果并继续<ArrowRight size={14}/></button>}
  </div>;
}
