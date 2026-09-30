import { test, expect } from '@playwright/test';

test('report hides inspector and all input composers', async ({ page }) => {
  await page.goto('/audit?new=1');
  await expect(page.getByRole('button', { name: '体检报告', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '体检报告', exact: true }).click();
  await expect(page.locator('.as-inspector-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.as-composer')).toHaveCount(0);
  const hasReport = await page.locator('.aw-report').count() > 0;
  await page.getByRole('button', { name: '任务对话', exact: true }).click();
  await expect(page.locator('.as-composer')).toHaveCount(hasReport ? 0 : 1);
  await expect(page.locator('.wb-chat')).toHaveCount(0);
  await expect(page.locator('.as-inspector-shell')).not.toHaveAttribute('inert', '');
});
const report = {
  runId: 'test-report', repository: { owner: 'example', name: 'real-project', fullName: 'example/real-project', url: 'https://github.com/example/real-project', branch: 'main', sha: 'a'.repeat(40), description: 'Real report fixture', language: 'TypeScript' },
  generatedAt: '2026-09-21T00:00:00Z', agentStatus: 'disabled', warnings: [], scope: 'rules',
  checks: [{ id: 'readme', title: 'README', category: '文档', status: 'needs_attention', summary: '补充使用说明', evidence: [], source: 'rule' }],
};
const completedOverview = { project: { repoUrl: report.repository.url, fullName: report.repository.fullName }, report, latestRun: { id: report.runId, status: 'completed' }, draftCount: 0 };

test('first entry opens audit; empty overview has no demonstration values', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/audit\?new=1/);
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: '先完成一次项目体检。' })).toBeVisible();
  await expect(page.getByRole('region', { name: '项目维护地图' })).toHaveCount(0);
  await expect(page.getByText('csv-kit', { exact: true })).toHaveCount(0);
});
test('overview keeps 3d and uses report data; unavailable counts do not become zero', async ({ page }) => {
  await page.route('**/api/workbench/overview', route => route.fulfill({ json: completedOverview }));
  await page.route('**/api/workbench/counts', route => route.fulfill({ json: { repoUrl: report.repository.url, issues: null, pulls: 0, fetchedAt: report.generatedAt } }));
  await page.goto('/overview');
  await expect(page.getByRole('region', { name: '项目维护地图' })).toBeVisible();
  await expect(page.getByText('3D 交互', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看项目体检', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.care-intro')).toContainText('example/real-project');
  await expect(page.locator('.metric').filter({ hasText: 'Issue 分诊' })).toContainText('暂时无法读取');
  await expect(page.locator('.metric').filter({ hasText: 'PR 检查' })).toContainText('0');
  await page.getByRole('button', { name: '查看Issue 分诊', exact: true }).click();
  await expect(page.locator('.care-detail-number')).toContainText('暂不可用');
});
test('overview updates after first completion and preserves report after retry failure', async ({ page }) => {
  let state: object = { ...completedOverview, report: null, latestRun: { id: 'first-run', status: 'running' } };
  await page.route('**/api/workbench/overview', route => route.fulfill({ json: state }));
  await page.route('**/api/workbench/counts', route => route.fulfill({ json: { repoUrl: report.repository.url, issues: 2, pulls: 1 } }));
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: '项目体检正在进行中。' })).toBeVisible();
  state = completedOverview;
  await expect(page.getByRole('region', { name: '项目维护地图' })).toBeVisible({ timeout: 15000 });
  state = { ...completedOverview, latestRun: { id: 'retry', status: 'failed', error: 'network' } };
  await expect(page.getByText('最新体检未完成，已保留上一份成功报告。')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('region', { name: '项目维护地图' })).toBeVisible();
});



test('issue triage shows readiness and maintainer review controls', async ({ page }) => {
  const project = { repoUrl: 'https://github.com/example/real-project', fullName: 'example/real-project', branch: 'main', updatedAt: '2026-09-30T00:00:00Z' };
  const issue = { number: 238, title: 'Submit button returns 500', body: 'Open /login, enter valid credentials, and click submit. The request returns 500.', url: 'https://github.com/example/real-project/issues/238', state: 'open', author: 'reporter', updatedAt: '2026-09-30T00:00:00Z', labels: ['bug'], commentCount: 1, assignees: [], milestone: null, comments: [] };
  const triage = { repoUrl: project.repoUrl, number: 238, sourceUpdatedAt: issue.updatedAt, category: 'bug', priority: 'medium', confidence: 'high', needsMoreInfo: false, language: 'English', titleZh: '提交按钮返回 500', summaryZh: '具备基本复现信息。', bodyZh: '点击提交后返回错误。', actualBehavior: '返回 500', expectedBehavior: '提交成功', environment: 'Node.js 24、Chrome', providedInformation: ['页面和操作步骤'], missingInformation: [], suggestedLabels: ['bug'], suggestedAction: 'investigate', workflowStatus: 'ready-to-reproduce', readinessScore: 85, readinessLevel: 'ready', readinessBlockers: [], rationale: ['已识别实际行为', '已识别预期行为'], commentsZh: [], analyzedAt: issue.updatedAt };
  await page.route('**/api/workbench', route => route.fulfill({ json: { project, runs: [], drafts: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 }, github: null } }));
  await page.route('**/api/workbench/items**', route => route.fulfill({ json: route.request().url().includes('number=238') ? { item: { ...issue, triage } } : { items: [{ ...issue, triage }] } }));
  await page.route('**/api/workbench/reproduction?number=238', route => route.fulfill({ json: { jobs: [], workerOnline: true, sandboxConfigured: true } }));
  await page.goto('/issues');
  await page.getByRole('button', { name: /#238 Submit button returns 500/ }).click();
  await expect(page.getByText('处理准备度', { exact: true })).toBeVisible();
  await expect(page.getByText('85', { exact: true })).toBeVisible();
  await expect(page.locator('.issue-readiness-card').getByRole('button', { name: '生成复现方案', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '维护者确认' })).toBeVisible();
  await expect(page.getByText('待确认', { exact: true })).toBeVisible();
});

test('issue focus mode expands details and presents an auditable reproduction plan', async ({ page }) => {
  const project = { repoUrl: 'https://github.com/example/real-project', fullName: 'example/real-project', branch: 'main', updatedAt: '2026-09-29T00:00:00Z' };
  const issue = { number: 237, title: 'Submit button crashes', body: 'Clicking submit shows an internal error.', url: 'https://github.com/example/real-project/issues/237', state: 'open', author: 'reporter', updatedAt: '2026-09-29T00:00:00Z', labels: ['bug'], commentCount: 0, assignees: [], milestone: null, comments: [] };
  const reproduction = {
    id: '201f6725-abef-4527-aacb-aaa22df1117d', repoUrl: project.repoUrl, branch: 'main', issueNumber: 237,
    sourceUpdatedAt: issue.updatedAt, status: 'awaiting-confirmation', attempts: 0, successfulAttempts: 0, attemptHistory: [], artifacts: [],
    createdAt: issue.updatedAt, updatedAt: issue.updatedAt,
    plan: {
      mode: 'browser', confidence: 'medium', summary: '启动本地应用，点击提交按钮并捕获可见错误。',
      environment: { language: 'TypeScript', dependencies: ['npm lockfile'] },
      setup: [{ type: 'run-command', command: 'npm ci' }, { type: 'run-command', command: 'npm run dev', background: true }],
      steps: [{ type: 'goto', target: 'http://127.0.0.1:3000/login' }, { type: 'click', target: 'role=button[name=提交]' }, { type: 'expect', target: 'text=Internal Server Error', expected: 'Internal Server Error' }],
      oracle: { type: 'selector-visible', value: 'text=Internal Server Error' }, expected: '错误信息可见', evidence: ['screenshot', 'trace', 'console'], risks: ['需要安装依赖'], missingInformation: [], requiresHumanApproval: true,
    },
  };
  await page.route('**/api/workbench', route => route.fulfill({ json: { project, runs: [], drafts: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 }, github: null } }));
  await page.route('**/api/workbench/items**', route => route.fulfill({ json: route.request().url().includes('number=237') ? { item: issue } : { items: [issue] } }));
  await page.route('**/api/workbench/reproduction?number=237', route => route.fulfill({ json: { jobs: [reproduction], workerOnline: true } }));
  await page.goto('/issues');
  await page.getByRole('button', { name: /#237 Submit button crashes/ }).click();
  await expect(page.locator('.issue-content-grid')).toHaveClass(/is-focused/);
  await expect(page.locator('.issue-list-panel')).toHaveAttribute('inert', '');
  await expect(page.getByRole('heading', { name: 'Bug 复现实验' })).toBeVisible();
  await expect(page.getByText('机器判据', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /确认隔离执行/ })).toBeVisible();
  await page.getByRole('button', { name: /显示 Issue 列表/ }).click();
  await expect(page.locator('.issue-content-grid')).not.toHaveClass(/is-focused/);
});
