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
