import { test, expect, type Page } from './fixtures';
import type { RepositoryBranch } from '../../src/contracts/branches';

const project = { repoUrl: 'https://github.com/example/branch-kit', fullName: 'example/branch-kit', branch: 'main' };
const longName = 'copilot/fix-test-failures-and-mypy-errors-with-preserved-empty-input-behavior';
const unknownName = 'fix/commit-not-returned';
const branches: RepositoryBranch[] = [
  { name: 'main', protected: true, commitSha: 'a'.repeat(40) },
  { name: longName, protected: false, commitSha: 'b'.repeat(40) },
  { name: unknownName, protected: false },
  { name: 'release/stable', protected: true, commitSha: 'c'.repeat(40) },
  ...['gh-pages', 'docs/notebook-setup', 'fix/maclaurin-series', 'dependabot/uv/lxml-6.1.0', 'feature/csv-export', 'fix/reader', 'refactor/graph-traversal', 'docs/contributing', 'maintenance/typing'].map((name, index) => ({ name, protected: false, commitSha: String(index + 1).repeat(40) })),
];

async function setup(page: Page, clipboardFails = false) {
  const requests = { bases: [] as string[], reviewReads: 0, writes: 0 };
  await page.addInitScript(fails => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => {
        if (fails) throw new DOMException('Clipboard unavailable', 'NotAllowedError');
        (window as Window & { copiedBranch?: string }).copiedBranch = value;
      },
    } });
  }, clipboardFails);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/workbench', route => route.fulfill({ json: { project, runs: [], drafts: [], github: null, usage: {} } }));
  await page.route('**/api/workbench/branches**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { repoUrl: project.repoUrl, page: Number(url.searchParams.get('page') || 1), defaultBranch: 'main', branches, hasNext: false } });
  });
  await page.route('**/api/workbench/items**', route => {
    const url = new URL(route.request().url());
    const base = url.searchParams.get('base');
    if (base) requests.bases.push(base);
    if (route.request().method() !== 'GET') requests.writes++;
    return route.fulfill({ json: { items: [], repoUrl: project.repoUrl, base, hasNext: false } });
  });
  await page.route('**/api/workbench/review**', route => {
    if (route.request().method() === 'GET') requests.reviewReads++;
    else requests.writes++;
    return route.fulfill({ json: { review: null } });
  });
  await page.route('**/api/workbench/reproduction**', route => route.fulfill({ json: { jobs: [], workerOnline: false, sandboxConfigured: false } }));
  return requests;
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

for (const width of [1440, 390]) test(`branch map keeps full details and direct PR navigation at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const requests = await setup(page);
  await page.goto('/pull-requests');
  const details = page.locator('[aria-label="选中分支详情"]');
  await expect(page.getByRole('button', { name: /^查看 .+ 分支详情$/ })).toHaveCount(13);
  await expect(details).toContainText('main');
  await expect(details).toContainText('a'.repeat(40));
  await expect(page.locator('.branch-portal-regular').filter({ hasText: '普通分支' })).toHaveCount(0);
  await noHorizontalOverflow(page);
  if (width === 390) await expect.poll(() => page.locator('.branch-orbit-space').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.locator('.review-page').screenshot({ path: testInfo.outputPath(`branch-map-${width}.png`) });

  const longBranch = page.getByRole('button', { name: `查看 ${longName} 分支详情`, exact: true });
  await longBranch.click();
  await expect(details).toContainText(longName);
  await expect(details).toContainText('b'.repeat(40));
  await details.getByRole('button', { name: '复制分支名', exact: true }).click();
  await expect(details).toContainText('已复制');
  await expect.poll(() => page.evaluate(() => (window as Window & { copiedBranch?: string }).copiedBranch)).toBe(longName);
  expect(requests.bases).toEqual([]);
  expect(requests.reviewReads).toBe(0);
  expect(requests.writes).toBe(0);
  await noHorizontalOverflow(page);
  await page.locator('.review-page').screenshot({ path: testInfo.outputPath(`branch-selected-${width}.png`) });

  const search = page.getByRole('textbox', { name: '搜索已加载的分支' });
  await search.fill('release/stable');
  await expect(details).toContainText('release/stable');
  await expect(details).not.toContainText(longName);
  await page.getByRole('button', { name: /^展开 release\/stable 分支的开放 PR/ }).click();
  await expect.poll(() => requests.bases).toEqual(['release/stable']);
  await expect(page.getByRole('heading', { name: '此分支当前页没有开放 PR' })).toBeVisible();
  expect(requests.reviewReads).toBe(0);
  expect(requests.writes).toBe(0);
});

test('branch details follow keyboard focus and explain unavailable clipboard and commit', async ({ page }) => {
  await setup(page, true);
  await page.goto('/pull-requests');
  const details = page.locator('[aria-label="选中分支详情"]');
  const target = page.getByRole('button', { name: `查看 ${unknownName} 分支详情`, exact: true });
  await target.focus();
  await expect(target).toBeFocused();
  await expect(details).toContainText(unknownName);
  await expect(details).toContainText('未知');
  await details.getByRole('button', { name: '复制分支名', exact: true }).click();
  await expect(details).toContainText(/无法复制|复制失败|手动复制/);
  await expect(details).not.toContainText('已复制');
});
