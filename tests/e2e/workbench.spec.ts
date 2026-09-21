import { test, expect } from '@playwright/test';

test('report hides inspector and composer; conversation restores them', async ({ page }) => {
  await page.goto('/audit?new=1');
  await expect(page.getByRole('button', { name: '体检报告', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '体检报告', exact: true }).click();
  await expect(page.locator('.as-inspector-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.as-composer')).toHaveCount(0);
  await page.getByRole('button', { name: '任务对话', exact: true }).click();
  await expect(page.locator('.as-composer')).toBeVisible();
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
