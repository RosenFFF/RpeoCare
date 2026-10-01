import { test, expect } from '@playwright/test';
import type { GitItem, PullRequestReview } from '../../src/contracts/workbench';
const sha='a'.repeat(40), base='b'.repeat(40);
const project={repoUrl:'https://github.com/example/project',fullName:'example/project'};
const item: GitItem={number:45,title:'Refactor reader',body:'Fixes #42: simplify reader',state:'open',author:'contributor',url:project.repoUrl+'/pull/45',updatedAt:'2026-10-01T00:00:00Z',labels:[],headSha:sha,baseSha:base,headRef:'fix/reader',baseRef:'main',totalChangedFiles:1,checksAvailable:true,checks:[{name:'unit tests',status:'completed',conclusion:'failure'}],linkedIssues:[{number:42,title:'Empty input fails',body:'Passing null input should not crash.',url:project.repoUrl+'/issues/42'}],files:[{path:'src/reader.ts',status:'modified',additions:1,deletions:1,patch:'@@ -10,2 +10,2 @@\n-const value = data?.name;\n+const value = data.name;\n return value;'}]};
const report: PullRequestReview={id:'bbd21770-a427-4c8f-b915-b6c5b7b02d72',revision:1,repoUrl:project.repoUrl,number:45,headSha:sha,baseSha:base,title:item.title,summary:'移除空值保护，需核对输入约定与回归测试。',scope:{files:1,totalFiles:1,filesComplete:true,additions:1,deletions:1,truncatedFiles:0,reviewedFiles:['src/reader.ts'],testFiles:[],docsFiles:[]},checks:item.checks!,checksAvailable:true,findings:[{id:'f1',severity:'warning',category:'correctness',title:'空输入可能抛异常',explanation:'当 data 为 null 时属性访问会抛异常，请补空输入回归测试。',path:'src/reader.ts',line:10,side:'RIGHT',evidence:'const value = data.name;',evidenceVerified:true,confidence:'medium',status:'open'}],limitations:['仅可见 Diff，不代表测试通过。'],analyzedAt:'2026-10-01T00:00:00Z',promptVersion:'pr-review-v2'};

test('PR review links real context, CI failure, finding decisions, drafts and history',async({page})=>{
  let review: PullRequestReview|null=null, analyzeCalls=0, drafts=0;
  await page.route('**/api/workbench',r=>r.fulfill({json:{project,runs:[],drafts:[],github:null,usage:{}}}));
  await page.route('**/api/workbench/items**',r=>r.fulfill({json:{items:[item]}}));
  await page.route('**/api/workbench/review**',async r=>{
    if(r.request().method()==='POST') {
      const body=r.request().postDataJSON();
      if(body.action==='analyze'){ analyzeCalls++;review=structuredClone(report); }
      if(body.action==='finding') { expect(body.reviewId).toBe(report.id); expect(body.revision).toBe(1);review={...report,revision:2,findings:report.findings.map(f=>({...f,status:body.status}))}; }
      return r.fulfill({json:{review}});
    }
    if(r.request().url().includes('history=1')) return r.fulfill({json:{history:[{at:report.analyzedAt,review:review||report}]}});
    return r.fulfill({json:{item,review}});
  });
  await page.route('**/api/workbench/drafts',r=>{drafts++;return r.fulfill({json:{draft:{id:'draft1'}}});});
  await page.goto('/pull-requests');
  await expect(page.getByRole('heading',{name:'PR 审查',exact:true})).toBeVisible();
  await expect(page.locator('.pr-workbench .issue-detail-panel')).toBeVisible();
  await expect(page.getByRole('region',{name:'Pull Request 列表'})).toHaveCount(0);
  await expect(page.locator('.issue-list-panel')).toHaveAttribute('inert','');
  await expect(page.locator('.pr-ci-details')).toContainText('failure');
  await expect(page.getByRole('button',{name:'生成已筛选审阅草稿'})).toBeDisabled();
  await page.getByRole('button',{name:'开始 AI 审查',exact:true}).click();
  await expect(page.getByRole('heading',{name:'空输入可能抛异常'})).toBeVisible();
  await expect(page.locator('.pr-review-finding')).toContainText('data.name');
  await page.getByRole('button',{name:'确认发现',exact:true}).click();
  await expect(page.locator('.pr-review-finding')).toContainText('已由维护者确认');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'生成已筛选审阅草稿'}).click();
  await expect.poll(()=>drafts).toBe(1);expect(analyzeCalls).toBe(1);
  await page.getByText('审查与人工判断历史',{exact:true}).click();
  await expect(page.locator('.pr-history')).toContainText('r2');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'AI 审查结果'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.pr-review-panel').screenshot({path:'output/playwright/pr-review-panel.png'});
});

test('PR update disables old findings and permits fresh analysis only',async({page})=>{
  await page.route('**/api/workbench',r=>r.fulfill({json:{project,runs:[],drafts:[],github:null,usage:{}}}));
  await page.route('**/api/workbench/items**',r=>r.fulfill({json:{items:[item]}}));
  await page.route('**/api/workbench/review**',r=>r.fulfill({json:{item:{...item,headSha:'c'.repeat(40)},review:report}}));
  await page.goto('/pull-requests');
  await expect(page.locator('.pr-workbench .issue-detail-panel')).toBeVisible();
  await expect(page.locator('.pr-review-alert[role=alert]')).toContainText('旧提交审查');
  await expect(page.getByRole('button',{name:'确认发现'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'生成已筛选审阅草稿'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'审查最新提交'})).toBeEnabled();
});
