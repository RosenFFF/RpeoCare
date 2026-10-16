'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { PolicyAssessment, PolicyDocument } from '@/contracts/policy';
import { api } from './client';
import './policy-evidence.css';
const labels = { met: '找到依据', missing: '待补充', attention: '需核对', unknown: '未知', reference: '项目约定' };
export function PolicyEvidence({ assessment, repoUrl }: { assessment?: PolicyAssessment; repoUrl: string }) {
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => { let live = true; void api<{ repoUrl: string; document: PolicyDocument }>('/api/workbench/policy').then(r => { if (live && r.repoUrl === repoUrl) setActive(r.document.active?.revision ?? 0); }).catch(() => {}); return () => { live = false; }; }, [repoUrl, assessment?.revision]);
  return <section className="policy-evidence" aria-label="项目规则与依据">
    <header><h3><ShieldCheck size={17} />项目规则与依据</h3><Link href="/settings?section=policy">管理项目规则</Link></header>
    {!assessment ? <p>{active ? '本结果尚未应用当前项目规则，请重新分析。' : active === 0 ? '尚未启用项目专属规则，可在工作区设置中读取候选并确认。' : '本结果没有项目规则记录；规则状态暂未读取。'}</p> : <>
      <p className="policy-evidence-meta">采用已确认规则 v{assessment.revision} · {new Date(assessment.confirmedAt).toLocaleDateString('zh-CN')}{active !== null && active !== assessment.revision && <strong role="status"> 当前规则已变化，请重新分析。</strong>}</p>
      {assessment.checks.length ? <div className="policy-evidence-list">{assessment.checks.map(check => <article className={`policy-check is-${check.status}`} key={check.ruleId}><div><span>{labels[check.status]}</span><strong>{check.title}</strong></div><p>{check.detail}</p>{check.evidence && <blockquote>{check.evidence}</blockquote>}<small>{check.source.kind === 'repository' && check.source.path && check.source.commitSha ? <a href={`${repoUrl}/blob/${check.source.commitSha}/${check.source.path.split('/').map(encodeURIComponent).join('/')}#L${check.source.line || 1}`} target="_blank" rel="noopener noreferrer">来源：{check.source.path}:{check.source.line} · {check.source.commitSha.slice(0, 8)}</a> : '来源：维护者手动约定'}</small></article>)}</div> : <p>当前规则版本没有适用于本项的规则。</p>}
      <small>规则来自维护者确认；原文引用保留固定版本，仓库约定变化后需重新核对。</small>
    </>}
  </section>;
}
