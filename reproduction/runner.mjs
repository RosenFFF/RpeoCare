import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { commandTokens as tokens, dependencyCommand as isInstall, pytestCommand } from './commands.mjs';

const planPath = process.env.REPRO_PLAN || '/input/plan.json';
const workspace = resolve(process.env.REPRO_WORKSPACE || '/workspace');
const artifacts = resolve(process.env.REPRO_ARTIFACTS || '/artifacts');
const phase = process.env.REPRO_PHASE || 'execution';
const maxMs = Math.max(10_000, Math.min(Number(process.env.REPRO_TIMEOUT_MS || 120_000), 300_000));
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const started = Date.now();
const output = { phase, stdout: '', stderr: '', console: [], network: [], steps: [], reproduced: false, summary: '', failureKind: undefined, environment: {} };
let workdir = workspace;
const background = [];
let dependencyInventory = {};
const totalSteps = plan.setup.length + plan.steps.length;
async function writeProgress(currentStep, currentStepLabel) {
  await writeFile(`${artifacts}/progress.json`, JSON.stringify({ phase, currentStep, totalSteps, currentStepLabel, updatedAt: new Date().toISOString() }), 'utf8').catch(() => {});
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
  if (dependencyInstall && file === 'npm') args = [...args, '--ignore-scripts', '--no-audit', '--no-fund'];
  const child = spawn(file, args, { cwd: workdir, env: { ...process.env, HOME: '/tmp/repocare-home', CI: '1', NO_COLOR: '1', PYTHONPATH: `${workdir}/src:${workdir}:${workdir}/.repocare-python`, PYTHONDONTWRITEBYTECODE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', npm_config_update_notifier: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-6000); output.stdout = (output.stdout + chunk).slice(-1_000_000); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); output.stderr = (output.stderr + chunk).slice(-1_000_000); });
  if (detached) { background.push(child); return Promise.resolve({ code: 0, background: true }); }
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('Command timed out.'), { failureKind: 'timeout' })); }, Math.max(1, maxMs - (Date.now() - started)));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); const failureKind = code === 0 ? undefined : dependencyInstall ? 'dependencies' : /ModuleNotFoundError|ImportError:/.test(stdout + stderr) ? 'dependencies' : pytestCommand(command) ? code === 1 ? 'assertion' : [2, 3, 4, 5].includes(code) ? 'collection' : 'unknown' : 'unknown'; accept({ code: code ?? 1, stdout, stderr, failureKind }); });
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

function environmentSnapshot() {
  const python = spawnSync('python3', ['-I', '/opt/repocare/dependency-snapshot.py', resolve(workdir, '.repocare-python')], { encoding: 'utf8', timeout: 10000, maxBuffer: 500000, cwd: '/tmp' });
  if (python.status !== 0) return { node: process.versions.node, platform: process.platform, dependencies: 'unavailable' };
  const value = JSON.parse(python.stdout);
  dependencyInventory = value;
  return { node: process.versions.node, platform: process.platform, python: value.python, pytestDistribution: value.effectiveToolDistributions.pytest, dependencies: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

try {
  await mkdir(artifacts, { recursive: true });
  if (plan.workingDirectory && plan.workingDirectory !== '.') {
    workdir = inside(plan.workingDirectory);
    let current = workspace;
    for (const part of plan.workingDirectory.split('/')) { current = resolve(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Working directory cannot contain symlinks.'); }
    if (!(await lstat(workdir)).isDirectory()) throw new Error('Working directory is not a directory.');
  }
  output.environment = environmentSnapshot();
  if (phase === 'preflight') {
    const checked = spawnSync('python3', ['-I', '/opt/repocare/preflight.py'], { encoding: 'utf8', timeout: Math.min(maxMs, 30000), maxBuffer: 500000, cwd: '/tmp' });
    if (checked.status !== 0) throw Object.assign(new Error('Static environment inspection did not complete; repository code was not executed.'), { failureKind: 'setup' });
    const preflight = JSON.parse(checked.stdout);
    await writeFile(`${artifacts}/preflight.json`, JSON.stringify(preflight, null, 2), 'utf8');
    output.summary = 'Static environment inspection completed; no project code or tests ran.';
    output.reproduced = false;
  } else {
  if (plan.environment?.language === 'Python' && /^\d+(?:\.\d+){0,2}$/.test(plan.environment.version || '')) {
    const expected = plan.environment.version.split('.');
    if (!expected.every((part, index) => output.environment.python?.split('.')[index] === part)) throw Object.assign(new Error('The Runner Python version does not match the reviewed plan.'), { failureKind: 'setup' });
  }
  await writeProgress(0, phase === 'dependencies' ? '正在进入依赖准备阶段' : '正在进入隔离执行阶段');
  if (phase === 'dependencies') {
    const installs = plan.setup.filter(step => (step.type === 'run-command' || step.type === 'run-test') && isInstall(step.command));
    await writeProgress(0, installs.length ? '正在准备测试依赖' : '项目无需单独准备依赖');
    for (const [index, step] of installs.entries()) { const currentStep = index + 1; await writeProgress(currentStep, `正在安装依赖：${step.command}`); const result = await run(step.command, false, true); output.steps.push({ type: step.type, command: step.command, phase: 'dependencies', ...result, ok: result.code === 0 }); if (result.code !== 0) throw Object.assign(new Error('Dependency installation failed.'), { failureKind: 'dependencies' }); await writeProgress(currentStep, `依赖准备完成：${step.command}`); }
    output.summary = installs.length ? 'Reviewed dependencies prepared in the isolated container.' : 'No dependency installation was required.';
  } else {
    await writeProgress(0, '正在启动隔离 Runner');
    for (const [index, step] of plan.setup.entries()) {
      if ((step.type === 'run-command' || step.type === 'run-test') && isInstall(step.command)) continue;
      const currentStep = index + 1;
      await writeProgress(currentStep, `正在准备：${step.command || step.target || step.path || step.type}`);
      const result = await commandStep(step); output.steps.push({ type: step.type, command: step.command, target: step.target, path: step.path, phase: 'setup', ...result, ok: result.code === undefined || result.code === 0 });
      if (result.code !== undefined && result.code !== 0) throw Object.assign(new Error('A setup command failed before verification.'), { failureKind: result.failureKind === 'dependencies' ? 'dependencies' : 'setup' });
      await writeProgress(currentStep, `准备完成：${step.command || step.target || step.path || step.type}`);
    }
    if (plan.mode === 'browser') await browserSteps(plan.steps, plan.setup.length);
    else for (const [index, step] of plan.steps.entries()) { const currentStep = plan.setup.length + index + 1; await writeProgress(currentStep, `正在执行：${step.command || step.target || step.path || step.type}`); const result = await commandStep(step); output.steps.push({ index, type: step.type, command: step.command, target: step.target, path: step.path, phase: 'verify', ...result, ok: result.code === undefined || result.code === 0 }); await writeProgress(currentStep, `已完成：${step.command || step.target || step.path || step.type}`); }
    await writeProgress(totalSteps, '本次验证步骤已完成，正在判断机器判据');
    output.failureKind = output.steps.find(step => step.failureKind && ['dependencies', 'collection'].includes(step.failureKind))?.failureKind || output.steps.find(step => step.failureKind)?.failureKind;
    output.reproduced = !['dependencies', 'collection', 'setup'].includes(output.failureKind) && observedOracle();
    output.summary = output.reproduced ? 'Observed the plan oracle.' : 'The plan completed without observing the oracle.';
  }
  }
} catch (error) {
  output.failureKind = error.failureKind || (phase === 'dependencies' ? 'dependencies' : 'unknown');
  output.error = error instanceof Error ? error.message : String(error);
  output.summary = phase === 'dependencies' ? 'Dependency preparation failed.' : 'The isolated attempt failed before the oracle could be evaluated.';
} finally {
  try { output.environment = environmentSnapshot(); } catch { output.environment = { dependencies: 'unavailable' }; }
  for (const child of background) child.kill('SIGTERM');
  output.durationMs = Date.now() - started;
  await writeFile(`${artifacts}/stdout.log`, output.stdout, 'utf8');
  await writeFile(`${artifacts}/stderr.log`, output.stderr, 'utf8');
  await writeFile(`${artifacts}/console.json`, JSON.stringify(output.console, null, 2), 'utf8');
  await writeFile(`${artifacts}/network.json`, JSON.stringify(output.network, null, 2), 'utf8');
  await writeFile(`${artifacts}/result.json`, JSON.stringify(output, null, 2), 'utf8');
  await writeFile(`${artifacts}/dependencies.json`, JSON.stringify(dependencyInventory, null, 2), 'utf8');
}
process.exitCode = output.error ? 2 : 0;
