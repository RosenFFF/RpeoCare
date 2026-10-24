import { test, expect, type Page } from './fixtures';
import type { RepositoryBranch } from '../../src/contracts/branches';

const project = { repoUrl: 'https://github.com/example/branch-kit', fullName: 'example/branch-kit', branch: 'main' };
const longName = 'copilot/fix-test-failures-and-mypy-errors-with-preserved-empty-input-behavior';
const branches: RepositoryBranch[] = [
  { name: 'main', protected: true, commitSha: 'a'.repeat(40) },
  { name: longName, protected: false, commitSha: 'b'.repeat(40) },
  { name: 'fix/commit-not-returned', protected: false },
  { name: 'release/stable', protected: true, commitSha: 'c'.repeat(40) },
  ...['gh-pages', 'docs/notebook-setup', 'fix/maclaurin-series', 'dependabot/uv/lxml-6.1.0', 'feature/csv-export', 'fix/reader', 'refactor/graph-traversal', 'docs/contributing', 'maintenance/typing'].map((name, index) => ({ name, protected: false, commitSha: String(index + 1).repeat(40) })),
];

async function setup(page: Page) {
  const requests = { bases: [] as string[], reviewReads: 0, writes: 0 };
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

for (const width of [1440, 390]) test(`PR page opens the default branch and switches from the compact selector at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const requests = await setup(page);
  await page.goto('/pull-requests');
  await expect.poll(() => requests.bases).toEqual(['main']);
  const trigger = page.getByRole('button', { name: /^目标分支 main/ });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('heading', { name: '此分支当前页没有开放 PR' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.locator('.review-page').screenshot({ path: testInfo.outputPath(`branch-switcher-${width}.png`) });

  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '切换目标分支' });
  const search = page.getByRole('textbox', { name: '搜索已加载的分支' });
  await expect(search).toBeFocused();
  await expect(dialog.getByRole('button', { name: /^切换到 / })).toHaveCount(branches.length);
  await expect(dialog.getByRole('button', { name: /^切换到 / }).first()).toHaveAccessibleName(/^切换到 main 分支，默认分支，受保护/);
  await expect(dialog.getByRole('button', { name: `切换到 ${longName} 分支`, exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.locator('.review-page').screenshot({ path: testInfo.outputPath(`branch-switcher-open-${width}.png`) });

  await search.fill('release/stable');
  await expect(dialog.getByRole('button', { name: /^切换到 / })).toHaveCount(1);
  await dialog.getByRole('button', { name: /^切换到 release\/stable 分支/ }).click();
  await expect.poll(() => requests.bases).toEqual(['main', 'release/stable']);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^目标分支 release\/stable/ })).toBeFocused();
  expect(requests.reviewReads).toBe(0);
  expect(requests.writes).toBe(0);
});

test('branch selector closes with Escape and reports unmatched searches', async ({ page }) => {
  const requests = await setup(page);
  await page.goto('/pull-requests');
  const trigger = page.getByRole('button', { name: /^目标分支 main/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '切换目标分支' });
  await page.getByRole('textbox', { name: '搜索已加载的分支' }).fill('no-such-branch');
  await expect(dialog).toContainText('没有匹配的分支');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(requests.bases).toEqual(['main']);
});
