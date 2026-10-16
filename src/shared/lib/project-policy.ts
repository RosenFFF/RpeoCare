import type { GitItem, IssueCategory } from '../../contracts/workbench';
import type { PolicyAssessment, PolicyCheck, PolicyObservation, ProjectPolicy, ProjectRule } from '../../contracts/policy';

const usable = (text: string) => text.trim().length >= 2 && !/^(?:n\/?a|none|null|unknown|not (?:provided|specified|available)|未提供|未知|不详|无|待补充|没有|无信息|未填写|tbd|todo|[-?.\s]+)$/i.test(text.trim());
const runtimePattern = (runtime: string) => new RegExp(`\\b${runtime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:version|版本|[v:=])?\\s*(\\d+\\.\\d+(?:\\.\\d+)?)(?![\\d.])`, 'ig');
function fieldEvidence(rule: ProjectRule, raw: string, observations: PolicyObservation[]) {
  const observation = observations.find(item => item.ruleId === rule.id && item.quote.length >= 3 && raw.includes(item.quote) && usable(item.value) && item.quote.includes(item.value) && !/(?:未提供|未填写|未知|not (?:provided|specified)|unknown)/i.test(item.quote));
  if (rule.field === 'runtime') return raw.match(/\b(?:python|node(?:\.js)?|php|java|go|ruby|rust|dotnet|\.net)\s*(?:version|版本|[v:=])?\s*\d+\.\d+(?:\.\d+)?/i)?.[0];
  if (rule.field === 'platform') return raw.match(/\b(?:windows\s*(?:10|11|server)?|ubuntu\s*\d*(?:\.\d+)?|debian\s*\d*|macos\s*\d*(?:\.\d+)?|linux|android\s*\d*|ios\s*\d*)\b/i)?.[0];
  return observation?.quote;
}
function checksFor(policy: ProjectPolicy, kind: 'issue' | 'pr', run: (rule: ProjectRule) => Omit<PolicyCheck, 'ruleId' | 'title' | 'source'> | null): PolicyAssessment {
  return { revision: policy.revision, confirmedAt: policy.confirmedAt!, checks: policy.rules.filter(rule => rule.appliesTo === 'both' || rule.appliesTo === kind).flatMap(rule => { const value = run(rule); return value ? [{ ruleId: rule.id, title: rule.title, source: rule.source, ...value }] : []; }) };
}
export function assessIssuePolicy(policy: ProjectPolicy | null, item: GitItem, category: IssueCategory, observations: PolicyObservation[] = []): PolicyAssessment | undefined {
  if (!policy?.confirmedAt) return;
  // Only the original report is eligible; comments may describe a different environment.
  const raw = `${item.title}\n${item.body}`;
  return checksFor(policy, 'issue', rule => {
    if (rule.category && rule.kind !== 'label-map' && rule.category !== category) return null;
    if (rule.kind === 'required-field') { const evidence = fieldEvidence(rule, raw, observations); return evidence ? { status: 'met', evidence, detail: '在原始反馈中找到可核对线索；不等于已复现。' } : { status: 'missing', detail: `未提取到可核对的「${rule.title}」，请维护者确认并补充。` }; }
    if (rule.kind === 'supported-version') {
      const [runtime, ...versions] = rule.value.split('|').map(x => x.trim());
      const matches = [...raw.matchAll(runtimePattern(runtime))];
      if (!matches.length) return { status: 'unknown', detail: `未识别 ${runtime} 的明确版本；支持范围：${versions.join('、')}。` };
      const outside = matches.filter(match => !versions.some(v => match[1] === v || match[1].startsWith(`${v}.`)));
      return { status: outside.length ? 'attention' : 'met', evidence: matches.map(m => m[0]).join('；'), detail: outside.length ? `检测到支持列表外版本，需核对是否为当前环境；不自动关闭问题。支持：${versions.join('、')}。` : '原文中的版本线索位于维护者确认的支持列表。' };
    }
    if (rule.kind === 'label-map') return item.labels.some(label => label.toLowerCase() === rule.value.toLowerCase()) ? { status: projectCategory(policy, item) ? 'met' : 'attention', evidence: rule.value, detail: projectCategory(policy, item) ? `项目标签映射为 ${rule.category}；保留人工最终判断。` : '多个标签映射指向不同分类，请维护者确认，不自动覆盖最终分类。' } : null;
    return { status: 'reference', detail: rule.value || rule.title };
  });
}
export function projectCategory(policy: ProjectPolicy | null, item: GitItem): IssueCategory | undefined {
  const categories = new Set(policy?.rules.filter(r => r.kind === 'label-map' && r.category && item.labels.some(label => label.toLowerCase() === r.value.toLowerCase())).map(r => r.category));
  return categories.size === 1 ? [...categories][0] : undefined;
}
export function assessPullPolicy(policy: ProjectPolicy | null, item: GitItem): PolicyAssessment | undefined {
  if (!policy?.confirmedAt) return;
  return checksFor(policy, 'pr', rule => {
    if (rule.kind === 'required-check') {
      const matches = (item.checks || []).filter(c => c.name.toLowerCase() === rule.value.toLowerCase());
      if (!matches.length) return { status: item.checksAvailable === false ? 'unknown' : 'missing', detail: `未读取到名为「${rule.value}」的检查。未读取不等于检查失败。` };
      const failed = matches.some(c => ['failure', 'error', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion || ''));
      const passed = matches.every(c => c.status === 'completed' && c.conclusion === 'success');
      return { status: failed ? 'attention' : passed ? 'met' : 'unknown', evidence: matches.map(c => `${c.name}: ${c.conclusion || c.status}`).join('；'), detail: '来自采集时 GitHub 检查快照；RepoCare 未执行此命令。' };
    }
    if (rule.kind === 'test-change') {
      const paths = (item.files || []).filter(f => f.status !== 'removed' && /(^|\/)(tests?|__tests__)(\/|$)|[._-](test|spec)\.[^/]+$|_test\.go$/i.test(f.path)).map(f => f.path);
      return { status: paths.length ? 'met' : item.filesTruncated ? 'unknown' : 'missing', evidence: paths.join('、') || undefined, detail: paths.length ? '发现测试路径变更；不代表覆盖充分或运行通过。' : '读取范围内未发现测试变更，请核对本 PR 是否需要回归测试。' };
    }
    return { status: 'reference', detail: rule.value || rule.title };
  });
}
