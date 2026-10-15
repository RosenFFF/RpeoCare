import type { GitItem } from '@/contracts/workbench';
import { issueClassification } from './inbox-model';

export const issueActions = {
  refresh: { label: '待重新核对', hint: '原文有更新，先核对已有结论', action: '核对更新后的原文', tone: 'amber' },
  decision: { label: '待维护者决策', hint: '需要人工确认处理方向', action: '确认处理方向', tone: 'violet' },
  triage: { label: '待分诊', hint: '阅读反馈，判断类型与下一步', action: '阅读原文并分诊', tone: 'teal' },
  information: { label: '待补充信息', hint: '核对缺失内容，再请求补充', action: '核对缺失信息', tone: 'amber' },
  verify: { label: '待验证与调查', hint: '沿已有线索继续调查或准备复现', action: '查看调查与复现线索', tone: 'blue' },
  reply: { label: '待回复', hint: '核对建议，审阅回复草稿', action: '审阅回复建议', tone: 'teal' },
  replied: { label: '已回复', hint: '查看已有处理状态与后续反馈', action: '查看处理记录', tone: 'neutral' },
} as const;
export type IssueActionKey = keyof typeof issueActions;
export type IssueActionGroup = { key: IssueActionKey; items: GitItem[] };

/** Routing uses saved workflow fields, never title keywords or guessed intent. */
export function issueActionKey(item: GitItem): IssueActionKey {
  const fields = issueClassification(item);
  if (fields.stale) return 'refresh';
  switch (fields.status) {
    case 'needs-info': return 'information';
    case 'ready-to-reproduce':
    case 'investigate': return 'verify';
    case 'ready-to-reply': return 'reply';
    case 'manual-review': return 'decision';
    case 'replied': return 'replied';
    default: return 'triage';
  }
}

export function issueActionGroups(items: GitItem[]): IssueActionGroup[] {
  const buckets = new Map<IssueActionKey, GitItem[]>();
  for (const item of items) {
    const key = issueActionKey(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  return (Object.keys(issueActions) as IssueActionKey[]).flatMap(key => {
    const members = buckets.get(key);
    return members?.length ? [{ key, items: members }] : [];
  });
}

export function issueTitleNeedsContext(title: string) {
  const text = title.trim();
  return text.length < 4 || /^(?:https?:\/\/|www\.)\S+$/i.test(text) || /^[\w.-]+\.[a-z]{2,}\/\S*$/i.test(text);
}

export function issueDiscussion(item: GitItem) {
  const value = item.commentCount ?? item.comments?.length;
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}
