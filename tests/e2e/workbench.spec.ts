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
test('overview starts with honest empty real project state', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: '连接你的第一个项目' })).toBeVisible();
  await expect(page.getByLabel('GitHub 仓库地址')).toBeVisible();
  await expect(page.getByText('repocare-demo / csv-kit', { exact: true })).toHaveCount(0);
});
