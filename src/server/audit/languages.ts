import type { CheckResult, RepoSnapshot } from '@/contracts/audit';

// Configuration evidence only. Never execute code from an inspected repository.
export function languageConfiguration(snapshot: RepoSnapshot, type: 'test' | 'lint'): CheckResult | undefined {
  const paths = snapshot.files.map(file => file.path), isTest = type === 'test';
  const base = { id: isTest ? 'test-entry' : 'code-style', title: isTest ? '测试入口' : '代码规范配置', category: '工程' as const, source: 'rule' as const };
  let path: string | undefined, reason: string;
  if (isTest) {
    path = paths.find(path => /(^|\/)(pytest\.ini|tox\.ini)$/.test(path)); reason = '发现 Python 测试配置';
    if (!path) { path = paths.find(path => /(^|\/)(test_[^/]+\.py|[^/]+_test\.go|[^/]+Test\.java)$/.test(path)); reason = '发现 Python、Go 或 Java 测试文件'; }
    if (!path) {
      const toml = snapshot.contents.find(file => file.path === 'pyproject.toml' && !file.error && !file.truncated);
      if (toml && /^\[tool\.pytest\./m.test(toml.content)) { path = toml.path; reason = '发现 pyproject.toml 中 pytest 配置'; }
    }
  } else {
    path = paths.find(path => /(^|\/)(ruff\.toml|\.ruff\.toml|\.flake8|\.golangci\.ya?ml|rustfmt\.toml|\.rustfmt\.toml|checkstyle\.xml)$/.test(path)); reason = '发现 Python、Go、Rust 或 Java 代码规范配置';
    if (!path) {
      const toml = snapshot.contents.find(file => file.path === 'pyproject.toml' && !file.error && !file.truncated);
      if (toml && /^\[tool\.(ruff|black|isort)(\.|\])/m.test(toml.content)) { path = toml.path; reason = '发现 pyproject.toml 中代码规范配置'; }
    }
  }
  if (!path) return;
  return { ...base, status: 'pass', summary: `${reason}；仅确认存在，未执行或验证通过。`, evidence: [{ path, url: `${snapshot.repository.url}/blob/${snapshot.repository.sha}/${path.split('/').map(encodeURIComponent).join('/')}`, note: '仅根据固定提交中的配置或文件名判断。' }] };
}
