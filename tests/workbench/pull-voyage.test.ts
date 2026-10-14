import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitItem } from '../../src/contracts/workbench';
import { commitTexture, pullChangeSignal, pullCheckSignal, pullIdentity, pullReviewSignal } from '../../src/features/workbench/pull-voyage-model';

const item: GitItem = {number:1,title:'Update parser',body:'',url:'https://github.com/example/parser/pull/1',state:'open',author:'dev',labels:[],updatedAt:'2026-10-14T00:00:00Z',headSha:'a'.repeat(40),baseSha:'b'.repeat(40)};
test('unread and empty checks never claim a pass, unknown statuses never claim active CI',()=>{
  assert.equal(pullCheckSignal(item).tone,'unknown');
  assert.equal(pullCheckSignal({...item,checks:[],checksAvailable:true}).label,'未发现检查');
  const unknown=pullCheckSignal({...item,checks:[{name:'ci',status:'unknown'}],checksAvailable:true});
  assert.equal(unknown.tone,'unknown');assert.equal(unknown.running,0);
});
test('partial successful checks cannot be presented as all checks completed',()=>{
  const check={name:'tests',status:'completed' as const,conclusion:'success'};
  assert.equal(pullCheckSignal({...item,checks:[check],checksAvailable:false}).tone,'unknown');
  assert.equal(pullCheckSignal({...item,checks:[check],checksAvailable:true}).tone,'passed');
});
test('known failures take precedence over pending while pending retains actual active count',()=>{
  const signal=pullCheckSignal({...item,checks:[{name:'lint',status:'completed',conclusion:'failure'},{name:'tests',status:'in_progress'}],checksAvailable:false});
  assert.equal(signal.tone,'failed');assert.equal(signal.failed,1);assert.equal(signal.running,1);
});
test('stale saved CI is hidden, freshly collected CI survives an expired review report',()=>{
  const stale:GitItem={...item,reviewSnapshot:{state:'stale',findingCount:2,openFindingCount:2,acceptedFindingCount:0,analyzedAt:'2026-10-13'},checks:[{name:'tests',status:'completed',conclusion:'success'}],checksAvailable:true};
  assert.equal(pullCheckSignal(stale).total,0);
  assert.equal(pullCheckSignal(stale,true).tone,'passed');
  assert.deepEqual(pullReviewSignal(stale),{tone:'stale',label:'审查已过期',open:0});
});
test('file totals describe only loaded files and keep unread distinct from actual zero',()=>{
  assert.equal(pullChangeSignal(item).read,false);
  assert.equal(pullChangeSignal({...item,files:[]}).read,true);
  const changes=pullChangeSignal({...item,totalChangedFiles:180,filesTruncated:true,files:[{path:'src/a.ts',status:'modified',additions:4,deletions:7},{path:'docs/a.md',status:'added',additions:12,deletions:0}]});
  assert.equal(changes.additions,16);assert.equal(changes.deletions,7);assert.equal(changes.count,2);assert.equal(changes.total,180);assert.equal(changes.partial,true);
});
test('commit identity invalidates when project, head, base or content timestamp changes',()=>{
  for(const changed of [{url:item.url.replace('parser','other')},{headSha:'c'.repeat(40)},{baseSha:'d'.repeat(40)},{updatedAt:'2026-10-15'}]) assert.notEqual(pullIdentity({...item,...changed}),pullIdentity(item));
  assert.deepEqual(commitTexture('not-a-commit'),[]);assert.deepEqual(commitTexture(undefined),[]);
  assert.deepEqual(commitTexture('0123456789abcdef'.repeat(2)+'01234567'),[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
});
test('new analysis and changed maintainer finding decisions invalidate cached review signals',()=>{
  const reviewed:GitItem={...item,reviewSnapshot:{state:'current',findingCount:2,openFindingCount:2,acceptedFindingCount:0,analyzedAt:'2026-10-14T00:00:00Z'}};
  const updated={...reviewed,reviewSnapshot:{...reviewed.reviewSnapshot!,openFindingCount:1,acceptedFindingCount:1}};
  assert.notEqual(pullIdentity(reviewed),pullIdentity(updated));
  assert.notEqual(pullIdentity(reviewed),pullIdentity({...reviewed,reviewSnapshot:{...reviewed.reviewSnapshot!,analyzedAt:'2026-10-14T01:00:00Z'}}));
});
