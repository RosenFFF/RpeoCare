import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const planPath = process.env.REPRO_PLAN || '/input/plan.json';
const workspace = resolve(process.env.REPRO_WORKSPACE || '/workspace');
const artifacts = resolve(process.env.REPRO_ARTIFACTS || '/artifacts');
const phase = process.env.REPRO_PHASE || 'execution';
const maxMs = Math.max(10_000, Math.min(Number(process.env.REPRO_TIMEOUT_MS || 120_000), 300_000));
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const started = Date.now();
const output = { phase, stdout: '', stderr: '', console: [], network: [], steps: [], reproduced: false, summary: '' };
const background = [];
const totalSteps = plan.setup.length + plan.steps.length;
async function writeProgress(currentStep, currentStepLabel) {
  await writeFile(`${artifacts}/progress.json`, JSON.stringify({ phase, currentStep, totalSteps, currentStepLabel, updatedAt: new Date().toISOString() }), 'utf8').catch(() => {});
}
const allowedScripts = /^(?:test(?::[a-z0-9:_-]+)?|lint|typecheck|check|dev|start|serve)$/i;

function tokens(command) {
  if (/[;&|><`$\n\r]|\$\(|\.\.[\\/]|(?:^|\s)(?:sudo|su|ssh|scp|curl|wget|nc|ncat|powershell|cmd|bash|sh|docker|podman|kubectl)(?:\s|$)/i.test(command)) throw new Error('Unsafe command syntax.');
  const list = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(value => value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) || [];
  const executable = String(list[0] || '').toLowerCase();
  if (!['npm', 'npx', 'python', 'python3', 'pytest', 'go'].includes(executable)) throw new Error('Command is not allow-listed.');
  if (executable === 'npm') {
    const operation = String(list[1] || '').toLowerCase();
    if (!['ci', 'install', 'test', 'run'].includes(operation)) throw new Error('npm operation is not allow-listed.');
    if (operation === 'run' && !allowedScripts.test(list[2] || '')) throw new Error('npm script is not allow-listed.');
  }
  if (executable === 'npx' && !(list[1] === 'playwright' && list[2] === 'test')) throw new Error('npx only permits Playwright tests.');
  if (['python', 'python3'].includes(executable) && !(list[1] === '-m' && ['pytest', 'unittest'].includes(list[2] || ''))) throw new Error('Python only permits test modules.');
  if (executable === 'go' && list[1] !== 'test') throw new Error('Go only permits tests.');
  return list;
}
function isInstall(command) {
  const list = tokens(command);
  return list[0] === 'npm' && ['ci', 'install'].includes(list[1]);
}
function inside(relativePath) {
  if (!relativePath || relativePath.startsWith('/') || /^[a-z]:[\\/]/i.test(relativePath) || relativePath.includes('..') || relativePath.includes('\\')) throw new Error('Unsafe relative path.');
  const value = resolve(workspace, relativePath);
  if (!value.startsWith(`${workspace}/`)) throw new Error('Path escaped workspace.');
  return value;
}
function localUrl(target) {
  const url = new URL(target, 'http://127.0.0.1:3000');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Only sandbox-local URLs are permitted.');
  return url.toString();
}
function run(command, detached = false, dependencyInstall = false) {
  let [file, ...args] = tokens(command);
  if (file === 'npx') args = ['--no-install', ...args];
  if (dependencyInstall) args = [...args, '--ignore-scripts', '--no-audit', '--no-fund'];
  const child = spawn(file, args, { cwd: workspace, env: { ...process.env, HOME: '/tmp/repocare-home', CI: '1', NO_COLOR: '1', npm_config_update_notifier: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output.stdout = (output.stdout + chunk).slice(-1_000_000); });
  child.stderr.on('data', chunk => { output.stderr = (output.stderr + chunk).slice(-1_000_000); });
  if (detached) { background.push(child); return Promise.resolve({ code: 0, background: true }); }
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Command timed out.')); }, maxMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); accept({ code: code ?? 1 }); });
  });
}
async function waitFor(target) {
  const url = localUrl(target);
  const deadline = Date.now() + Math.min(maxMs, 45_000);
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.status < 500) return url; } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Local service did not become ready: ${url}`);
}
async function commandStep(step) {
  if (step.type === 'create-file') {
      const path = inside(step.path);
      // Repository files and earlier commands may create symlinks. Refuse every
      // symlink component before applying a reviewed replacement in the sandbox.
      let current = workspace;
      for (const part of step.path.split('/')) {
        current = resolve(current, part);
        try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Refusing to write through a repository symlink.'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, step.content || '', { encoding:'utf8', flag:'w' }); return { created: step.path };
  }
  if (step.type === 'run-command' || step.type === 'run-test') return run(step.command, Boolean(step.background));
  if (step.type === 'request') {
    const url = localUrl(step.target);
    const method = step.method || 'GET';
    const response = await fetch(url, { method, body: ['GET', 'DELETE'].includes(method) ? undefined : step.body, headers: step.body ? { 'content-type': 'application/json' } : undefined, signal: AbortSignal.timeout(15_000) });
    const body = (await response.text()).slice(0, 100_000);
    output.network.push({ url, method, status: response.status, body });
    return { status: response.status, body };
  }
  return {};
}
function locator(page, target) {
  if (!target) throw new Error('Browser selector is missing.');
  if (target.startsWith('role=')) {
    const match = target.match(/^role=([^[]+)(?:\[name=["']?(.*?)["']?\])?$/); if (!match) throw new Error('Invalid role selector.');
    return page.getByRole(match[1], match[2] ? { name: match[2] } : undefined);
  }
  if (target.startsWith('text=')) return page.getByText(target.slice(5), { exact: false });
  if (target.startsWith('testid=')) return page.getByTestId(target.slice(7));
  if (target.startsWith('css=')) return page.locator(target.slice(4));
  return page.locator(target);
}
async function browserSteps(steps, offset = 0) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ recordVideo: plan.evidence.includes('video') ? { dir: artifacts } : undefined });
  if (plan.evidence.includes('trace')) await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.on('console', message => output.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => output.console.push({ type: 'pageerror', text: error.message, stack: error.stack }));
  page.on('response', response => output.network.push({ url: response.url(), method: response.request().method(), status: response.status() }));
  try {
    for (const [index, step] of steps.entries()) {
      const currentStep = offset + index + 1;
      await writeProgress(currentStep, `正在执行：${step.command || step.target || step.path || step.type}`);
      let result = {};
      if (step.type === 'goto') { const url = await waitFor(step.target); await page.goto(url, { waitUntil: 'domcontentloaded' }); result = { url }; }
      else if (step.type === 'click') await locator(page, step.target).click();
      else if (step.type === 'fill') await locator(page, step.target).fill(step.value || '');
      else if (step.type === 'expect') {
        const item = locator(page, step.target); await item.waitFor({ state: 'visible' });
        if (step.expected && !(await item.innerText()).includes(step.expected)) throw new Error(`Expected text not found: ${step.expected}`);
      } else result = await commandStep(step);
      output.steps.push({ index, type: step.type, target: step.target, expected: step.expected, ...result, ok: true });
      await writeProgress(currentStep, `已完成：${step.command || step.target || step.path || step.type}`);
    }
    if (plan.evidence.includes('screenshot')) await page.screenshot({ path: `${artifacts}/screenshot.png`, fullPage: true });
    output.finalUrl = page.url();
  } finally {
    if (plan.evidence.includes('trace')) await context.tracing.stop({ path: `${artifacts}/trace.zip` }).catch(() => {});
    await context.close(); await browser.close();
  }
}
function observedOracle() {
  const value = String(plan.oracle.value);
  if (plan.oracle.type === 'exit-code') return output.steps.some(step => ['run-command', 'run-test'].includes(step.type) && !step.background && String(step.code) === value);
  if (plan.oracle.type === 'stdout-contains') return output.stdout.includes(value);
  if (plan.oracle.type === 'stderr-contains') return output.stderr.includes(value);
  if (plan.oracle.type === 'url-contains') return String(output.finalUrl || '').includes(value);
  if (plan.oracle.type === 'http-status') return output.network.some(item => String(item.status) === value);
  if (plan.oracle.type === 'selector-visible') return output.steps.some(step => step.type === 'expect' && step.ok && (!plan.oracle.value || step.target === plan.oracle.value));
  if (plan.oracle.type === 'all-steps-pass') {
    const executed = output.steps.filter(step => !step.background && !['create-file'].includes(step.type));
    return executed.length > 0 && executed.every(step => step.ok && (step.code === undefined || step.code === 0));
  }
  return false;
}

try {
  await mkdir(artifacts, { recursive: true });
  await writeProgress(0, phase === 'dependencies' ? '正在进入依赖准备阶段' : '正在进入隔离执行阶段');
  if (phase === 'dependencies') {
    const installs = plan.setup.filter(step => (step.type === 'run-command' || step.type === 'run-test') && isInstall(step.command));
    await writeProgress(0, installs.length ? '正在准备测试依赖' : '项目无需单独准备依赖');
    for (const [index, step] of installs.entries()) { const currentStep = index + 1; await writeProgress(currentStep, `正在安装依赖：${step.command}`); const result = await run(step.command, false, true); output.steps.push({ type: step.type, ...result, ok: result.code === 0 }); if (result.code !== 0) throw new Error('Dependency installation failed.'); await writeProgress(currentStep, `依赖准备完成：${step.command}`); }
    output.summary = installs.length ? 'Dependencies installed without lifecycle scripts.' : 'No dependency installation was required.';
  } else {
    await writeProgress(0, '正在启动隔离 Runner');
    for (const [index, step] of plan.setup.entries()) {
      if ((step.type === 'run-command' || step.type === 'run-test') && isInstall(step.command)) continue;
      const currentStep = index + 1;
      await writeProgress(currentStep, `正在准备：${step.command || step.target || step.path || step.type}`);
      const result = await commandStep(step); output.steps.push({ type: step.type, command: step.command, target: step.target, path: step.path, ...result, ok: result.code === undefined || result.code === 0 });
      await writeProgress(currentStep, `准备完成：${step.command || step.target || step.path || step.type}`);
    }
    if (plan.mode === 'browser') await browserSteps(plan.steps, plan.setup.length);
    else for (const [index, step] of plan.steps.entries()) { const currentStep = plan.setup.length + index + 1; await writeProgress(currentStep, `正在执行：${step.command || step.target || step.path || step.type}`); const result = await commandStep(step); output.steps.push({ index, type: step.type, command: step.command, target: step.target, path: step.path, ...result, ok: result.code === undefined || result.code === 0 }); await writeProgress(currentStep, `已完成：${step.command || step.target || step.path || step.type}`); }
    await writeProgress(totalSteps, '本次验证步骤已完成，正在判断机器判据');
    output.reproduced = observedOracle();
    output.summary = output.reproduced ? 'Observed the plan oracle.' : 'The plan completed without observing the oracle.';
  }
} catch (error) {
  output.error = error instanceof Error ? error.message : String(error);
  output.summary = phase === 'dependencies' ? 'Dependency preparation failed.' : 'The isolated attempt failed before the oracle could be evaluated.';
} finally {
  for (const child of background) child.kill('SIGTERM');
  output.durationMs = Date.now() - started;
  await writeFile(`${artifacts}/stdout.log`, output.stdout, 'utf8');
  await writeFile(`${artifacts}/stderr.log`, output.stderr, 'utf8');
  await writeFile(`${artifacts}/console.json`, JSON.stringify(output.console, null, 2), 'utf8');
  await writeFile(`${artifacts}/network.json`, JSON.stringify(output.network, null, 2), 'utf8');
  await writeFile(`${artifacts}/result.json`, JSON.stringify(output, null, 2), 'utf8');
}
process.exitCode = output.error ? 2 : 0;
