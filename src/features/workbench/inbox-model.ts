import type { GitItem, IssueCategory, IssuePriority, IssueWorkflowStatus } from '@/contracts/workbench';

export const issueCategories: Record<IssueCategory, string> = { bug: 'Bug 报告', feature: '功能建议', question: '使用咨询', documentation: '文档问题', performance: '性能问题', compatibility: '兼容性', security: '安全问题', other: '其他' };
export const issueStates: Record<IssueWorkflowStatus, string> = { untriaged: '未分诊', 'needs-info': '待补充信息', 'ready-to-reproduce': '准备复现', 'ready-to-reply': '准备回复', investigate: '待调查', replied: '已回复', 'manual-review': '人工审阅' };
export const issuePriorities: Record<IssuePriority, string> = { high: '高优先级', medium: '中优先级', low: '低优先级', unknown: '待判断' };
export function issueClassification(item: GitItem) {
  const triage = item.triage;
  return { category: triage?.review?.category || triage?.category, priority: triage?.review?.priority || triage?.priority || 'unknown', status: triage?.review?.workflowStatus || triage?.workflowStatus || 'untriaged', source: triage?.review?.category ? '维护者确认' : triage ? 'AI 建议' : '未分析', stale: Boolean(triage && triage.sourceUpdatedAt !== item.updatedAt) };
}
export const pullTypes = { dependency: '依赖更新', docs: '文档变更', fix: '缺陷修复', feature: '功能变更', other: '其他变更' } as const;
export type PullType = keyof typeof pullTypes;
/** Only a navigation hint derived from title/labels, never a review conclusion. */
export function pullClassification(item: GitItem): PullType {
  const text = `${item.title} ${item.labels.join(' ')}`.toLowerCase();
  if (/\b(dependabot|dependencies|dependency|bump|renovate)\b|依赖更新/.test(text)) return 'dependency';
  if (/\b(docs?|documentation|readme)\b|文档/.test(text)) return 'docs';
  if (/\b(fix|fixes|bug|bugfix|hotfix)\b|修复/.test(text)) return 'fix';
  if (/\b(feat|feature)\b|新增功能/.test(text)) return 'feature';
  return 'other';
}
export type InboxScope = 'all' | 'untriaged' | 'needs-info' | 'ready-to-reproduce' | 'high' | 'ready' | 'draft';
export function inScope(item: GitItem, kind: 'issues' | 'pulls', scope: InboxScope) {
  if (scope === 'all') return true;
  if (kind === 'pulls') return scope === 'draft' ? item.isDraft === true : item.isDraft !== true;
  const fields = issueClassification(item);
  if (scope === 'high') return fields.priority === 'high';
  return fields.status === scope;
}
export function inboxDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '日期未知';
}
