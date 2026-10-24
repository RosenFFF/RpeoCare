import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ branchDirectory: void }>({
  branchDirectory: [async ({ page }, use) => {
    await page.route('**/api/workbench/branches**', route => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: { repoUrl: url.searchParams.get('repoUrl'), page: Number(url.searchParams.get('page') || 1),
        branches: [{ name: 'main', protected: false, commitSha: 'a'.repeat(40) }], defaultBranch: 'main', hasNext: false } });
    });
    await use();
  }, { auto: true }],
});

/** PR pages open the default branch automatically; wait for its selector before switching to the list. */
export async function showList(page: Page, kind: 'Issue' | 'PR') {
  if (kind === 'PR') await expect(page.getByRole('button', { name: /^目标分支 main/ })).toBeVisible();
  await page.getByRole('button', { name: `切换 ${kind} 列表`, exact: true }).click();
}

export { expect, type Page };
