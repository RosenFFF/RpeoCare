import type { Category, CheckResult, Evidence, RepoSnapshot } from '../../contracts/audit';
import { languageConfiguration } from './languages';

function fileUrl(snapshot: RepoSnapshot, path: string): string {
  return `${snapshot.repository.url}/blob/${snapshot.repository.sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function evidence(snapshot: RepoSnapshot, path: string, note?: string): Evidence {
  return { path, url: fileUrl(snapshot, path), ...(note ? { note } : {}) };
}

function presence(snapshot: RepoSnapshot, options: { id: string; title: string; category: Category; match: (path: string) => boolean; summary: string; missing: string; suggestion: string }): CheckResult {
  const matches = snapshot.files.filter(file => options.match(file.path.toLowerCase()));
  if (matches.length) return {
    id: options.id, title: options.title, category: options.category, source: 'rule', status: 'pass',
    summary: options.summary,
    evidence: matches.slice(0, 4).map(file => evidence(snapshot, file.path, '仅确认文件存在，未执行配置或验证内容完整性。')),
  };
  return {
    id: options.id, title: options.title, category: options.category, source: 'rule',
    status: snapshot.treeTruncated ? 'unknown' : 'needs_attention',
    summary: snapshot.treeTruncated ? '目录不完整，无法确认是否存在相关文件。' : options.missing,
    evidence: [{ path: '/', url: `${snapshot.repository.url}/tree/${snapshot.repository.sha}`, note: snapshot.treeTruncated ? '当前仅搜索了 GitHub 返回的部分目录。' : '已搜索该提交的完整文件目录；判断范围仅限本项支持的常见路径与命名。' }],
    suggestion: options.suggestion,
  };
}

function packageData(snapshot: RepoSnapshot): { data?: Record<string, unknown>; reason?: string } {
  if (!snapshot.files.some(file => file.path === 'package.json')) return { reason: '未发现根目录 package.json；当前脚本规则仅支持根目录 Node.js 配置，其他语言和子项目暂无法判断。' };
  const content = snapshot.contents.find(file => file.path === 'package.json');
  if (!content || content.error || content.truncated) return { reason: 'package.json 未能完整读取，无法判断脚本配置。' };
  try {
    const data: unknown = JSON.parse(content.content);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { reason: 'package.json 格式无效，无法判断脚本配置。' };
    return { data: data as Record<string, unknown> };
  } catch { return { reason: 'package.json 不是有效 JSON，无法判断脚本配置。' }; }
}

function scripts(data: Record<string, unknown>): Record<string, string> {
  if (!data.scripts || typeof data.scripts !== 'object' || Array.isArray(data.scripts)) return {};
  return Object.fromEntries(Object.entries(data.scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
}

function configurationCheck(snapshot: RepoSnapshot, type: 'test' | 'lint'): CheckResult {
  const language = languageConfiguration(snapshot, type);
  if (language) return language;
  const isTest = type === 'test';
  const base = { id: isTest ? 'test-entry' : 'code-style', title: isTest ? '测试入口' : '代码规范配置', category: '工程' as const, source: 'rule' as const };
  if (!isTest) {
    const config = snapshot.files.find(file => /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.(?:json|ya?ml|[cm]?js))?|biome\.jsonc?|\.prettierrc(?:\.(?:json|ya?ml|[cm]?js))?|prettier\.config\.[cm]?[jt]s|\.oxlintrc\.json|oxlint\.config\.[cm]?[jt]s)$/.test(file.path.toLowerCase()));
    if (config) return { ...base, status: 'pass', summary: '发现根目录代码检查或格式化配置文件；未执行检查。', evidence: [evidence(snapshot, config.path, '仅确认配置文件存在，未验证配置有效性。')] };
  }
  const parsed = packageData(snapshot);
  if (!parsed.data) return { ...base, status: 'unknown', summary: parsed.reason!, evidence: snapshot.files.some(file => file.path === 'package.json') ? [evidence(snapshot, 'package.json', parsed.reason)] : [{ path: '/', note: isTest ? '仅支持根目录 Node.js 项目的测试脚本检测。' : '未发现支持的根目录配置；其他语言、子项目或非标准配置暂无法判断。' }] };
  const entries = Object.entries(scripts(parsed.data));
  const matching = entries.filter(([name, command]) => isTest ? /^test(?::|$)/.test(name) && !/no test specified/i.test(command) : /^(?:lint|format)(?::|$)/.test(name));
  if (matching.length || (!isTest && parsed.data.eslintConfig && typeof parsed.data.eslintConfig === 'object')) return {
    ...base, status: 'pass', summary: isTest ? 'package.json 声明了测试脚本；未运行测试，不代表测试通过。' : 'package.json 声明了代码检查或格式化配置；未执行检查。',
    evidence: [{ ...evidence(snapshot, 'package.json'), excerpt: matching.length ? matching.map(([name, command]) => `${name}: ${command}`).join('\n').slice(0, 600) : 'eslintConfig 配置项存在' }],
  };
  const hasSubprojects = Boolean(parsed.data.workspaces) || snapshot.files.some(file => file.path !== 'package.json' && file.path.endsWith('/package.json'));
  if (snapshot.treeTruncated || hasSubprojects) return { ...base, status: 'unknown', summary: hasSubprojects ? '根目录未发现相关配置；仓库包含工作区或子项目，需要进一步检查子项目。' : '根目录未发现相关配置，且目录不完整，无法确认子项目配置。', evidence: [evidence(snapshot, 'package.json', '本次规则未深入解析各子项目配置。')] };
  return {
    ...base, status: 'needs_attention',
    summary: isTest ? '根目录 package.json 未声明有效的 test / test:* 入口；这不代表项目没有测试。' : '未发现支持的根目录规范配置或 lint / format 脚本。',
    evidence: [evidence(snapshot, 'package.json', '已解析根目录配置并搜索完整目录；仅识别本次支持的常见命名。')],
    suggestion: isTest ? '为贡献者提供明确、可运行的测试命令，并在文档中说明。' : '提供统一的代码检查或格式化配置，并说明执行命令。',
  };
}

export function runRules(snapshot: RepoSnapshot): CheckResult[] {
  return [
    presence(snapshot, { id: 'readme', title: '项目说明', category: '文档', match: path => /^(?:\.github\/|docs\/)?readme(?:\.(?:md|markdown|rst|txt|adoc))?$/.test(path), summary: '发现项目说明文件；内容完整性由后续分析判断。', missing: '未在根目录、docs 或 .github 中发现常见命名的 README。', suggestion: '补充项目用途、安装方法与最小使用示例。' }),
    presence(snapshot, { id: 'license', title: '开源许可', category: '文档', match: path => /^(?:license|licence|copying)(?:\.[a-z0-9_-]+)?$/.test(path), summary: '发现根目录许可证文件；未判断许可证类型、有效性或合规性。', missing: '未在根目录发现常见命名的许可证文件。', suggestion: '根据项目实际授权情况提供许可证文件；本项不构成法律判断。' }),
    presence(snapshot, { id: 'contributing', title: '贡献指南', category: '协作', match: path => /^(?:\.github\/|docs\/)?contributing(?:\.(?:md|markdown|rst|txt|adoc))?$/.test(path), summary: '发现贡献指南文件；尚未判断流程说明是否充分。', missing: '未在根目录、docs 或 .github 中发现常见命名的贡献指南。', suggestion: '说明本地开发、验证方法和提交贡献的流程。' }),
    presence(snapshot, { id: 'issue-template', title: 'Issue 模板', category: '协作', match: path => /^(?:\.github\/|docs\/)?issue_template\.md$/.test(path) || /^\.github\/issue_template\/(?!config\.ya?ml$)[^/]+\.(?:md|ya?ml)$/.test(path), summary: '发现 Issue 反馈模板文件；未验证模板字段及语法。', missing: '未发现常见路径的 Issue 模板；仅有 config.yml 不计为反馈模板。', suggestion: '提供问题描述、复现步骤、预期行为及环境信息字段。' }),
    presence(snapshot, { id: 'pr-template', title: 'PR 模板', category: '协作', match: path => /^(?:\.github\/|docs\/)?pull_request_template\.md$/.test(path) || /^(?:\.github\/|docs\/)?pull_request_template\/[^/]+\.md$/.test(path), summary: '发现 Pull Request 模板文件；未验证模板内容。', missing: '未发现常见路径的 Pull Request 模板。', suggestion: '提供改动说明、关联 Issue 和验证记录字段。' }),
    presence(snapshot, { id: 'ci', title: '持续集成', category: '工程', match: path => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path), summary: '发现 GitHub Actions 配置；未查询或运行工作流，不代表 CI 已通过。', missing: '未发现 GitHub Actions 工作流；本项未检测外部 CI 服务。', suggestion: '根据项目需要配置自动构建、测试或代码检查。' }),
    configurationCheck(snapshot, 'test'),
    configurationCheck(snapshot, 'lint'),
  ];
}
