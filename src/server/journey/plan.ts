import type { ContributorJourneyContext, ContributorJourneySource, ReproductionPlan, ReproductionStep } from '@/contracts/workbench';
import type { RepoSnapshot } from '@/contracts/audit';
import { splitCommand, validateReproductionPlan } from '@/server/reproduction/plan';

const documentPattern = /(^|\/)(readme|contributing)(?:\.(?:md|markdown|rst|txt|adoc))?$/i;
const runnableStart = /^(?:npm\s+(?:ci|install|test|run\s+(?:test(?::[a-z0-9:_-]+)?|lint|typecheck|check))|npx\s+playwright\s+test|python3?\s+-m\s+(?:pytest|unittest)|pytest(?:\s|$)|go\s+test(?:\s|$))/i;

function commandFromLine(raw: string) {
  const value = raw.trim().replace(/^(?:\$|>)\s*/, '').replace(/\s+#.*$/, '').trim();
  if (!runnableStart.test(value) || value.length > 500) return null;
  if (/^npm\s+(?:ci|install)\b/i.test(value) && !/^npm\s+(?:ci|install)(?:\s+--[a-z0-9-]+)*$/i.test(value)) return null;
  try { splitCommand(value); return value; } catch { return null; }
}

function documentationCommands(snapshot: RepoSnapshot): ContributorJourneySource[] {
  const commands: ContributorJourneySource[] = [];
  for (const file of snapshot.contents.filter(item => !item.error && documentPattern.test(item.path))) {
    let fenced = false;
    file.content.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return; }
      const command = commandFromLine(line);
      if (!command || (!fenced && !/^\s*(?:\$|>)\s+/.test(line))) return;
      const phase = /^npm\s+(?:ci|install)\b/i.test(command) ? 'setup' : 'verify';
      commands.push({ phase, command, label: phase === 'setup' ? '准备项目依赖' : '执行文档验证命令', path: file.path, line: index + 1, origin: 'documentation' });
    });
  }
  return commands;
}

function manifestLine(content: string, key: string) {
  const index = content.split(/\r?\n/).findIndex(line => line.includes(`"${key}"`));
  return index >= 0 ? index + 1 : undefined;
}

function buildNodeSources(snapshot: RepoSnapshot, existing: ContributorJourneySource[]) {
  const packageFile = snapshot.contents.find(item => item.path === 'package.json' && !item.error && !item.truncated);
  if (!packageFile) return [];
  let data: { scripts?: Record<string, unknown> };
  try { data = JSON.parse(packageFile.content) as { scripts?: Record<string, unknown> }; } catch { return []; }
  const scripts = data.scripts || {};
  const additions: ContributorJourneySource[] = [];
  const add = (name: 'test' | 'lint' | 'typecheck' | 'check', command: string) => {
    const configured = scripts[name];
    if (typeof configured !== 'string' || !configured.trim() || /no test specified/i.test(configured)) return;
    if (existing.some(item => item.command.toLowerCase() === command.toLowerCase())) return;
    additions.push({ phase: 'verify', command, label: name === 'test' ? '运行项目测试' : name === 'lint' ? '运行代码检查' : name === 'typecheck' ? '运行类型检查' : '运行项目检查', path: 'package.json', line: manifestLine(packageFile.content, name), origin: 'manifest' });
  };
  add('test', 'npm test'); add('lint', 'npm run lint'); add('typecheck', 'npm run typecheck'); add('check', 'npm run check');
  const hasNodeVerification = [...existing, ...additions].some(item => item.phase === 'verify' && /^npm\b/i.test(item.command));
  if (hasNodeVerification && ![...existing, ...additions].some(item => item.phase === 'setup')) {
    const lock = snapshot.files.find(file => ['package-lock.json', 'npm-shrinkwrap.json'].includes(file.path));
    additions.unshift({ phase: 'setup', command: lock ? 'npm ci' : 'npm install', label: '准备 Node.js 依赖', path: lock?.path || 'package.json', origin: 'manifest' });
  }
  return additions;
}

function fallbackSources(snapshot: RepoSnapshot, existing: ContributorJourneySource[]) {
  if (existing.some(item => item.phase === 'verify')) return [];
  const python = snapshot.files.find(file => /^(?:pyproject\.toml|pytest\.ini|setup\.cfg|tox\.ini)$/.test(file.path));
  if (python) return [{ phase: 'verify', command: 'python3 -m pytest', label: '运行 Python 测试', path: python.path, origin: 'manifest' as const }];
  const go = snapshot.files.find(file => file.path === 'go.mod');
  if (go) return [{ phase: 'verify', command: 'go test ./...', label: '运行 Go 测试', path: go.path, origin: 'manifest' as const }];
  return [];
}

function uniqueSources(items: ContributorJourneySource[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.phase}:${item.command.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 10);
}

function journeyLanguage(sources: ContributorJourneySource[], fallback?: string | null) {
  const languages = new Set<string>();
  for (const source of sources) {
    if (/^(?:npm|npx)\b/i.test(source.command)) languages.add('Node.js');
    if (/^(?:python3?|pytest)\b/i.test(source.command)) languages.add('Python');
    if (/^go\b/i.test(source.command)) languages.add('Go');
  }
  return languages.size ? [...languages].join(' + ') : fallback || undefined;
}

export function createContributorJourneyPlan(snapshot: RepoSnapshot): { plan: ReproductionPlan; journey: ContributorJourneyContext } {
  const documented = documentationCommands(snapshot);
  const nodeSources = buildNodeSources(snapshot, documented);
  const discovered = uniqueSources([...documented, ...nodeSources, ...fallbackSources(snapshot, [...documented, ...nodeSources])]);
  const sources = [...discovered.filter(item => item.phase === 'setup'), ...discovered.filter(item => item.phase === 'verify')];
  const verify = sources.filter(item => item.phase === 'verify');
  if (!verify.length) throw new Error('当前快照中没有可安全执行的测试或检查命令。请先在 README、CONTRIBUTING 或项目配置中补充 npm、pytest 或 go test 命令。');
  const toStep = (source: ContributorJourneySource): ReproductionStep => ({ type: source.command.includes('test') || /pytest|go test/i.test(source.command) ? 'run-test' : 'run-command', command: source.command });
  const setup = sources.filter(item => item.phase === 'setup').map(toStep);
  const steps = verify.map(toStep);
  const documents = snapshot.contents.filter(item => !item.error && documentPattern.test(item.path)).map(item => item.path);
  const needsNetwork = setup.some(step => /^npm\s+(?:ci|install)/i.test(step.command || ''));
  const plan = validateReproductionPlan({
    mode: 'test', confidence: documented.length ? 'high' : 'medium',
    summary: documented.length ? '按项目文档和清单验证依赖准备、测试与代码检查是否能在干净环境中完成。' : '项目文档未提供完整命令，已根据受支持的项目清单生成最小验证路径。',
    environment: { language: journeyLanguage(sources, snapshot.repository.language), dependencies: needsNetwork ? ['依赖准备阶段可能需要访问软件包注册表；执行阶段保持断网。'] : [] },
    setup, steps, oracle: { type: 'all-steps-pass', value: '所有非后台验证步骤退出码均为 0' },
    expected: '维护者确认的贡献路径中，所有安装、测试和代码检查步骤都能够完成。',
    evidence: ['stdout', 'stderr', 'test-result'],
    risks: ['仓库代码仅在受限 Docker Runner 中执行。', ...(needsNetwork ? ['依赖准备需要维护者明确允许受限联网。'] : [])],
    missingInformation: documented.length ? [] : ['README 或 CONTRIBUTING 中没有识别到完整的可执行验证命令。'],
    requiresHumanApproval: true,
  });
  return { plan, journey: { auditRunId: '', repository: snapshot.repository.fullName, documents, sources, derivedAt: new Date().toISOString() } };
}
