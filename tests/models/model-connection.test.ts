import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '../../src/server/audit/store';
import { saveConnection, getRuntime, listSettings, recordTest } from '../../src/server/models/store';
import { POST, GET } from '../../src/app/api/models/route';
import { modelPresets, endpointIdentity, sameModelTarget, requestEndpoint } from '../../src/shared/lib/model-connection';
const directory=mkdtempSync(join(tmpdir(),'repocare-connection-ui-'));
process.env.REPOCARE_DB_PATH=join(directory,'test.sqlite');
after(()=>{db().close();rmSync(directory,{recursive:true,force:true});});
const input={name:'DeepSeek 工作账户',provider:'deepseek',protocol:'openai-completions',baseUrl:'https://api.deepseek.com',modelId:'model-alias',contextWindow:128000,maxTokens:4096,apiKey:'fake-secret-only',keyAction:'replace'} as const;
test('preset endpoints are explicit and target comparison normalizes safe aliases, not arbitrary paths',()=>{
 assert.equal(modelPresets.length,9);assert.equal(endpointIdentity('https://api.deepseek.com/v1/'),endpointIdentity('https://api.deepseek.com'));
 assert.equal(sameModelTarget(input,{...input,provider:'custom',baseUrl:'https://api.deepseek.com/v1'}),true);
 assert.equal(sameModelTarget(input,{...input,protocol:'openai-responses'}),false);
 assert.equal(sameModelTarget(input,{...input,modelId:'different'}),false);
 assert.equal(sameModelTarget(input,{...input,baseUrl:'https://api.deepseek.com/other'}),false);
 assert.equal(requestEndpoint({baseUrl:'https://api.anthropic.com',protocol:'anthropic-messages'}),'https://api.anthropic.com/v1/messages');
 assert.equal(requestEndpoint({baseUrl:'https://api.openai.com/v1',protocol:'openai-responses'}),'https://api.openai.com/v1/responses');
 assert.equal(requestEndpoint({baseUrl:'https://provider.example/v1?token=secret',protocol:'openai-completions'}).includes('secret'),false);
});
test('repeat create and same-name create are rejected while editing updates one record and preserves its key',()=>{
 const saved=saveConnection('owner-a',input);
 assert.throws(()=>saveConnection('owner-a',input),/同名/);
 assert.throws(()=>saveConnection('owner-a',{...input,name:'另一名字',baseUrl:'https://api.deepseek.com/v1'}),/已配置/);
 const edited=saveConnection('owner-a',{...input,apiKey:'',keyAction:'keep'},saved.id,saved.revision);
 assert.equal(edited.id,saved.id);assert.equal(listSettings('owner-a').connections.length,1);assert.equal(getRuntime('owner-a',saved.id).apiKey,input.apiKey);
 assert.throws(()=>saveConnection('owner-a',input,saved.id,saved.revision),/已在其他页面/);
});
test('explicit separate credentials require distinct name plus confirmation and do not switch defaults by accident',()=>{
 const one=saveConnection('owner-b',input);
 assert.throws(()=>saveConnection('owner-b',input,undefined,undefined,{allowDuplicate:true}),/同名/);
 const two=saveConnection('owner-b',{...input,name:'DeepSeek 个人账户',apiKey:'fake-second-key'},undefined,undefined,{allowDuplicate:true});
 assert.equal(listSettings('owner-b').defaultId,one.id);
 assert.equal(getRuntime('owner-b',two.id).apiKey,'fake-second-key');
 const three=saveConnection('owner-b',{...input,name:'OpenAI backup',provider:'custom',baseUrl:'https://other.example/v1'},undefined,undefined,{makeDefault:true});
 assert.equal(listSettings('owner-b').defaultId,three.id);
});
test('legacy identical names remain editable in place without deleting or choosing a different default',()=>{
 const one=saveConnection('legacy-owner',input);
 const two=saveConnection('legacy-owner',{...input,name:'Temporary distinct name'},undefined,undefined,{allowDuplicate:true});
 const state=db().prepare('SELECT state FROM model_connections WHERE id=?').get(two.id) as {state:string};
 db().prepare('UPDATE model_connections SET state=? WHERE id=?').run(JSON.stringify({...JSON.parse(state.state),name:input.name}),two.id);
 const edited=saveConnection('legacy-owner',{...input,keyAction:'replace',apiKey:'repaired-key'},two.id,two.revision);
 assert.equal(edited.id,two.id);assert.equal(listSettings('legacy-owner').connections.length,2);assert.equal(listSettings('legacy-owner').defaultId,one.id);
 assert.equal(getRuntime('legacy-owner',two.id).apiKey,'repaired-key');
});
test('editing may explicitly switch default atomically, invalid save never switches it and tests invalidate on edits',()=>{
 const one=saveConnection('atomic-owner',input),two=saveConnection('atomic-owner',{...input,name:'Different platform',baseUrl:'https://other.example/v1'});
 recordTest('atomic-owner',two.id,1,{ok:true,message:'mock',latencyMs:1});
 const edit=saveConnection('atomic-owner',{...input,name:'Different platform',baseUrl:'https://other.example/v1',apiKey:'',keyAction:'keep'},two.id,1,{makeDefault:true});
 assert.equal(listSettings('atomic-owner').defaultId,two.id);assert.equal(edit.test,undefined);
 assert.throws(()=>saveConnection('atomic-owner',{...input,name:'Bad',baseUrl:'http://evil.example',apiKey:'bad'},one.id,1,{makeDefault:true}),/HTTPS/);
 assert.equal(listSettings('atomic-owner').defaultId,two.id);
});
test('API returns exact savedId, protects account ownership and rejects duplicate creates',async()=>{
 const initial=await GET(new NextRequest('http://localhost/api/models'));
 const cookie=initial.headers.get('set-cookie')!.split(';')[0];
 const req=(body:unknown)=>new NextRequest('http://localhost/api/models',{method:'POST',headers:{cookie,origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)});
 const created=await POST(req({action:'save',input}));assert.equal(created.status,200);
 const value=await created.json();assert.equal(value.savedId,value.connections[0].id);assert.ok(!JSON.stringify(value).includes(input.apiKey));
 const duplicate=await POST(req({action:'save',input}));assert.equal(duplicate.status,400);
 const edited=await POST(req({action:'save',id:value.savedId,revision:1,input:{...input,keyAction:'keep',apiKey:''}}));
 const result=await edited.json();assert.equal(result.savedId,value.savedId);assert.equal(result.connections.length,1);assert.equal(result.connections[0].revision,2);
 const other=saveConnection('other-owner',input);assert.equal((await POST(req({action:'save',id:other.id,revision:1,input,makeDefault:true}))).status,400);
});
