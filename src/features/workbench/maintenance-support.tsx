'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ExternalLink,LoaderCircle,Search,Square} from 'lucide-react';
import type {AgentWorkspaceData,MaintenanceTask,MaintenanceKind} from '@/contracts/agent';
import type {ReproductionJob} from '@/contracts/workbench';
import type {InvestigationTrace} from '@/contracts/investigation';
import {api,changed,useWorkbench} from './client';
import {EvidenceLinks,MaintenanceArtifact as Artifact} from './maintenance-artifacts';
import {MaintenanceTaskWorkspace} from './maintenance-task-workspace';
import './maintenance-support.css';

export function SourceEvidence({trace}:{trace?:InvestigationTrace}){
  if(!trace)return null;
  return <details className="source-evidence"><summary><Search size={14}/><span>源码核对依据</span><small>{trace.evidence.length} 处引用{trace.commitSha?` · ${trace.commitSha.slice(0,8)}`:' · 源码未补全'}</small></summary><div>{trace.limitations.map((note,index)=><p className="source-limitation" key={index}>{note}</p>)}{trace.evidence.map(e=><details key={e.id}><summary>{e.label}<span>{e.kind==='file'?'源码':e.kind==='checks'?'提交检查':e.kind==='policy'?'项目规则':'讨论上下文'}</span></summary><p>{new Date(e.capturedAt).toLocaleString('zh-CN')}{e.url&&<a href={e.url} target="_blank" rel="noreferrer">查看来源<ExternalLink size={11}/></a>}</p><pre tabIndex={0}>{e.excerpt}</pre></details>)}<p className="source-scope">本次补充了实际读取的上下文，未运行代码；结论仍需人工核对。</p></div></details>;
}
interface SupportProps {kind:MaintenanceKind;number?:number;anchor?:string;sourceUpdatedAt?:string;sourceCommitSha?:string;title:string;goal:string;actionLabel:string;disabled?:boolean;repoUrl?:string;branch?:string}
export function MaintenanceSupport(props:SupportProps){
  const {data}=useWorkbench();
  if(!data?.project||props.repoUrl&&props.repoUrl!==data.project.repoUrl||props.branch&&data.project.branch&&props.branch!==data.project.branch)return null;
  return <ContextSupport key={`${data.project.repoUrl}:${data.project.branch||''}:${props.kind}:${props.number||props.anchor||''}`} {...props} project={data.project}/>;
}
function ContextSupport({project,...props}:SupportProps&{project:{repoUrl:string;branch?:string}}){
  const [data,setData]=useState<AgentWorkspaceData|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[message,setMessage]=useState('');
  const actionLock=useRef(false);
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{let delay=8000;try{const query=new URLSearchParams({repoUrl:project.repoUrl,branch:project.branch||'',kind:props.kind,...(props.number?{number:String(props.number)}:{}),...(props.anchor?{anchor:props.anchor}:{})});const response=await fetch(`/api/workbench/agent?${query}`,{cache:'no-store',signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'处理依据暂时无法读取。');if(!controller.signal.aborted){setData(body);setLoadError('');if(body.task&&['queued','running'].includes(body.task.status)||body.jobs?.some((j:ReproductionJob)=>['queued','running'].includes(j.status)))delay=2500;}}catch(cause){if(!controller.signal.aborted)setLoadError(cause instanceof Error?cause.message:'读取失败。');}finally{if(!controller.signal.aborted)timer=setTimeout(refresh,delay);}};void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[props.kind,props.number,props.anchor,project.repoUrl,project.branch,revision]);
  const task=data?.task;
  const unavailable=busy||!!props.disabled;
  const active=!!task&&['queued','running'].includes(task.status);
  const stale=!!task&&!!((props.sourceUpdatedAt&&task.sourceUpdatedAt&&props.sourceUpdatedAt!==task.sourceUpdatedAt)||(props.sourceCommitSha&&task.commitSha&&props.sourceCommitSha!==task.commitSha));
  async function action(body:unknown){if(actionLock.current)return false;actionLock.current=true;setBusy(true);setError('');try{await api('/api/workbench/agent',body);setRevision(v=>v+1);changed();return true;}catch(cause){setError(cause instanceof Error?cause.message:'操作未完成。');return false;}finally{actionLock.current=false;setBusy(false);}}
  const start=()=>action({action:'create',repoUrl:project.repoUrl,branch:project.branch,kind:props.kind,number:props.number,anchor:props.anchor,sourceCommitSha:props.sourceCommitSha,goal:props.goal});
  if(props.kind==='issue'||props.kind==='pr')return <MaintenanceTaskWorkspace title={props.title} actionLabel={props.actionLabel} data={data} error={error||loadError} busy={unavailable} stale={stale} onStart={start} onAction={action} onRefresh={()=>setRevision(value=>value+1)}/>;
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
      {!active&&!stale&&['issue','pr'].includes(props.kind)&&<button type="button" className="button button-secondary" disabled={unavailable||!data?.workerOnline} onClick={()=>action({action:'message',id:task.id,content:'请读取当前问题原文、项目规则和实际测试配置，使用 prepare_verification 准备逐条需求、生产改动和共享回归测试的对照方案。每条要求引用精确原文，给出对应pytest命令和原版预期断言信号。缺少依据时列出需要补充的信息，不能编造或执行计划。'})}>准备需求对照<ArrowRight size={14}/></button>}
      {task.artifacts.slice().reverse().map(artifact=><Artifact key={artifact.id} artifact={artifact} task={task} data={data!} busy={unavailable||stale} stale={stale} action={action}/>)}
      {task.evidence.length>0&&<details className="maintenance-support-evidence"><summary>查看调查依据 · {task.evidence.length} 处</summary>{task.evidence.map(e=><details key={e.id} id={`maintenance-${task.id}-${e.id}`}><summary>{e.label}</summary>{e.url&&<a href={e.url} target="_blank" rel="noreferrer">查看来源</a>}<pre tabIndex={0}>{e.excerpt}</pre></details>)}</details>}
      {!stale&&<details className="maintenance-supplement" open={task.status==='waiting-input'}><summary>补充线索或调整处理方向</summary><form onSubmit={async e=>{e.preventDefault();if(await action({action:'message',id:task.id,content:message}))setMessage('');}}><textarea aria-label="补充当前问题的线索" required maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="例如：实际运行环境、补充步骤，或需要进一步核对的实现…"/><button className="button button-secondary" type="submit" disabled={unavailable||!message.trim()||!data?.workerOnline}>补充并继续</button></form></details>}
    </>}
  </section>;
}
