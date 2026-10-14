import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { GitItem } from '../../src/contracts/workbench';
import { db } from '../../src/server/audit/store';
import { parseDiff } from '../../src/shared/lib/pr-diff';
import { formatReviewDraft, parsePullRequestReview } from '../../src/server/workbench/review';
import { prepareReviewFiles, reviewFingerprint } from '../../src/shared/lib/pr-review-context';
import { getPullRequestChecks, getPullRequestReviewContext, publishDraft } from '../../src/server/github/api';
import { getDraft, getPullRequestReview, listPullReviewHistory, saveProject, savePullRequestReview, updatePullRequestFinding } from '../../src/server/workbench/store';
import { saveConnection } from '../../src/server/models/store';
import { accountSession, saveGithubAccount } from '../../src/server/github/connection';
import { POST, GET } from '../../src/app/api/workbench/review/route';
import { POST as drafts } from '../../src/app/api/workbench/drafts/route';

const directory = mkdtempSync(join(tmpdir(), 'repocare-pr-review-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const repoUrl = 'https://github.com/example/project', head = 'a'.repeat(40), base = 'b'.repeat(40);
const patch = '@@ -10,2 +10,2 @@\n-const value = data?.name;\n+const value = data.name;\n return value;';
const item: GitItem = { number: 45, title: 'Refactor reader', body: 'Fixes #42', state: 'open', author: 'dev', labels: [], url: `${repoUrl}/pull/45`, updatedAt: '2026-10-01T00:00:00Z', headSha: head, baseSha: base, totalChangedFiles: 1, files: [{ path: 'src/reader.ts', status: 'modified', additions: 1, deletions: 1, patch }] };
const output = { summary: '变更移除了空值保护，需确认输入约定。', findings: [{ severity: 'warning', category: 'correctness', title: '空输入可能抛异常', explanation: '如果 data 为空，属性读取会抛异常，请补充空输入测试。', confidence: 'medium', path: 'src/reader.ts', line: 10, side: 'RIGHT', evidence: 'const value = data.name;' }], limitations: ['仅可见 Diff'] };
function parsed() { return parsePullRequestReview(JSON.stringify(output), { item, files: item.files!, checks: [] }); }

test('diff coordinates honor hunk lengths, context and deletion side', () => {
  const rows = parseDiff(patch);
  assert.equal(rows[1].oldLine, 10); assert.equal(rows[1].newLine, undefined);
  assert.equal(rows[2].newLine, 10); assert.equal(rows[3].oldLine, 11);
  assert.equal(parseDiff('+++ fake')[0].newLine, undefined);
});
test('review verifies real file/line/quote rather than trusting model evidence', () => {
  const review = parsed(); assert.equal(review.findings[0].evidenceVerified, true);
  for (const change of [{ line: 99 }, { evidence: 'invented code' }, { path: 'src/fake.ts' }]) {
    const invalid = parsePullRequestReview(JSON.stringify({ ...output, findings: [{ ...output.findings[0], ...change }] }), { item, files: item.files!, checks: [] });
    assert.equal(invalid.findings[0].evidenceVerified, false);
    assert.equal(invalid.findings[0].severity, 'info'); assert.equal(invalid.findings[0].line, undefined);
    assert.ok(invalid.limitations.some(limit => limit.includes('未通过')));
  }
  const deleted = parsePullRequestReview(JSON.stringify({...output, findings:[{...output.findings[0], side:'LEFT', evidence:'const value = data?.name;'}]}), {item, files:item.files!,checks:[]});
  assert.equal(deleted.findings[0].evidenceVerified, true);
  assert.throws(() => parsePullRequestReview('broken', { item, files: [], checks: [] }), /JSON/);
});
test('model input budget and missing patches preserve explicit partial scope', () => {
  const files = prepareReviewFiles(Array.from({ length: 20 }, (_,i) => ({ path: `src/${i}.ts`, status: 'added', additions: 100, deletions: 0, patch: '@@ -0,0 +1,100 @@\n' + '+foo();\n'.repeat(1600) })));
  assert.ok(files.reduce((n: number,f: { patch?: string })=>n+(f.patch?.length || 0),0) <= 45000);
  assert.ok(files.some((f: { patchTruncated?: boolean })=>f.patchTruncated));
  const review = parsePullRequestReview(JSON.stringify({ ...output, findings: [] }), { item: { ...item, filesTruncated: true, totalChangedFiles: 120, checksAvailable: false }, files, checks: [] });
  assert.equal(review.scope.filesComplete, false); assert.equal(review.scope.totalFiles, 120);
  assert.ok(review.limitations.some(value=>value.includes('前 100')));
});
test('review decisions isolate owners, reject stale revisions and retain history', () => {
  const review = { ...parsed(), repoUrl }; savePullRequestReview('alice', repoUrl, review);
  assert.equal(getPullRequestReview('bob', repoUrl, 45), null);
  assert.throws(()=>updatePullRequestFinding('bob',repoUrl,45,review.findings[0].id,{status:'accepted'},review.id,1));
  const next = updatePullRequestFinding('alice',repoUrl,45,review.findings[0].id,{status:'accepted',reviewerNote:'请补回归测试'},review.id,1);
  assert.equal(next.revision,2); assert.equal(next.findings[0].reviewerNote,'请补回归测试');
  assert.throws(()=>updatePullRequestFinding('alice',repoUrl,45,review.findings[0].id,{status:'dismissed'},review.id,1),/变化/);
  assert.equal(listPullReviewHistory('alice',repoUrl,45).length,2);
  assert.equal(listPullReviewHistory('bob',repoUrl,45).length,0);
});
test('draft includes only confirmed verified findings and disallows unresolved clues', () => {
  const review = parsed(); assert.throws(()=>formatReviewDraft(review),/逐项/);
  review.findings[0].status='accepted'; const text=formatReviewDraft(review);
  assert.match(text,/data.name/); assert.match(text,/固定提交/);
  review.findings[0].status='dismissed'; assert.ok(!formatReviewDraft(review).includes('空输入可能抛异常'));
  review.findings[0].status='accepted'; review.findings[0].evidenceVerified=false;
  assert.throws(()=>formatReviewDraft(review),/未核实/);
});
test('CI failures, empty results and permission errors remain distinct', async t => {
  let mode = 'failure';
  t.mock.method(globalThis,'fetch', async (input: URL | Request | string) => {
    if(mode==='denied') return new Response('',{status:403});
    if(String(input).includes('check-runs')) return Response.json({total_count:mode==='failure'?1:0,check_runs:mode==='failure'?[{name:'unit',status:'completed',conclusion:'failure'}]:[]});
    return Response.json({total_count:0,statuses:[]});
  });
  const failed=await getPullRequestChecks('ci-owner',repoUrl,head); assert.equal(failed.checks[0].conclusion,'failure'); assert.equal(failed.available,true);
  mode='empty'; const empty=await getPullRequestChecks('ci-owner',repoUrl,head); assert.equal(empty.available,true); assert.equal(empty.checks.length,0);
  mode='denied'; const denied=await getPullRequestChecks('ci-owner',repoUrl,head); assert.equal(denied.available,false); assert.ok(denied.warnings.length);
});
test('PR collection refuses mutable head/base changed during snapshot', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async (input: URL | Request | string)=> {
    const url=String(input);
    if(url.endsWith('/pulls/45')) { calls++; return Response.json({ ...item, html_url:item.url, updated_at:item.updatedAt, head:{sha:calls===1?head:'c'.repeat(40)}, base:{sha:base}, changed_files:1 }); }
    if(url.includes('/files')) return Response.json([{filename:'src/reader.ts',patch,additions:1,deletions:1,status:'modified'}]);
    if(url.includes('check-runs')) return Response.json({check_runs:[],total_count:0});
    if(url.includes('/status')) return Response.json({statuses:[],total_count:0});
    if(url.endsWith('/issues/42')) return Response.json({title:'empty input',body:'repro'});
    throw new Error(url);
  });
  await assert.rejects(getPullRequestReviewContext('snapshot-owner',repoUrl,45),/更新/);
});
test('read-only voyage context marks same-commit reports stale when description or diff changes', async t => {
  const token=saveGithubAccount('voyage-context','voyage-reader','fake',false), owner=accountSession(token)!;
  saveProject(owner,{repoUrl,fullName:'example/project'});
  const review=parsed();review.contextFingerprint=reviewFingerprint(item,prepareReviewFiles(item.files!));
  savePullRequestReview(owner,repoUrl,review);
  let changedBody=false,changedPatch=false,writes=0;
  t.mock.method(globalThis,'fetch',async(input:URL|Request|string,init?:RequestInit)=>{
    if(init?.method && init.method!=='GET') writes++;
    const url=String(input);
    if(url.endsWith('/pulls/45')) return Response.json({number:45,title:item.title,body:changedBody?'Updated description':item.body,html_url:item.url,state:'open',updated_at:item.updatedAt,head:{sha:head},base:{sha:base},changed_files:1,labels:[]});
    if(url.includes('/files')) return Response.json([{filename:'src/reader.ts',status:'modified',additions:1,deletions:1,patch:changedPatch?patch+'\n extra context':patch}]);
    if(url.includes('check-runs')) return Response.json({check_runs:[{name:'unit',status:'completed',conclusion:'success'}],total_count:1});
    if(url.includes('/status')) return Response.json({statuses:[],total_count:0});
    if(url.endsWith('/issues/42')) return Response.json({title:'Empty input',body:'Use null input'});
    throw new Error(url);
  });
  const read=async()=>{const response=await GET(new NextRequest('http://localhost/api/workbench/review?number=45&context=1',{headers:{cookie:`repocare_login=${token}`}}));assert.equal(response.status,200);return (await response.json()).item;};
  const current=await read();assert.equal(current.reviewSnapshot.state,'current');assert.equal(current.checks[0].conclusion,'success');
  changedBody=true;const bodyChanged=await read();assert.equal(bodyChanged.reviewSnapshot.state,'stale');assert.equal(bodyChanged.checks[0].conclusion,'success');
  changedBody=false;changedPatch=true;assert.equal((await read()).reviewSnapshot.state,'stale');
  assert.equal(writes,0);assert.equal(getPullRequestReview(owner,repoUrl,45)!.revision,1);
});
test('mock model + routes cover analyze, repair, confirm, draft, stale publish without actual writes', async t => {
  const token=saveGithubAccount('pr-flow','reviewer','fake',true), owner=accountSession(token)!;
  saveProject(owner,{repoUrl,fullName:'example/project'});
  saveConnection(owner,{name:'mock',provider:'custom',protocol:'openai-completions',baseUrl:'https://model.example/v1',modelId:'mock',apiKey:'mock',keyAction:'replace',contextWindow:128000,maxTokens:4096});
  let currentHead=head, modelCalls=0; const writes: unknown[]=[];
  t.mock.method(globalThis,'fetch',async (input: URL | Request | string, init?: RequestInit)=> {
    const url=String(input);
    if(init?.method==='POST') { writes.push(JSON.parse(String(init.body))); return Response.json({html_url:repoUrl+'/pull/45#review'}); }
    if(url.endsWith('/repos/example/project')) return Response.json({permissions:{push:true}});
    if(url.endsWith('/pulls/45')) return Response.json({number:45,title:item.title,body:item.body,html_url:item.url,state:'open',updated_at:item.updatedAt,head:{sha:currentHead},base:{sha:base},changed_files:1,labels:[]});
    if(url.includes('/files')) return Response.json([{filename:'src/reader.ts',status:'modified',additions:1,deletions:1,patch}]);
    if(url.includes('check-runs')) return Response.json({check_runs:[{name:'unit',status:'completed',conclusion:'failure'}],total_count:1});
    if(url.includes('/status')) return Response.json({statuses:[],total_count:0});
    if(url.endsWith('/issues/42')) return Response.json({title:'Empty input bug',body:'Use null input'});
    throw new Error(url);
  });
  const sdk=await import('@mariozechner/pi-ai'), original=sdk.getApiProvider('openai-completions')!;
  const stream=()=>{
    modelCalls++;
    const message: AssistantMessage={role:'assistant',api:'openai-completions',provider:'custom',model:'mock',stopReason:'stop',timestamp:Date.now(),content:[{type:'text',text:modelCalls===1?'{}':JSON.stringify(output)}],usage:{input:10,output:20,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    const events=sdk.createAssistantMessageEventStream(); events.push({type:'done',reason:'stop',message});events.end(message);return events;
  };
  sdk.registerApiProvider({api:'openai-completions',stream,streamSimple:stream});
  const request=(body:unknown)=>new NextRequest('http://localhost/api/workbench/review',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost',cookie:`repocare_login=${token}`},body:JSON.stringify(body)});
  try {
    const response=await POST(request({action:'analyze',number:45})); assert.equal(response.status,200); const {review}=await response.json();
    assert.equal(modelCalls,2); assert.equal(review.findings[0].evidenceVerified,true); assert.equal(review.model.modelId,'mock'); assert.equal(review.linkedIssues[0].number,42);
    const cached=await POST(request({action:'analyze',number:45})); assert.equal(cached.status,200); assert.equal(modelCalls,2);
    const confirmed=await POST(request({action:'finding',number:45,findingId:review.findings[0].id,reviewId:review.id,revision:1,status:'accepted'})); assert.equal(confirmed.status,200);
    const stale=await POST(request({action:'finding',number:45,findingId:review.findings[0].id,reviewId:review.id,revision:1,status:'dismissed'})); assert.equal(stale.status,400);
    const result=await drafts(request({action:'item',kind:'review',number:45})); assert.equal(result.status,200); const {draft}=await result.json(); assert.equal(draft.baseSha,head); assert.equal(draft.source.reviewId,review.id);
    currentHead='c'.repeat(40);
    await assert.rejects(publishDraft(owner,draft),/新提交/); assert.equal(writes.length,0);
    const blocked=await drafts(request({action:'item',kind:'review',number:45})); assert.equal(blocked.status,400);
    assert.equal(getDraft(owner,draft.id).status,'draft');
    currentHead=head;
    const stored=getPullRequestReview(owner,repoUrl,45)!;
    const changed=updatePullRequestFinding(owner,repoUrl,45,stored.findings[0].id,{status:'open'},stored.id,stored.revision);
    await assert.rejects(publishDraft(owner,draft),/判断或基准/); assert.equal(writes.length,0);
    updatePullRequestFinding(owner,repoUrl,45,changed.findings[0].id,{status:'accepted'},changed.id,changed.revision);
    const newDraftResponse=await drafts(request({action:'item',kind:'review',number:45}));
    assert.equal(newDraftResponse.status,200);const newDraft=(await newDraftResponse.json()).draft;
    await publishDraft(owner,newDraft);
    assert.equal(writes.length,1);
    assert.equal((writes[0] as { event:string }).event,'COMMENT');
    assert.equal((writes[0] as { commit_id:string }).commit_id,head);
    const foreign=await GET(new NextRequest('http://localhost/api/workbench/review?number=45')); assert.equal(foreign.status,404);
  } finally { sdk.registerApiProvider(original); }
});
