import { test, expect, type Page } from './fixtures';
import type { ProjectActivity } from '../../src/contracts/activity';

const project = { repoUrl: 'https://github.com/example/activity', fullName: 'example/activity', branch: 'main', updatedAt: '2026-10-21T09:00:00Z' };
const base: ProjectActivity = { scope: 'test-account-project', repoUrl: project.repoUrl, branch: 'main', modelConfigured: false, workerOnline: true, sandboxConfigured: false, reproductionWorkerOnline: false, items: [
  { id: 'task:1', revision: 'review-v1', title: 'Issue #42 · 方案等待审阅', detail: '核对原文和候选后确认。', state: 'review', href: '/issues?number=42', action: '继续处理', updatedAt: project.updatedAt },
  { id: 'audit:1', revision: 'complete-v1', title: '项目体检已完成', detail: '查看报告依据。', state: 'complete', href: '/audit?run=fixture', action: '查看报告', updatedAt: project.updatedAt },
] };
async function mock(page: Page, activity: () => ProjectActivity) {
  const writes: string[] = [];
  await page.route('**/api/workbench', route => route.fulfill({ json: { project, runs: [], drafts: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 }, github: null } }));
  await page.route('**/api/workbench/overview', route => route.fulfill({ json: { project, report: null, latestRun: null, history: [], draftCount: 0, journey: null } }));
  await page.route('**/api/workbench/activity', route => route.fulfill({ json: activity() }));
  await page.route('**/api/models', route => { if (route.request().method() !== 'GET') writes.push('models'); return route.fulfill({ json: { connections: [], defaultId: null, environmentConfigured: false, recentFailures: [] } }); });
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  return writes;
}

for (const width of [1440, 390]) test(`activity is actionable and readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  const writes = await mock(page, () => base);
  await page.goto('/overview');
  const panel = page.getByRole('region', { name: '接下来，处理这些事' });
  await expect(panel.getByRole('link', { name: /Issue #42/ })).toHaveAttribute('href', '/issues?number=42');
  await panel.getByRole('button', { name: /已有结果/ }).click();
  await expect(panel.getByRole('link', { name: /项目体检已完成/ })).toBeVisible();
  await panel.getByRole('button', { name: /待处理/ }).click();
  await expect(panel.getByRole('link', { name: /项目体检已完成/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath(`activity-${width}.png`) });
  await panel.getByRole('link', { name: /配置模型/ }).click();
  await expect(page.getByRole('button', { name: /^模型连接/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: '← 返回原任务' })).toHaveAttribute('href', '/overview');
  await page.getByRole('link', { name: '← 返回原任务' }).click();
  await expect(panel).toBeVisible();
  expect(writes).toEqual([]);
});

test('read status survives reload and meaningful state changes become unread', async ({ page }) => {
  let state = structuredClone(base);
  await mock(page, () => state);
  await page.goto('/overview');
  await expect(page.getByRole('button', { name: '查看通知，2 条未读' })).toBeVisible();
  await page.getByRole('button', { name: '查看通知，2 条未读' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /Issue #42/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('region', { name: '接下来，处理这些事' }).getByRole('link', { name: /Issue #42/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看通知', exact: true })).toBeVisible();
  state = { ...state, items: [{ ...state.items[0], revision: 'blocked-v2', state: 'attention', title: 'Issue #42 · 环境受阻' }, state.items[1]] };
  await page.getByRole('region', { name: '接下来，处理这些事' }).getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看通知，1 条未读' })).toBeVisible();
  await page.getByRole('button', { name: '查看通知，1 条未读' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /环境受阻/ })).toHaveAttribute('href', '/issues?number=42');
});

test('empty notifications have no unread dot and guide links directly to the manual', async ({ page }) => {
  await mock(page, () => ({ ...base, items: [] }));
  await page.goto('/overview');
  const bell = page.getByRole('button', { name: '查看通知', exact: true });
  await expect(bell.locator('span')).toHaveCount(0);
  await bell.click();
  await expect(page.getByText('暂无任务动态', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '使用指南', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { name: 'RepoCare 产品文档', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/settings?section=plugins&returnTo=https%3A%2F%2Fexample.com');
  await expect(page.getByRole('heading', { name: '已集成的维护能力' })).toBeVisible();
  await expect(page.getByRole('link', { name: '← 返回原任务' })).toHaveCount(0);
  await expect(page.locator('.sv-plugin-list').getByRole('switch')).toHaveCount(0);
});
