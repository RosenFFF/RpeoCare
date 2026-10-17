import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import type { ReproductionArtifact, ReproductionAttempt, ReproductionJob, ReproductionPhase, ReproductionResult, VerificationStepResult } from '@/contracts/workbench';
import { parseRepositoryUrl } from '@/server/audit/github';
import { updateLeasedReproduction } from '@/server/workbench/store';
import { renewReproductionLease } from './queue';
import { dependencyCommand } from '../../../reproduction/commands.mjs';

const root = () => resolve(process.env.REPOCARE_REPRO_ARTIFACTS || 'data/reproduction');
const image = () => process.env.REPOCARE_REPRO_IMAGE || 'repocare-repro-runner:local';
const timeoutMs = () => Math.max(30_000, Math.min(Number(process.env.REPOCARE_REPRO_MAX_SECONDS || 180) * 1000, 300_000));
const attemptLimit = (job: ReproductionJob) => Math.max(1, Math.min(job.totalAttempts || (job.purpose === 'contributor-journey' ? 1 : 3), 3));
type SaveJob = (change: Partial<ReproductionJob>) => ReproductionJob;
type SandboxResult = { reproduced?: boolean; summary?: string; durationMs?: number; error?: string; steps?: VerificationStepResult[]; failureKind?: ReproductionJob['failureKind']; environment?: Record<string, string>; progress?: { currentStep?: number; totalSteps?: number; currentStepLabel?: string } };
function assertScratchPath(path: string) {
  const value = relative(root(), resolve(path));
  if (!value || value.startsWith('..') || isAbsolute(value)) throw new Error('执行工作目录必须位于复现制品目录内。');
}

function run(file: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((accept, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-1_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1_000_000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${file} 执行超时。`)); }, options.timeout || timeoutMs());
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); accept({ code: code ?? 1, stdout, stderr }); });
  });
}

async function ensureDocker() {
  if (process.env.REPOCARE_REPRO_ENABLED !== 'true') throw new Error('隔离复现尚未启用。请设置 REPOCARE_REPRO_ENABLED=true，并先构建 Runner 镜像。');
  const version = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 }).catch(() => null);
  if (!version || version.code !== 0) throw new Error('Docker 执行服务不可用，未在宿主机回退执行不受信任代码。');
  const inspected = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image()], { timeout: 15_000 });
  if (inspected.code !== 0) throw new Error(`缺少复现 Runner 镜像 ${image()}，请运行 npm run repro:image。`);
  const imageId = inspected.stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/i.test(imageId)) throw new Error('无法固定 Runner 镜像标识。');
  return { docker: version.stdout.trim(), runnerImageId: imageId };
}

async function prepareSource(job: ReproductionJob, workspace: string, branch?: string) {
  assertScratchPath(workspace);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(dirname(workspace), { recursive: true });
  const repository = parseRepositoryUrl(job.repoUrl);
  const safeUrl = `https://github.com/${repository.owner}/${repository.name}.git`;
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (branch && /^[A-Za-z0-9._/-]{1,200}$/.test(branch) && !branch.startsWith('-') && !branch.includes('..')) args.push('--branch', branch);
  args.push('--', safeUrl, workspace);
  const cloned = await run('git', ['-c', 'core.longpaths=true', ...args], { timeout: 90_000 });
  if (cloned.code !== 0) throw new Error(`无法准备仓库快照：${cloned.stderr.slice(-500)}`);
  const revision = await run('git', ['-C', workspace, 'rev-parse', 'HEAD'], { timeout: 15_000 });
  if (revision.code !== 0 || !/^[a-f0-9]{40}$/i.test(revision.stdout.trim())) throw new Error('无法锁定仓库提交版本。');
  const commitSha = revision.stdout.trim();
  if (job.commitSha && commitSha !== job.commitSha) {
    if (!/^[a-f0-9]{40}$/i.test(job.commitSha)) throw new Error('固定提交无效。');
    const fetched = await run('git', ['-c', 'core.longpaths=true', '-C', workspace, 'fetch', '--depth', '1', 'origin', job.commitSha], { timeout: 90000 });
    const checkout = fetched.code === 0 ? await run('git', ['-c', 'core.longpaths=true', '-C', workspace, 'checkout', '--detach', job.commitSha], { timeout: 20000 }) : null;
    if (!checkout || checkout.code !== 0) throw new Error('无法获取计划绑定的仓库快照。');
    return { commitSha: job.commitSha, log: `${cloned.stdout}\n${fetched.stdout}\n已固定 ${job.commitSha}` };
  }
  return { commitSha, log: `${cloned.stdout}\n${cloned.stderr}` };
}

function dockerPath(path: string) { return path.replace(/\\/g, '/'); }

async function resetWorkspace(workspace: string, commitSha: string) {
  const reset = await run('git', ['-c', 'core.longpaths=true', '-C', workspace, 'reset', '--hard', commitSha], { timeout: 20_000 });
  const clean = await run('git', ['-c', 'core.longpaths=true', '-C', workspace, 'clean', '-ffdx'], { timeout: 20_000 });
  if (reset.code !== 0 || clean.code !== 0) throw new Error('无法为下一次验证恢复干净的仓库快照。');
}

function requiresDependencyNetwork(job: ReproductionJob) {
  return job.plan.setup.some(step => {
    if (!step.command || !['run-command', 'run-test'].includes(step.type)) return false;
    return dependencyCommand(step.command);
  });
}

async function runSandbox(job: ReproductionJob, workspace: string, outputDir: string, phase: 'dependencies' | 'execution' | 'preflight', network: 'none' | 'bridge', save: SaveJob): Promise<SandboxResult> {
  assertScratchPath(outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const planPath = resolve(outputDir, 'plan.json');
  await writeFile(planPath, JSON.stringify(job.plan, null, 2), 'utf8');
  const args = [
    'run', '--rm', '--network', network, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--pids-limit', '256', '--memory', '2g', '--cpus', '2', '--shm-size', '512m',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
    '-e', 'REPRO_PLAN=/input/plan.json', '-e', 'REPRO_WORKSPACE=/workspace', '-e', 'REPRO_ARTIFACTS=/artifacts',
    '-e', `REPRO_PHASE=${phase}`, '-e', `REPRO_TIMEOUT_MS=${timeoutMs()}`,
    '-v', `${dockerPath(workspace)}:/workspace:${phase === 'preflight' ? 'ro' : 'rw'}`, '-v', `${dockerPath(outputDir)}:/artifacts:rw`, '-v', `${dockerPath(planPath)}:/input/plan.json:ro`,
    job.environment?.runnerImageId || image(),
  ];
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') args.splice(args.length - 1, 0, '--user', `${process.getuid()}:${process.getgid()}`);
  const progressPath = resolve(outputDir, 'progress.json');
  let lastProgress = '';
  const progressTimer = setInterval(async () => {
    try {
      const raw = await readFile(progressPath, 'utf8');
      if (raw === lastProgress) return;
      lastProgress = raw;
      const progress = JSON.parse(raw) as { phase?: ReproductionPhase; currentStep?: number; totalSteps?: number; currentStepLabel?: string };
      save({ phase: progress.phase || (phase === 'preflight' ? 'execution' : phase), currentAttempt: job.currentAttempt || 0, currentStep: progress.currentStep, totalSteps: progress.totalSteps || job.totalSteps, currentStepLabel: progress.currentStepLabel, progress: progress.currentStepLabel || `正在执行第 ${progress.currentStep || 0}/${progress.totalSteps || job.totalSteps || 0} 步` });
    } catch { /* Runner may not have written progress yet. */ }
  }, 750);
  try {
    const executed = await run('docker', args, { timeout: timeoutMs() + 30_000 });
    const resultPath = resolve(outputDir, 'result.json');
    try {
      const result = JSON.parse(await readFile(resultPath, 'utf8')) as SandboxResult;
      return result;
    } catch { return { error: executed.stderr || 'Runner 未生成结果。' }; }
  } finally { clearInterval(progressTimer); }
}

async function executeAttempt(job: ReproductionJob, workspace: string, attemptDir: string, index: number, save: SaveJob) {
  const total = attemptLimit(job);
  if (requiresDependencyNetwork(job)) {
    if (process.env.REPOCARE_REPRO_ALLOW_NETWORK !== 'true') throw new Error('复现计划需要安装依赖，但沙箱网络默认关闭。确认依赖来源可信后设置 REPOCARE_REPRO_ALLOW_NETWORK=true。');
    save({ phase: 'dependencies', phaseStartedAt: new Date().toISOString(), currentAttempt: index, currentStep: 0, currentStepLabel: '正在准备测试依赖', progress: `第 ${index}/${total} 次验证：正在受限联网准备依赖` });
    const dependency = await runSandbox(job, workspace, resolve(attemptDir, 'dependencies'), 'dependencies', 'bridge', save);
    save({ dependencySteps: dependency.steps || [] });
    if (dependency.error) throw Object.assign(new Error(dependency.error), { failureKind: dependency.failureKind || 'dependencies' });
  }
  save({ phase: 'execution', phaseStartedAt: new Date().toISOString(), currentAttempt: index, currentStep: 0, currentStepLabel: '正在启动隔离 Runner', progress: `第 ${index}/${total} 次验证：执行期网络已关闭` });
  const result = await runSandbox(job, workspace, resolve(attemptDir, 'execution'), 'execution', 'none', save);
  save({ currentAttempt: index, executionEnvironment: result.environment, currentStep: result.progress?.currentStep ?? job.plan.setup.length + job.plan.steps.length, currentStepLabel: result.progress?.currentStepLabel || '本次验证已完成', progress: `第 ${index}/${total} 次验证已完成，正在整理机器判据` });
  const blocked = result.failureKind && ['dependencies', 'collection', 'setup'].includes(result.failureKind);
  const reproductionResult: ReproductionResult = blocked ? 'blocked' : result.reproduced ? 'reproduced' : result.error ? 'failed' : 'not-reproduced';
  const environmentFingerprint = result.environment?.dependencies && result.environment.dependencies !== 'unavailable' ? createHash('sha256').update(JSON.stringify({ ...result.environment, image: job.environment?.runnerImageId })).digest('hex') : undefined;
  return { result: reproductionResult, summary: result.summary || result.error || '未返回摘要。', durationMs: result.durationMs || 0, verificationSteps: result.steps || [], failureKind: result.failureKind, environmentFingerprint };
}

const kindByName = (name: string): ReproductionArtifact['kind'] => {
  if (name.endsWith('source.log')) return 'source-log';
  if (name.endsWith('plan.json')) return 'plan';
  if (name.endsWith('result.json')) return 'result';
  if (name.endsWith('stdout.log')) return 'stdout';
  if (name.endsWith('stderr.log')) return 'stderr';
  if (name.endsWith('console.json')) return 'console';
  if (name.endsWith('network.json')) return 'network';
  if (name.endsWith('trace.zip')) return 'trace';
  if (/\.(webm|mp4)$/i.test(name)) return 'video';
  if (/\.(png|jpe?g)$/i.test(name)) return 'screenshot';
  return 'test-result';
};
const contentType = (name: string) => name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.webm') ? 'video/webm' : 'text/plain; charset=utf-8';

async function collectArtifacts(jobDir: string): Promise<ReproductionArtifact[]> {
  const files: string[] = [];
  let totalBytes = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (directory === jobDir && entry.name === 'workspace') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(path);
      if (info.size > 25 * 1024 * 1024) continue;
      totalBytes += info.size;
      if (files.length >= 250 || totalBytes > 100 * 1024 * 1024) throw new Error('复现证据超过安全收集上限。');
      files.push(path);
    }
  }
  await walk(jobDir);
  return Promise.all(files.map(async path => {
    const data = await readFile(path);
    const info = await stat(path);
    const relativePath = relative(root(), path).replace(/\\/g, '/');
    return { id: createHash('sha256').update(relativePath).digest('hex').slice(0, 24), kind: kindByName(path), path: relativePath, sha256: createHash('sha256').update(data).digest('hex'), contentType: contentType(path), size: info.size, createdAt: info.mtime.toISOString() };
  }));
}

export async function executeReproduction(owner: string, initial: ReproductionJob, worker: string) {
  const jobDir = resolve(root(), initial.id, createHash('sha256').update(worker).digest('hex').slice(0, 16));
  const workspace = resolve(jobDir, 'workspace');
  await mkdir(dirname(workspace), { recursive: true });
  let job = initial;
  const save: SaveJob = change => updateLeasedReproduction(owner, job.id, worker, change);
  const lease = setInterval(() => renewReproductionLease(worker, job.id), 30_000);
  try {
    const docker = await ensureDocker();
    job = save({ phase: 'source', phaseStartedAt: new Date().toISOString(), currentAttempt: 0, currentStep: 0, currentStepLabel: '正在获取仓库并锁定提交版本', progress: '正在获取仓库并锁定提交版本', environment: { ...docker, runnerImage: image(), network: requiresDependencyNetwork(job) && process.env.REPOCARE_REPRO_ALLOW_NETWORK === 'true' ? 'dependency preparation only; execution disabled' : 'disabled', isolation: 'read-only rootfs, no capabilities, resource limits' } });
    const source = await prepareSource(job, workspace, job.branch);
    await writeFile(resolve(jobDir, 'source.log'), source.log, 'utf8');
    if (job.purpose === 'environment-preflight') {
      const directory = resolve(jobDir, 'preflight');
      const inspected = await runSandbox(job, workspace, directory, 'preflight', 'none', save);
      if (inspected.error) throw Object.assign(new Error(inspected.error), { failureKind: 'setup' });
      const raw = JSON.parse(await readFile(resolve(directory, 'preflight.json'), 'utf8')) as import('@/contracts/execution-readiness').EnvironmentPreflight;
      if (!['ready', 'review', 'blocked'].includes(raw.status) || !Array.isArray(raw.checks) || raw.checks.length > 80) throw new Error('预检结果格式不完整。');
      if (requiresDependencyNetwork(job) && process.env.REPOCARE_REPRO_ALLOW_NETWORK !== 'true') { raw.checks.push({ id: 'dependency-network', status: 'blocked', title: '依赖准备尚未启用', detail: '计划包含依赖安装，当前准备阶段网络默认关闭。', remedy: '核对依赖来源并由管理员显式配置受支持的准备环境。' }); raw.status = 'blocked'; }
      const preflight = { ...raw, checkedAt: new Date().toISOString(), planHash: createHash('sha256').update(JSON.stringify(job.plan)).digest('hex'), commitSha: source.commitSha, runnerImageId: docker.runnerImageId };
      const artifacts = await collectArtifacts(jobDir);
      save({ status: preflight.status === 'blocked' ? 'blocked' : 'reproduced', phase: 'evidence', preflight, artifacts, finishedAt: new Date().toISOString(), progress: preflight.status === 'blocked' ? '静态预检发现执行条件受阻；未运行项目代码。' : '静态预检完成，仍需核对范围与人工确认执行。' });
      return;
    }
    if (job.preflightJobId) {
      const { getReproductionJob } = await import('../workbench/store');
      const check = getReproductionJob(owner, job.preflightJobId).preflight;
      if (!check || check.runnerImageId !== docker.runnerImageId || check.planHash !== createHash('sha256').update(JSON.stringify(job.plan)).digest('hex')) throw Object.assign(new Error('Runner 镜像或计划已变化，请重新预检后准备执行。'), { failureKind: 'sandbox' });
    }
    const total = attemptLimit(job);
    job = save({ commitSha: source.commitSha, phase: 'execution', phaseStartedAt: new Date().toISOString(), currentAttempt: 0, currentStep: 0, currentStepLabel: '固定提交已准备，等待第一次验证', progress: `固定提交已准备，正在进行 ${total} 次独立验证` });
    const history: ReproductionAttempt[] = [];
    for (let index = 1; index <= total; index++) {
      await resetWorkspace(workspace, source.commitSha);
      const startedAt = new Date().toISOString();
      const outcome = await executeAttempt(job, workspace, resolve(jobDir, `attempt-${index}`), index, save);
      const finishedAt = new Date().toISOString();
      history.push({ index, result: outcome.result, durationMs: outcome.durationMs, summary: outcome.summary, startedAt, finishedAt, steps: outcome.verificationSteps, failureKind: outcome.failureKind, environmentFingerprint: outcome.environmentFingerprint });
      const reproduced = history.filter(item => item.result === 'reproduced').length;
      job = save({ attempts: history.length, successfulAttempts: reproduced, attemptHistory: history, verificationSteps: outcome.verificationSteps, failureKind: outcome.failureKind, phase: 'execution', currentAttempt: index, currentStep: job.plan.setup.length + job.plan.steps.length, currentStepLabel: `第 ${index} 次验证已完成`, progress: job.plan.oracle.type === 'all-steps-pass' ? `已完成 ${index}/${total} 次命令验证，其中 ${reproduced} 次所有计划内命令通过` : `已完成 ${index}/${total} 次隔离验证，其中 ${reproduced} 次观察到故障信号` });
    }
    const reproduced = history.filter(item => item.result === 'reproduced').length;
    const failures = history.filter(item => item.result === 'failed').length;
    const threshold = job.plan.oracle.type === 'all-steps-pass' ? total : Math.min(2, total);
    const result: ReproductionResult = history.some(attempt => attempt.result === 'blocked') ? 'blocked' : reproduced >= threshold ? 'reproduced' : failures === total ? 'failed' : 'not-reproduced';
    const status = result;
    const artifacts = await collectArtifacts(jobDir);
    save({ status, result, artifacts, phase: 'evidence', phaseStartedAt: new Date().toISOString(), currentAttempt: total, currentStep: job.plan.setup.length + job.plan.steps.length, currentStepLabel: '证据已收集，报告已生成', progress: job.plan.oracle.type === 'all-steps-pass' ? result === 'reproduced' ? '此版本计划内命令全部通过，执行证据已保存' : '此版本命令验证存在阻塞，执行证据已保存' : reproduced >= threshold ? `稳定复现：${total} 次中 ${reproduced} 次命中机器判据` : `未达到稳定复现阈值：${total} 次中 ${reproduced} 次命中`, finishedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : '复现执行失败。';
    const blocked = /尚未启用|Docker|Runner 镜像|仓库快照|沙箱网络默认关闭/.test(message);
    const failureKind = (error as { failureKind?: ReproductionJob['failureKind'] }).failureKind || (blocked ? 'sandbox' : 'unknown');
    try { save({ status: blocked || failureKind === 'dependencies' ? 'blocked' : 'failed', result: blocked || failureKind === 'dependencies' ? 'blocked' : 'failed', failureKind, error: message, currentStepLabel: '执行已停止', progress: message, finishedAt: new Date().toISOString(), artifacts: await collectArtifacts(jobDir).catch(() => []) }); } catch { /* A superseded worker must not overwrite a reclaimed job. */ }
  } finally { clearInterval(lease); }
}
