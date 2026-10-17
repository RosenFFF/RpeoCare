import { z } from 'zod';
import type { ReproductionPlan, ReproductionStep } from '@/contracts/workbench';
import { commandTokens, dependencyCommand } from '../../../reproduction/commands.mjs';

const stepSchema = z.object({
  type: z.enum(['goto', 'click', 'fill', 'expect', 'run-test', 'run-command', 'create-file', 'request']),
  target: z.string().max(1000).optional(),
  value: z.string().max(4000).optional(),
  command: z.string().max(500).optional(),
  path: z.string().max(500).optional(),
  content: z.string().max(20_000).optional(),
  expected: z.string().max(2000).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  body: z.string().max(20_000).optional(),
  background: z.boolean().optional(),
}).strict();

export const reproductionPlanSchema = z.object({
  workingDirectory: z.string().max(300).optional(),
  mode: z.enum(['command', 'browser', 'http', 'test']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string().min(1).max(2000),
  environment: z.object({
    language: z.string().max(40).optional(),
    version: z.string().max(80).optional(),
    os: z.string().max(80).optional(),
    dependencies: z.array(z.string().max(500)).max(20),
  }).strict(),
  setup: z.array(stepSchema).max(20),
  steps: z.array(stepSchema).min(1).max(30),
  oracle: z.object({
    type: z.enum(['exit-code', 'stdout-contains', 'stderr-contains', 'selector-visible', 'url-contains', 'http-status', 'all-steps-pass']),
    value: z.string().min(1).max(1000),
  }).strict(),
  expected: z.string().min(1).max(2000),
  evidence: z.array(z.enum(['stdout', 'stderr', 'screenshot', 'trace', 'video', 'network', 'console', 'stacktrace', 'test-result'])).min(1).max(10),
  risks: z.array(z.string().max(500)).max(20),
  missingInformation: z.array(z.string().max(500)).max(20),
  scopeLimitations: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  requiresHumanApproval: z.literal(true),
}).strict();

export function splitCommand(command: string): string[] {
  return commandTokens(command);
}

function validateRelativePath(value: string, label: string) {
  if (!value || value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.includes('..') || value.includes('\\')) {
    throw new Error(`${label} 必须是仓库内的安全相对路径。`);
  }
}

function validateStep(step: ReproductionStep, phase: 'setup' | 'execute') {
  if (step.type === 'run-command' || step.type === 'run-test') {
    if (!step.command) throw new Error('命令步骤缺少 command。');
    splitCommand(step.command);
    const installs = dependencyCommand(step.command);
    if (installs && phase !== 'setup') throw new Error('依赖安装只能出现在 setup 阶段。');
  }
  if (step.type === 'create-file') {
    if (!step.path) throw new Error('创建文件步骤缺少 path。');
    validateRelativePath(step.path, '测试文件路径');
  }
  if (['click', 'fill', 'expect'].includes(step.type) && !step.target) throw new Error(`${step.type} 步骤缺少 target。`);
  if (step.type === 'request' || step.type === 'goto') {
    if (!step.target) throw new Error(`${step.type} 步骤缺少 target。`);
    const url = new URL(step.target, 'http://127.0.0.1');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('复现运行期只能访问沙箱内的 localhost。');
    if (step.type === 'request' && step.body && !step.method) throw new Error('HTTP 请求包含 body 时必须声明 method。');
  }
  if (step.background && step.type !== 'run-command') throw new Error('只有 run-command 可以后台启动。');
}

export function validateReproductionPlan(value: unknown): ReproductionPlan {
  const plan = reproductionPlanSchema.parse(value) as ReproductionPlan;
  if (plan.workingDirectory && plan.workingDirectory !== '.') validateRelativePath(plan.workingDirectory, '工作目录');
  plan.setup.forEach(step => validateStep(step, 'setup'));
  plan.steps.forEach(step => validateStep(step, 'execute'));
  if (plan.mode === 'browser' && !plan.steps.some(step => ['goto', 'click', 'fill', 'expect'].includes(step.type))) throw new Error('浏览器复现计划缺少浏览器操作。');
  if (plan.oracle.type === 'selector-visible' && !plan.steps.some(step => step.type === 'expect')) throw new Error('selector-visible 判据需要 expect 步骤。');
  if (plan.oracle.type === 'http-status') {
    if (!plan.steps.some(step => step.type === 'request')) throw new Error('http-status 判据需要 request 步骤。');
    const status = Number(plan.oracle.value);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('HTTP 状态判据无效。');
  }
  if (plan.oracle.type === 'url-contains' && plan.mode !== 'browser') throw new Error('url-contains 判据只适用于浏览器复现。');
  if (plan.oracle.type === 'exit-code' && !/^\d{1,3}$/.test(plan.oracle.value)) throw new Error('退出码判据无效。');
  if (plan.oracle.type === 'all-steps-pass' && (plan.mode !== 'test' || !plan.steps.length || plan.steps.some(step => !['run-command', 'run-test'].includes(step.type)))) throw new Error('完整路径判据只允许测试模式中的命令步骤。');
  return plan;
}
