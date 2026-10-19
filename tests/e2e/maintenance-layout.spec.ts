import { test, expect, showList, type Page } from './fixtures';
import type { AgentWorkspaceData, MaintenanceTask } from '../../src/contracts/agent';
import type { VerificationContext } from '../../src/contracts/maintenance-verification';
import type { GitItem, Project, ReproductionJob, ReproductionPlan } from '../../src/contracts/workbench';

const sourceTime = '2026-10-19T00:00:00Z';
const sha = 'a'.repeat(40);
const project: Project = { repoUrl: 'https://github.com/example/layout-checks', fullName: 'example/layout-checks', branch: 'main', updatedAt: sourceTime };
const issue: GitItem = {
  number: 91, title: 'Preserve independent cache controls', body: 'Outer cache controls should preserve the inner cache and its counters.',
  url: `${project.repoUrl}/issues/91`, state: 'open', author: 'fixture-maintainer', updatedAt: sourceTime, labels: ['bug'], commentCount: 0,
};
const blocker = '尚未提供运行此计划所需的本地测试数据文件。';

function workspaceFixture(): AgentWorkspaceData {
  const context: VerificationContext = {
    baseSha: sha, sourceFingerprint: 'b'.repeat(64), pairId: 'layout-pair', patchId: 'layout-patch', fingerprint: 'c'.repeat(64),
    productionHash: 'd'.repeat(64), sharedTestsHash: 'e'.repeat(64), planHash: 'f'.repeat(64), patchedPlanHash: '1'.repeat(64),
    policyRevision: 0, sourceUpdatedAt: sourceTime, sharedTestPaths: ['tests/test_cache_controls.py'], regressionCommands: [],
    requirements: [
      { id: 'outer-cache', text: '外层缓存入口必须属于外层，连续调用仍返回相同结果，并保留内层缓存的独立状态。', quote: 'The outer cache must remain independent from the inner cache.', source: 'Issue 正文', command: 'python3 -m pytest tests/test_cache_controls.py::test_outer_cache_preserves_its_own_state -q', failureSignal: 'OUTER_CACHE_OVERWRITTEN', changedPaths: ['cache.py'] },
      { id: 'outer-clear', text: '清理外层缓存后，内层缓存内容与已有命中统计必须保持不变。', quote: 'Clearing the outer cache must leave the inner cache and its counters unchanged.', source: 'Issue 正文', command: 'python3 -m pytest tests/test_cache_controls.py::test_outer_clear_preserves_inner_cache_and_statistics -q', failureSignal: 'INNER_CACHE_CLEARED', changedPaths: ['cache.py'] },
    ],
  };
  const plan: ReproductionPlan = {
    mode: 'test', confidence: 'medium', summary: '核对两层缓存的独立状态与清理行为。',
    environment: { language: 'Python', version: '3.12', dependencies: ['pytest'] }, setup: [],
    steps: context.requirements.map(requirement => ({ type: 'run-test', command: requirement.command })),
    oracle: { type: 'all-steps-pass', value: 'true' }, expected: '所列命令全部通过', evidence: ['stdout', 'test-result'],
    risks: [], missingInformation: [blocker], requiresHumanApproval: true,
  };
  const jobs: ReproductionJob[] = (['baseline', 'patched'] as const).map(role => ({
    id: `layout-${role}`, repoUrl: project.repoUrl, branch: 'main', commitSha: sha, issueNumber: issue.number,
    sourceUpdatedAt: sourceTime, agentTaskId: 'layout-task', purpose: 'agent-verification', verificationRole: role, verification: context,
    preflightJobId: `layout-preflight-${role}`, plan, status: 'awaiting-confirmation', attempts: 0, successfulAttempts: 0,
    attemptHistory: [], artifacts: [], createdAt: sourceTime, updatedAt: sourceTime,
  }));
  const preflights: ReproductionJob[] = jobs.map(job => ({
    ...job, id: job.preflightJobId!, purpose: 'environment-preflight', preflightForJobId: job.id, preflightJobId: undefined,
    status: 'reproduced', preflight: {
      status: 'ready', checkedAt: new Date().toISOString(), planHash: context.planHash, commitSha: sha, runnerImageId: 'synthetic-layout-runner',
      runtime: { python: '3.12', pytest: '9.0' }, checks: [{ id: 'synthetic-runtime', status: 'pass', title: '布局测试环境记录', detail: '仅为页面 fixture，不执行预检或仓库代码。' }], limitations: [],
    },
  }));
  const task: MaintenanceTask = {
    id: 'layout-task', repoUrl: project.repoUrl, branch: 'main', commitSha: sha, kind: 'issue', number: issue.number, sourceUpdatedAt: sourceTime,
    goal: '核对缓存状态与清理行为。', status: 'awaiting-confirmation',
    model: { connectionId: 'synthetic-layout-model', name: '页面测试模型占位', provider: 'fixture', protocol: 'openai-completions', modelId: 'fixture-only', revision: 1, source: 'settings' },
    createdAt: sourceTime, updatedAt: sourceTime, plan: [], events: [], dialogue: [], evidence: [],
    budget: { turns: 0, tools: 0, maxTurns: 1, maxTools: 1, inputTokens: 0, outputTokens: 0, compactions: 0 },
    artifacts: [
      { id: 'layout-patch', kind: 'patch', title: '缓存状态候选', files: [{ path: 'cache.py', before: 'value = inner\n', after: 'value = outer\n' }], diff: '-value = inner\n+value = outer\n', evidenceIds: [], createdAt: sourceTime },
      { id: 'layout-verification', kind: 'verification', title: '缓存状态对照', patchId: 'layout-patch', verification: context, jobIds: jobs.map(job => job.id), evidenceIds: [], createdAt: sourceTime },
    ],
  };
  return { tasks: [task], task, memories: [], jobs: [...jobs, ...preflights], workerOnline: true, reproductionWorkerOnline: true, sandboxConfigured: true };
}

async function mockWorkspace(page: Page) {
  const workspace = workspaceFixture();
  const mutations: string[] = [];
  await page.route('**/api/workbench**', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') {
      mutations.push(url.pathname);
      return route.fulfill({ status: 409, json: { error: '布局测试不允许执行或模型请求。' } });
    }
    if (url.pathname === '/api/workbench/branches') return route.fallback();
    if (url.pathname === '/api/workbench') return route.fulfill({ json: { project, runs: [], drafts: [], github: null, usage: { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 } } });
    if (url.pathname === '/api/workbench/items') return route.fulfill({ json: url.searchParams.has('number') ? { item: issue } : { items: [issue], hasNext: false } });
    if (url.pathname === '/api/workbench/agent') return route.fulfill({ json: workspace });
    if (url.pathname === '/api/workbench/reproduction') return route.fulfill({ json: { jobs: [], workerOnline: true, sandboxConfigured: true } });
    return route.fulfill({ json: {} });
  });
  return mutations;
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`maintenance confirmation boxes preserve text and blockers at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mutations = await mockWorkspace(page);
    await page.goto('/issues');
    await showList(page, 'Issue');
    await page.getByRole('button', { name: /#91 Preserve independent cache controls/ }).click();
    const workspace = page.getByRole('region', { name: '修复与验证', exact: true });
    await expect(workspace.getByText('等待审阅', { exact: true })).toBeVisible();
    await workspace.locator('.ma-plan-review > summary').click();
    const plans = workspace.locator('.ma-execution-grid > .ma-execution');
    await expect(plans).toHaveCount(2);

    const boxes = workspace.locator('.ma-confirm input[type=checkbox], .ma-requirement-confirm input[type=checkbox]');
    await expect(boxes).toHaveCount(8);
    for (const box of await boxes.all()) {
      await expect(box).toBeVisible();
      const metrics = await box.evaluate(input => {
        const bounds = input.getBoundingClientRect(), label = input.closest('label')!;
        const labelBounds = label.getBoundingClientRect(), style = getComputedStyle(label);
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        const textRects: DOMRect[] = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          textRects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0));
        }
        return { width: bounds.width, height: bounds.height, textWidth: labelBounds.right - bounds.right,
          fontSize: parseFloat(style.fontSize), labelFits: label.scrollWidth <= label.clientWidth + 1,
          textFits: textRects.length > 0 && textRects.every(rect => rect.left >= labelBounds.left - 1 && rect.right <= labelBounds.right + 1) };
      });
      expect(metrics.width).toBeCloseTo(16, 1);
      expect(metrics.height).toBeCloseTo(16, 1);
      expect(metrics.textWidth).toBeGreaterThan(80);
      expect(metrics.fontSize).toBeGreaterThanOrEqual(11);
      expect(metrics.labelFits).toBe(true);
      expect(metrics.textFits).toBe(true);
    }

    for (const plan of await plans.all()) {
      const confirm = plan.getByRole('button', { name: '确认执行此计划', exact: true });
      await expect(confirm).toBeDisabled();
      const requirements = plan.locator('.ma-requirement-confirm input');
      await requirements.nth(0).focus();
      await requirements.nth(0).press('Space');
      await expect(requirements.nth(0)).toBeChecked();
      await requirements.nth(0).press('Tab');
      await expect(requirements.nth(1)).toBeFocused();
      await requirements.nth(1).press('Space');
      await expect(requirements.nth(1)).toBeChecked();
      const environment = plan.locator('.ma-confirm').filter({ hasText: '我已核对本次环境检查' }).getByRole('checkbox');
      await expect(environment).toBeEnabled();
      await environment.check();
      const consentLabel = plan.locator('.ma-confirm').filter({ hasText: '我已审阅此计划' });
      await consentLabel.click();
      await expect(consentLabel.getByRole('checkbox')).toBeChecked();
      await expect(plan.locator('.ma-readiness-blockers')).toContainText(blocker);
      await expect(confirm).toBeDisabled();
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(mutations).toEqual([]);
  });
}
