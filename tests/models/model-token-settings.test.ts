import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { db, getRunConnection } from '../../src/server/audit/store';
import { createConfiguredRun } from '../../src/server/models/run-config';
import { saveConnection, getRuntime } from '../../src/server/models/store';
import { modelForConnection } from '../../src/server/models/adapter';
import { outputOptions } from '../../src/server/models/output-options';
import { assistant } from '../../src/server/workbench/assistant';
import { analyzeWithAgent } from '../../src/server/audit/agent';
import type { RuntimeConnection } from '../../src/contracts/models';
import type { RepoSnapshot } from '../../src/contracts/audit';
const directory=mkdtempSync(join(tmpdir(),'repocare-token-settings-'));
process.env.REPOCARE_DB_PATH=join(directory,'test.sqlite');
after(()=>{db().close();rmSync(directory,{recursive:true,force:true});});
const connection:RuntimeConnection={id:'mock',revision:1,name:'test',provider:'custom',protocol:'openai-completions',baseUrl:'https://provider.example/v1',modelId:'not-in-catalog',apiKey:'fake-key',contextWindow:null,maxTokens:null};
const input={...connection,keyAction:'replace' as const};delete (input as Partial<typeof input>).id;delete (input as Partial<typeof input>).revision;
const message=(api:Api,text:string):AssistantMessage=>({role:'assistant',api,provider:'custom',model:'not-in-catalog',stopReason:'stop',content:[{type:'text',text}],timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
test('optional fields default to auto and explicit values survive roundtrip and queue snapshot',()=>{
 const saved=saveConnection('auto-owner',{...input,contextWindow:undefined,maxTokens:undefined});assert.equal(saved.contextWindow,null);assert.equal(saved.maxTokens,null);
 const run=createConfiguredRun('auto-owner','https://github.com/example/project');assert.equal(getRunConnection(run.id)?.maxTokens,null);
 const edited=saveConnection('auto-owner',{...input,contextWindow:256000,maxTokens:65536},saved.id,1);assert.equal(getRuntime('auto-owner',saved.id).maxTokens,65536);assert.equal(getRunConnection(run.id)?.maxTokens,null);
 const cleared=saveConnection('auto-owner',{...input,contextWindow:null,maxTokens:null},saved.id,edited.revision);assert.equal(cleared.id,saved.id);assert.equal(cleared.maxTokens,null);
 assert.throws(()=>saveConnection('invalid',{...input,contextWindow:1000,maxTokens:2000}),/检查/);
 assert.throws(()=>saveConnection('invalid',{...input,maxTokens:0}),/检查/);assert.throws(()=>saveConnection('invalid',{...input,contextWindow:1.5}),/检查/);
});
test('custom unknown capabilities are not fictional infinite values; known exact catalog metadata is reused',async()=>{
 const unknown=await modelForConnection(connection);assert.equal(unknown.contextWindow,0);assert.equal(unknown.maxTokens,0);
 const sdk=await import('@mariozechner/pi-ai');const known=sdk.getModels('deepseek')[0];
 const model=await modelForConnection({...connection,provider:known.provider,protocol:known.api as RuntimeConnection['protocol'],baseUrl:known.baseUrl,modelId:known.id});assert.equal(model.contextWindow,known.contextWindow);assert.equal(model.maxTokens,known.maxTokens);
 const explicit=await modelForConnection({...connection,contextWindow:256000,maxTokens:65536});assert.equal(explicit.contextWindow,256000);assert.equal(explicit.maxTokens,65536);
});
test('auto removes SDK-added token defaults from optional protocols, while Messages requires known or explicit output',async()=>{
 for(const protocol of ['openai-completions','openai-responses'] as const){const model=await modelForConnection({...connection,protocol});const options=outputOptions(connection,model);const body=await options.onPayload?.({model:model.id,max_tokens:32000,max_completion_tokens:32000,max_output_tokens:32000,temperature:1},model) as Record<string,unknown>;assert.ok(!('max_tokens'in body));assert.ok(!('max_completion_tokens'in body));assert.ok(!('max_output_tokens'in body));assert.equal(body.temperature,1);}
 const unknown=await modelForConnection({...connection,protocol:'anthropic-messages'});assert.throws(()=>outputOptions(connection,unknown),/必须指定/);
 assert.equal(outputOptions({...connection,maxTokens:8192},unknown).maxTokens,8192);
 const sdk=await import('@mariozechner/pi-ai');const known=sdk.getModels('anthropic')[0];assert.equal(outputOptions(connection,known).maxTokens,known.maxTokens);
});
test('ordinary assistant sends user value above 4096 and auto mode never gets an added cap at real SDK payload',async t=>{
 const sdk=await import('@mariozechner/pi-ai');
 for(const protocol of ['openai-completions','openai-responses'] as const){
  const original=sdk.getApiProvider(protocol)!;let observed:SimpleStreamOptions|undefined;
  const stream=(model:Model<Api>,_context:Context,options?:SimpleStreamOptions)=>{observed=options;const events=sdk.createAssistantMessageEventStream();events.end(message(model.api,'reply'));return events;};
  sdk.registerApiProvider({api:protocol,stream,streamSimple:stream});
  try{assert.equal(await assistant('tokens-owner','issue','Reply',{},[],undefined,{...connection,protocol,maxTokens:8192}),'reply');assert.equal(observed?.maxTokens,8192);await assistant('tokens-owner','issue','Reply',{},[],undefined,{...connection,protocol});assert.equal(observed?.maxTokens,undefined);assert.equal(typeof observed?.onPayload,'function');}finally{sdk.registerApiProvider(original);}
 }
 const bodies:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({error:{message:'mock rejected'}},{status:400});});
 await assert.rejects(assistant('payload-owner','issue','Reply',{},[],undefined,connection),/HTTP 400/);
 assert.equal(bodies.length,1);assert.ok(!('max_tokens'in bodies[0]));assert.ok(!('max_completion_tokens'in bodies[0]));
 await assert.rejects(assistant('payload-owner','issue','Reply',{},[],undefined,{...connection,protocol:'openai-responses'}),/HTTP 400/);
 assert.ok(!('max_output_tokens'in bodies.at(-1)!));
});
test('audit Agent forwards explicit output instead of 3500 and auto strips its SDK defaults',async()=>{
 const sdk=await import('@mariozechner/pi-ai'),original=sdk.getApiProvider('openai-completions')!;let observed:SimpleStreamOptions|undefined;
 const raw=JSON.stringify({checks:[{id:'readme-clarity',status:'unknown',summary:'not enough evidence',evidence:[]}]});
 const stream=(model:Model<Api>,_context:Context,options?:SimpleStreamOptions)=>{observed=options;const events=sdk.createAssistantMessageEventStream();events.end(message(model.api,raw));return events;};
 sdk.registerApiProvider({api:'openai-completions',stream,streamSimple:stream});
 const snapshot:RepoSnapshot={repository:{owner:'example',name:'project',fullName:'example/project',url:'https://github.com/example/project',branch:'main',sha:'a'.repeat(40),description:'',language:null},files:[],contents:[],treeTruncated:false,warnings:[]};
 try{await analyzeWithAgent(snapshot,new AbortController().signal,undefined,{...connection,maxTokens:16384});assert.equal(observed?.maxTokens,16384);await analyzeWithAgent(snapshot,new AbortController().signal,undefined,connection);assert.equal(observed?.maxTokens,undefined);assert.equal(typeof observed?.onPayload,'function');}finally{sdk.registerApiProvider(original);}
});
