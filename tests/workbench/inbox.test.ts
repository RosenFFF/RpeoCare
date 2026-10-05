import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitItem, IssueTriage } from '../../src/contracts/workbench';
import { inScope, issueClassification, pullClassification } from '../../src/features/workbench/inbox-model';
const item: GitItem = { number:1, title:'Bump Sphinx dependency', body:'', url:'https://github.com/example/project/pull/1', state:'open',author:'bot',updatedAt:'2026-10-05', labels:[] };
test('inbox classification uses maintainer values instead of overriding them with AI',()=>{
  const triage: IssueTriage = {repoUrl:'repo',number:1,sourceUpdatedAt:item.updatedAt,category:'bug',priority:'low',confidence:'medium',needsMoreInfo:false,language:'en',titleZh:'问题',summaryZh:'摘要',providedInformation:[],missingInformation:[],suggestedLabels:[],suggestedAction:'investigate',workflowStatus:'investigate',commentsZh:[],analyzedAt:'now',review:{category:'compatibility',priority:'high',workflowStatus:'needs-info',confirmedAt:'now'}};
  const reviewed={...item,triage};
  assert.equal(issueClassification(reviewed).category,'compatibility');assert.equal(issueClassification(reviewed).source,'维护者确认');
  assert.equal(inScope(reviewed,'issues','high'),true);assert.equal(inScope(reviewed,'issues','needs-info'),true);assert.equal(inScope(reviewed,'issues','untriaged'),false);
  assert.equal(issueClassification({...reviewed,updatedAt:'later'}).stale,true);
});
test('untriaged issues do not acquire fake priority or processing conclusions',()=>{
  assert.equal(issueClassification(item).status,'untriaged');assert.equal(issueClassification(item).category,undefined);assert.equal(issueClassification(item).priority,'unknown');
  assert.equal(inScope(item,'issues','untriaged'),true);
});
test('PR type rules and Draft state remain independent',()=>{
  assert.equal(pullClassification(item),'dependency');assert.equal(pullClassification({...item,title:'docs: installation guide'}),'docs');assert.equal(pullClassification({...item,title:'fix: handle empty input'}),'fix');
  assert.equal(inScope({...item,isDraft:true},'pulls','draft'),true);assert.equal(inScope({...item,isDraft:true},'pulls','ready'),false);
  assert.equal(pullClassification({...item,title:'update behavior',labels:[] }),'other');
});
