import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { db } from '../../src/server/audit/store';
import { assistant } from '../../src/server/workbench/assistant';
import { modelFailure } from '../../src/server/models/failure';
import { recentModelFailures, recordModelFailure } from '../../src/server/models/request-diagnostics';
import { listSettings } from '../../src/server/models/store';
import { modelForConnection, withModelTransport } from '../../src/server/models/adapter';
import type { RuntimeConnection } from '../../src/contracts/models';

const directory = mkdtempSync(join(tmpdir(), 'repocare-model-diagnostics-'));
process.env.REPOCARE_DB_PATH = join(directory, 'test.sqlite');
after(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });
const connection: RuntimeConnection = { id:'mock-connection', revision:2, name:'Mock', provider:'custom', protocol:'openai-completions', baseUrl:'https://provider.example/v1', modelId:'mock-model', apiKey:'private-mock-api-key', contextWindow:128000, maxTokens:4096 };
function response(reason: AssistantMessage['stopReason'], text?: string): AssistantMessage {
  return { role:'assistant', api:'openai-completions', provider:'custom', model:'mock-model', stopReason:reason, content:text === undefined ? [] : [{type:'text',text}], timestamp:Date.now(), errorMessage:'PRIVATE upstream diagnostic including private-mock-api-key and prompt', usage:{input:10,output:25,cacheRead:0,cacheWrite:0,totalTokens:35,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} };
}
test('failure categories depend on trusted status/states, not sensitive provider strings', () => {
  for (const [status,category] of [[401,'authorization'],[403,'authorization'],[402,'balance'],[429,'rate-limit'],[404,'not-found'],[400,'invalid-request'],[500,'provider']] as const) assert.equal(modelFailure({status}).category, category);
  assert.equal(modelFailure({timedOut:true}).category,'timeout'); assert.equal(modelFailure({cancelled:true}).category,'cancelled');
  assert.equal(modelFailure({stopReason:'length'}).category,'truncated'); assert.equal(modelFailure({invalidText:'empty'}).category,'empty-output');
  assert.equal(modelFailure({stopReason:'toolUse'}).category,'incompatible-output'); assert.equal(modelFailure({}).category,'unknown');
});
test('transport observes non-2xx before SDK consumption and preserves endpoint/redirect guards', async t => {
  const statuses:number[]=[], failures:string[]=[];
  t.mock.method(globalThis,'fetch',async()=>new Response('private response body',{status:402}));
  const model=await modelForConnection(connection);
  await withModelTransport(model,async()=>{assert.equal((await fetch('https://provider.example/v1/chat/completions')).status,402);await assert.rejects(fetch('https://other.example/v1'),/已阻止/);},{onStatus:status=>statuses.push(status),onFailure:failure=>failures.push(failure)});
  assert.deepEqual(statuses,[402]);assert.deepEqual(failures,['blocked-endpoint']);
});
test('real assistant failures persist sanitized owner-scoped diagnostics and retain available token usage', async () => {
  const sdk=await import('@mariozechner/pi-ai'), original=sdk.getApiProvider('openai-completions')!;
  let message=response('error'),status:number|undefined=402;
  const stream=(_model:Model<Api>,_context:Context,options?:SimpleStreamOptions)=>{
    const events=sdk.createAssistantMessageEventStream();
    if(status)void options?.onResponse?.({status,headers:{}},_model);
    events.end(message);return events;
  };
  sdk.registerApiProvider({api:'openai-completions',stream,streamSimple:stream});
  try {
    const call=()=>assistant('diagnostic-owner','issue','Reply only',{body:'private source context'},[],undefined,connection);
    await assert.rejects(call(),/HTTP 402/);
    message=response('length');status=200;await assert.rejects(call(),/长度上限/);
    message=response('stop');await assert.rejects(call(),/没有可用文本/);
    message=response('toolUse');await assert.rejects(call(),/工具调用/);
    message=response('error');status=undefined;await assert.rejects(call(),/没有足够证据/);
    const records=recentModelFailures('diagnostic-owner');assert.equal(records.length,5);
    assert.equal(records.at(-1)?.category,'balance');assert.equal(records.at(-1)?.httpStatus,402);
    assert.ok(records.some(record=>record.category==='truncated'));assert.ok(records.some(record=>record.category==='empty-output'));
    const text=JSON.stringify(records);assert.ok(!text.includes(connection.apiKey));assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('private source context'));assert.ok(!text.includes('provider.example'));
    assert.deepEqual(recentModelFailures('different-owner'),[]);assert.equal(listSettings('diagnostic-owner').recentFailures.length,5);
    const usage=db().prepare('SELECT SUM(input_tokens) AS input,SUM(output_tokens) AS output FROM model_usage WHERE owner=?').get('diagnostic-owner') as {input:number;output:number};assert.equal(usage.input,50);assert.equal(usage.output,125);
    message=response('stop','Successful reply');assert.equal(await call(),'Successful reply');assert.equal(recentModelFailures('diagnostic-owner').length,5);
  } finally {sdk.registerApiProvider(original);}
});
test('abort before execution makes no model call and records cancellation instead of missing configuration', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(assistant('cancel-owner','issue','Reply',{},[],controller.signal,connection),/已取消/);
  assert.equal(recentModelFailures('cancel-owner')[0].category,'cancelled');
});
test('diagnostic retention is bounded per owner and rejects raw provider data by construction', () => {
  for(let i=0;i<52;i++)recordModelFailure('retention-owner','issue',connection,Date.now(),modelFailure({status:429}),429);
  assert.equal(recentModelFailures('retention-owner').length,5);
  const row=db().prepare('SELECT COUNT(*) AS n FROM model_request_diagnostics WHERE owner=?').get('retention-owner') as {n:number};assert.equal(row.n,50);
});
test('HTTP status is captured from fetch even when SDK does not fire onResponse for errors', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{message:'raw private provider message '+connection.apiKey}},{status:401}));
  await assert.rejects(assistant('http-error-owner','issue','Reply',{},[],undefined,connection),/HTTP 401/);
  assert.equal(recentModelFailures('http-error-owner')[0].category,'authorization');
  assert.ok(!JSON.stringify(recentModelFailures('http-error-owner')).includes(connection.apiKey));
});
