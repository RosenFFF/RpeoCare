import { test, expect, type Page } from './fixtures';
import type { Draft } from '../../src/contracts/workbench';

const project = { repoUrl: 'https://github.com/example/drafts', fullName: 'example/drafts', branch: 'main' };
const draft = (id: string, changes: Partial<Draft> = {}): Draft => ({ id, repoUrl: project.repoUrl, kind: 'issue', number: 42, title: 'Clarify reproduction steps', baseSha: '', before: '', content: 'Please share the failing input.', revision: 1, status: 'draft', createdAt: '2026-10-22T10:00:00Z', ...changes });
async function setup(page: Page, initial: Draft[], canWrite = true) {
  const state = { rows: structuredClone(initial), fail: false, conflict: false, uncertain: false, actions: [] as string[], queries: [] as string[] };
  await page.route('**/api/workbench', r => r.fulfill({ json: { project, runs: [], drafts: [], github: { login: 'fixture', canWrite }, usage: {} } }));
  await page.route('**/api/workbench/activity', r => r.fulfill({ json: { scope: 'draft-test', repoUrl: project.repoUrl, branch: 'main', items: [], modelConfigured: true } }));
  await page.route('**/api/workbench/agent**', r => r.fulfill({ json: { tasks: [], memories: [], jobs: [], workerOnline: false } }));
  await page.route('**/api/workbench/drafts**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); state.actions.push(body.action);
      const row = state.rows.find(row => row.id === body.id) || state.rows[0];
      if (body.action === 'edit' && state.conflict) return route.fulfill({ status: 409, json: { error: '草稿版本已变化，请重新审阅。' } });
      if (body.action === 'edit') { row.content = body.content; row.revision++; }
      if (body.action === 'publish' && state.uncertain) { row.status = 'uncertain'; return route.fulfill({ status: 400, json: { error: '发布结果待核对，已停止重复发布。' } }); }
      return route.fulfill({ json: { draft: row } });
    }
    if (state.fail) return route.fulfill({ status: 500, json: { error: '读取服务暂不可用' } });
    const id = url.searchParams.get('id');
    if (id) { const row = state.rows.find(row => row.id === id); return route.fulfill({ json: { draft: row, versions: row ? [row] : [] } }); }
    const q = url.searchParams.get('q') || ''; state.queries.push(q);
    const category = url.searchParams.get('category');
    const rows = state.rows.filter(row => (category === 'all' || row.kind === category) && (!q || row.title.includes(q)));
    return route.fulfill({ json: { drafts: rows, report: null, total: rows.length, projectTotal: state.rows.length, offset: 0, hasNext: false, siblingCounts: {} } });
  });
  return state;
}

for (const width of [1440, 390]) test(`draft empty state follows category at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 }); const state = await setup(page, []);
  await page.goto('/improvements');
  await page.getByRole('button', { name: 'Issue 回复', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先选择一条 Issue，准备有依据的回复' })).toBeVisible();
  await expect(page.locator('.draft-generation-entry')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '去 Issue 准备回复' })).toHaveAttribute('href', '/issues');
  await expect(page.locator('.draft-pagination')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`draft-empty-${width}.png`) }); expect(state.actions).toEqual([]);
});

test('draft loading errors do not pretend the project is empty; retry restores it', async ({ page }) => {
  const state = await setup(page, []); state.fail = true; await page.goto('/improvements');
  await expect(page.locator('.draft-center').getByRole('alert')).toContainText('读取服务暂不可用');
  await expect(page.locator('.draft-empty')).toHaveCount(0);
  state.fail = false; await page.getByRole('button', { name: '重试读取' }).click();
  await expect(page.getByRole('heading', { name: '从一个具体问题，准备第一份草稿' })).toBeVisible();
});

test('draft editing survives switching and conflicts; authorization returns to this draft', async ({ page }) => {
  const state = await setup(page, [draft('one'), draft('two', { number: 43, title: 'Another reply' })], false);
  await page.goto('/improvements?draft=one');
  await expect(page.getByRole('link', { name: '设置 GitHub 授权并返回' })).toHaveAttribute('href', '/settings?section=github&returnTo=%2Fimprovements%3Fdraft%3Done');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('编辑草稿内容').fill('My reviewed reply');
  await page.getByLabel('切换草稿').selectOption('two');
  await page.getByLabel('切换草稿').selectOption('one');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('编辑草稿内容')).toHaveValue('My reviewed reply');
  state.conflict = true; await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.draft-center').getByRole('alert')).toContainText('草稿版本已变化');
  await expect(page.getByLabel('编辑草稿内容')).toHaveValue('My reviewed reply');
  await expect(page.getByRole('button', { name: '发布 Issue 回复', exact: true })).toBeDisabled();
  expect(state.actions).toEqual(['edit']);
});

test('publication requires confirmation and uncertain result cannot be resubmitted', async ({ page }) => {
  const state = await setup(page, [draft('one')]); state.uncertain = true;
  await page.goto('/improvements?draft=one');
  await page.getByRole('button', { name: '发布 Issue 回复', exact: true }).click();
  const confirm = page.getByRole('region', { name: '发布确认' });
  await expect(confirm.getByRole('button', { name: '确认发布 Issue 回复' })).toBeDisabled();
  expect(state.actions).toEqual([]);
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: '确认发布 Issue 回复' }).click();
  await expect(page.locator('.draft-delivery-readiness')).toContainText('发布结果待核对');
  await expect(page.getByRole('button', { name: '发布 Issue 回复', exact: true })).toBeDisabled();
  expect(state.actions).toEqual(['publish']);
});

test('incompatible batch is blocked before confirmation; search preserves typing focus', async ({ page }) => {
  const state = await setup(page, [draft('one', { kind: 'file', path: 'README.md', branch: 'main', baseSha: 'a'.repeat(40) }), draft('two', { kind: 'file', path: 'CONTRIBUTING.md', branch: 'dev', baseSha: 'a'.repeat(40), title: 'Second file' })]);
  await page.goto('/improvements');
  await page.getByRole('checkbox', { name: /^选择 README.md/ }).check();
  await page.getByRole('checkbox', { name: /^选择 CONTRIBUTING.md/ }).check();
  await page.getByRole('button', { name: '审阅并创建一个草稿 PR' }).click();
  await expect(page.locator('.draft-center').getByRole('alert')).toContainText('同分支、同基准');
  await expect(page.getByRole('region', { name: '发布确认' })).toHaveCount(0);
  await page.getByLabel('搜索项目草稿').fill('Second');
  await expect.poll(() => state.queries.includes('Second')).toBe(true);
  await expect(page.getByLabel('搜索项目草稿')).toBeFocused();
  await expect(page.locator('.draft-list .draft-row')).toHaveCount(1);
  expect(state.actions).toEqual([]);
});
