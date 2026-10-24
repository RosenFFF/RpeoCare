import { test, expect } from '@playwright/test';
import { docChapters, docHref } from '../../src/features/product-docs/catalog';

test('manual chapters and contents work without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const chapter of docChapters) {
    const response = await page.goto(`http://127.0.0.1:3100${docHref(chapter.slug)}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(chapter.title);
    await expect(page.locator('article')).not.toContainText('**');
    await expect(page.getByRole('navigation', { name: '文档章节' }).locator('[aria-current=page]')).toHaveText(chapter.title);
    for (const href of await page.getByRole('navigation', { name: '本页目录' }).locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')!))) {
      await expect(page.locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
    }
    expect(await page.locator('article a[href$=".md"]').count()).toBe(chapter.slug === 'reference' ? 8 : 0);
  }
  await page.getByRole('navigation', { name: '文档章节' }).getByRole('link', { name: '快速开始', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/quickstart$/);
  const missing = await page.goto('http://127.0.0.1:3100/docs/nonexistent-chapter');
  expect(missing?.status()).toBe(404);
  await context.close();
});

for (const width of [390, 1440]) {
  test(`documentation is readable at ${width}px without workspace requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
    await page.goto('/docs');
    await page.locator('article').getByRole('link', { name: '部署与运维', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('部署与运维');
    await page.getByRole('navigation', { name: '本页目录' }).getByRole('link', { name: '备份与恢复' }).click();
    await expect(page.getByRole('heading', { name: '备份与恢复', exact: true })).toBeInViewport();
    await page.goto('/docs/configuration');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`product-docs-${width}.png`), fullPage: true });
    expect(apiRequests).toEqual([]);
  });
}

for (const width of [320, 390, 600, 1440]) {
  test(`login header opens the manual at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    const docs = page.getByRole('navigation', { name: '首页导航' }).getByRole('link', { name: '产品文档', exact: true });
    await expect(docs).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('.entry-header').screenshot({ path: testInfo.outputPath(`login-header-${width}.png`) });
    await docs.click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page.getByRole('heading', { name: 'RepoCare 产品文档', exact: true })).toBeVisible();
  });
}

test('mobile workspace guide opens docs and releases navigation scroll lock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route('**/api/workbench', route => route.fulfill({ json: { project: null, runs: [], drafts: [], github: null, usage: {} } }));
  await page.goto('/overview');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('link', { name: '使用指南', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
