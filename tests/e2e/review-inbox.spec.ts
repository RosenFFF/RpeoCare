import { test, expect, showList, type Page } from './fixtures';
import type { GitItem, IssueTriage } from '../../src/contracts/workbench';
const project={repoUrl:'https://github.com/example/csv-kit',fullName:'example/csv-kit',branch:'main'};
const triage: IssueTriage={repoUrl:project.repoUrl,number:42,sourceUpdatedAt:'2026-10-05T08:00:00Z',category:'bug',priority:'high',confidence:'medium',needsMoreInfo:true,language:'English',titleZh:'空 CSV 会崩溃',summaryZh:'需要补充错误日志。',providedInformation:['空文件触发'],missingInformation:['错误日志'],suggestedLabels:['bug'],suggestedAction:'request-information',workflowStatus:'needs-info',commentsZh:[],analyzedAt:'2026-10-05T08:10:00Z'};
const base: GitItem={number:42,title:'Empty CSV raises IndexError',body:'Import an empty CSV file and the reader crashes.',state:'open',author:'river-dev',url:project.repoUrl+'/issues/42',updatedAt:triage.sourceUpdatedAt,labels:['bug'],commentCount:3,baseRef:'main'};
const issues: GitItem[]=([{...base,triage},{...base,number:39,title:'Add delimiter detection',author:'mika-data',labels:['enhancement']},{...base,number:37,title:'Document Notebook setup',labels:['docs'],triage:{...triage,number:37,category:'documentation',priority:'low',needsMoreInfo:false,workflowStatus:'ready-to-reply',suggestedAction:'reply'}}] satisfies GitItem[]).map(item=>({...item,url:`${project.repoUrl}/issues/${item.number}`}));
const pulls: GitItem[]=[{...base,number:45,title:'fix: Handle empty CSV input',url:project.repoUrl+'/pull/45',isDraft:false,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),headRef:'fix/empty',baseRef:'main',files:[{path:'src/reader.py',status:'modified',additions:2,deletions:1,patch:'@@ -1 +1 @@\n-old\n+new'}]}, {...base,number:43,title:'docs: Document Notebook setup',url:project.repoUrl+'/pull/43',labels:['documentation'],isDraft:true}, {...base,number:40,title:'Bump Sphinx from 8.0.2 to 9.1.0',author:'dependabot[bot]',url:project.repoUrl+'/pull/40',labels:['dependencies'],headSha:'c'.repeat(40),isDraft:false}];
async function setup(page:Page,items:GitItem[],connected=true){
  await page.route('**/api/workbench',r=>r.fulfill({json:{project:connected?project:null,runs:[],drafts:[],github:null,usage:{}}}));
  await page.route('**/api/workbench/items**',r=>{const url=new URL(r.request().url());const number=Number(url.searchParams.get('number'));return r.fulfill({json:number?{item:items.find(i=>i.number===number)}:{items:url.searchParams.get('page')==='2'?[]:items,repoUrl:project.repoUrl,base:url.searchParams.get('base'),hasNext:url.searchParams.get('page')!=='2'}});});
  await page.route('**/api/workbench/review**',r=>r.fulfill({json:{item:items[0],review:null}}));
  await page.route('**/api/workbench/reproduction**',r=>r.fulfill({json:{jobs:[],workerOnline:false,sandboxConfigured:false}}));
}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}

for (const width of [1440, 390]) test(`PR runway places changes by review stage and idle time at ${width}px`, async ({page}, testInfo) => {
  const items: GitItem[] = [pulls[0], {...pulls[1], checksAvailable:true, checks:[{name:'unit',status:'completed',conclusion:'failure'}], reviewSnapshot:{state:'current',coverageStatus:'partial',completedBlocks:1,totalBlocks:3,findingCount:0,openFindingCount:0,acceptedFindingCount:0,analyzedAt:base.updatedAt}}];
  let reads=0, writes=0;
  await page.setViewportSize({width,height:1000});await setup(page,items);
  await page.route('**/api/workbench/review**', r => {
    if(r.request().method() === 'POST') writes++;
    else reads++;
    const number=Number(new URL(r.request().url()).searchParams.get('number'));
    return r.fulfill({json:{item:items.find(item=>item.number===number) ?? items[0],review:null}});
  });
  await page.goto('/pull-requests');
  const inspector=page.getByRole('complementary',{name:'选中 PR 的观察面板'});
  await expect(page.getByRole('button',{name:/^目标分支 main/})).toBeVisible();
  await expect(inspector).toContainText(items[0].title);
  await expect(inspector).toContainText('检查待读取');
  await expect(inspector).toContainText('尚未审查');
  await expect(page.locator('.inbox-canvas-count')).toHaveText('本页显示 2 / 2 条');
  await expect(page.getByRole('textbox',{name:'搜索 PR'})).toHaveAttribute('placeholder',/^搜索本页/);
  await expect(page.locator('.inbox-canvas-list').filter({hasText:'列表'})).toBeVisible();
  await expect(page.getByRole('region',{name:'待审查，1 个 PR'})).toContainText('#45');
  await expect(page.getByRole('region',{name:'审查进行中，1 个 PR'})).toContainText('#43');
  await expect(page.locator('#inbox-row-pulls-43')).toContainText('部分审查 1/3');
  await expect(page.getByRole('region',{name:'待确认发现，0 个 PR'})).toContainText('当前页没有处于此阶段的 PR');
  await noOverflow(page);
  await page.locator('.review-page').screenshot({path:testInfo.outputPath(`pr-runway-${width}.png`)});
  await page.getByRole('group',{name:'按审查阶段突出显示'}).getByRole('button',{name:/审查进行中/}).click();
  await expect(page.getByRole('region',{name:'待审查，1 个 PR'})).toHaveClass(/is-dim/);
  await page.locator('#inbox-row-pulls-43').click();
  await expect(inspector).toContainText(items[1].title);
  await expect(inspector).toContainText('1 项未通过');
  await expect(inspector).toContainText('部分审查 1/3');
  expect(reads).toBe(0);expect(writes).toBe(0);
  await noOverflow(page);
  if(width===390) {
    const panel=await inspector.boundingBox(), board=await page.locator('.runway-board').boundingBox();
    expect(panel!.y+panel!.height).toBeLessThanOrEqual(board!.y+1);
  }
  await page.locator('.review-page').screenshot({path:testInfo.outputPath(`pr-runway-selected-${width}.png`)});
  await inspector.getByRole('button',{name:'进入 PR 审查'}).click();
  await expect(page.locator('.issue-detail-panel')).toBeVisible();
  expect(writes).toBe(0);
});

test('Issue inbox separates dimensions, restores filter and keyboard focus after detail',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await setup(page,issues);await page.goto('/issues');await showList(page,'Issue');
  await expect(page.locator('.inbox-row')).toHaveCount(3);await expect(page.locator('.issue-detail-panel')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Issue 工作区'})).toBeVisible();
  await page.screenshot({path:'output/playwright/inbox-issues-desktop.png',fullPage:true});
  await page.getByRole('group',{name:'Issue 快捷视图'}).getByRole('button',{name:/高优先级/}).click();await expect(page.locator('.inbox-row')).toHaveCount(1);
  await page.getByRole('button',{name:/#42 Empty CSV/}).click();
  await expect(page.getByRole('region',{name:'Issue 工作区'})).toHaveCount(0);
  await expect(page.locator('.review-detail-view')).toBeFocused();await expect(page.locator('.issue-detail-panel')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await noOverflow(page);await page.locator('.review-page').screenshot({path:'output/playwright/inbox-issues-detail-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'返回反馈收件箱'}).click();
  await expect(page.locator('.inbox-row')).toHaveCount(1);await expect(page.getByRole('button',{name:/#42 Empty CSV/})).toBeFocused();
  await page.getByRole('button',{name:'清除筛选'}).click();await expect(page.locator('.inbox-row')).toHaveCount(3);
  await page.getByRole('combobox',{name:'类别（含线索）',exact:true}).selectOption('documentation');await expect(page.locator('.inbox-row')).toHaveCount(1);
  await page.getByRole('button',{name:'清除筛选'}).click();
  await page.getByRole('textbox',{name:'搜索 Issue'}).fill('not-a-real-title');await expect(page.getByRole('heading',{name:'没有符合筛选条件的记录'})).toBeVisible();
  await page.getByRole('button',{name:'重置筛选'}).click();
  await page.setViewportSize({width:390,height:844});await noOverflow(page);await expect(page.locator('.inbox-row')).toHaveCount(3);
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-issues-mobile.png'});
});
test('PR inbox matches Issue shell and distinguishes change types from Draft state',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await setup(page,pulls);await page.goto('/pull-requests');await showList(page,'PR');
  await expect(page.locator('.inbox-row')).toHaveCount(3);await expect(page.locator('.issue-detail-panel')).toHaveCount(0);
  await page.screenshot({path:'output/playwright/inbox-pr-desktop.png',fullPage:true});
  await page.getByRole('button',{name:/Draft PR/}).click();await expect(page.locator('.inbox-row')).toHaveCount(1);await expect(page.locator('.inbox-row')).toContainText('docs:');
  await page.getByRole('button',{name:/全部变更/}).click();await page.getByRole('combobox',{name:'变更类型'}).selectOption('dependency');await expect(page.locator('.inbox-row')).toHaveCount(1);
  await page.getByRole('button',{name:'清除筛选'}).click();await page.getByRole('button',{name:/#45 fix:/}).click();await expect(page.locator('.issue-detail-panel')).toBeVisible();
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-pr-detail.png'});
  await page.setViewportSize({width:390,height:844});await noOverflow(page);await expect(page.locator('.pr-draft-ack input')).toHaveCSS('width','14px');
  await page.getByRole('button',{name:'返回变更收件箱'}).click();await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-pr-mobile.png'});
});
test('one PR and zero PR never create fake right panels or trigger auto analysis',async({page})=>{
  let calls=0;await page.setViewportSize({width:1440,height:1000});await setup(page,[pulls[0]]);
  await page.route('**/api/workbench/review**',r=>{calls++;return r.fulfill({json:{item:pulls[0],review:null}});});
  await page.goto('/pull-requests');await showList(page,'PR');await expect(page.locator('.inbox-row')).toHaveCount(1);expect(calls).toBe(0);await expect(page.locator('.issue-detail-panel')).toHaveCount(0);
  const width=await page.locator('.review-inbox').evaluate(el=>el.getBoundingClientRect().width);const rowWidth=await page.locator('.inbox-row').evaluate(el=>el.getBoundingClientRect().width);expect(Math.abs(width-rowWidth)).toBeLessThan(5);
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-pr-single.png'});
  await page.setViewportSize({width:1920,height:1080});await noOverflow(page);await page.locator('.review-page').screenshot({path:'output/playwright/inbox-pr-wide.png'});
  await page.getByRole('button',{name:'下一页 PR'}).click();await expect(page.getByRole('heading',{name:'此分支当前页没有开放 PR'})).toBeVisible();await expect(page.locator('.issue-detail-panel')).toHaveCount(0);
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-pr-empty.png'});
});
test('disconnected project has one compact connection state',async({page})=>{
  await setup(page,[],false);await page.goto('/issues');await expect(page.getByRole('heading',{name:'连接项目后，再开始审阅'})).toBeVisible();await expect(page.locator('.issue-detail-panel')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'连接 GitHub 项目',exact:true})).toHaveAttribute('href','/projects');
});

test('failed reads are not empty success; batch analysis respects the filtered page',async({page})=>{
  await setup(page,issues);let fail=true;let numbers:number[]=[];
  await page.route('**/api/workbench/items**',r=>r.fulfill(fail?{status:502,json:{error:'GitHub 请求失败（502）'}}:{json:{items:issues}}));
  await page.route('**/api/workbench/triage',r=>{numbers=r.request().postDataJSON().numbers;return r.fulfill({json:{triages:[],errors:[]}});});
  await page.goto('/issues');await showList(page,'Issue');await expect(page.getByRole('heading',{name:'数据暂时无法读取'})).toBeVisible();await expect(page.getByRole('heading',{name:'当前页没有开放 Issue'})).toHaveCount(0);
  fail=false;await page.getByRole('button',{name:'刷新 Issue',exact:true}).click();await expect(page.locator('.inbox-row')).toHaveCount(3);
  await page.getByRole('textbox',{name:'搜索 Issue'}).fill('delimiter');
  await page.getByRole('button',{name:/分诊当前筛选/}).click();await expect.poll(()=>numbers).toEqual([39]);
  await page.getByRole('button',{name:'清除筛选'}).click();await page.getByRole('button',{name:'切换到夜晚模式'}).click();
  await page.locator('.review-page').screenshot({path:'output/playwright/inbox-issues-dark.png'});await noOverflow(page);
});
