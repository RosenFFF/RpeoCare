import { z } from 'zod';
import type { GitItem, IssueAction, IssueCategory, IssueConfidence, IssuePriority, IssueTriage, IssueWorkflowStatus } from '../../contracts/workbench';
import { assistant } from './assistant';
import { getIssueTriage, saveIssueTriage } from './store';

const triageSchema = z.object({
  category: z.enum(['bug', 'feature', 'question', 'documentation', 'performance', 'compatibility', 'security', 'other']),
  priority: z.enum(['high', 'medium', 'low', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  needsMoreInfo: z.boolean(),
  language: z.string().trim().min(1).max(80),
  titleZh: z.string().trim().min(1).max(500),
  summaryZh: z.string().trim().min(1).max(1500),
  bodyZh: z.string().trim().max(20000).optional(),
  actualBehavior: z.string().trim().max(3000).optional(),
  expectedBehavior: z.string().trim().max(3000).optional(),
  environment: z.string().trim().max(3000).optional(),
  providedInformation: z.array(z.string().trim().min(1).max(500)).max(20),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(20),
  suggestedLabels: z.array(z.string().trim().min(1).max(80)).max(12),
  suggestedAction: z.enum(['request-information', 'reply', 'investigate', 'consider-feature', 'close', 'manual-review']),
  commentsZh: z.array(z.object({ id: z.number().int().positive(), bodyZh: z.string().max(12000) })).max(100),
}).strict();

function statusForAction(action: IssueAction): IssueWorkflowStatus {
  if (action === 'request-information') return 'needs-info';
  if (action === 'reply') return 'ready-to-reply';
  if (action === 'investigate' || action === 'consider-feature') return 'investigate';
  if (action === 'manual-review') return 'manual-review';
  return 'ready-to-reply';
}

export function parseTriage(text: string, item: GitItem): Omit<IssueTriage, 'repoUrl' | 'number' | 'sourceUpdatedAt' | 'analyzedAt'> {
  let raw: unknown;
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { raw = JSON.parse(fenced ? fenced[1] : text); } catch { throw new Error('模型返回的分诊结果不是有效 JSON，请重试。'); }
  const result = triageSchema.safeParse(raw);
  if (!result.success) throw new Error('模型返回的分诊字段不完整或格式不正确，请重试。');
  const knownComments = new Set((item.comments || []).map(comment => comment.id));
  return { ...result.data, workflowStatus: statusForAction(result.data.suggestedAction), commentsZh: result.data.commentsZh.filter(comment => knownComments.has(comment.id)) } as Omit<IssueTriage, 'repoUrl' | 'number' | 'sourceUpdatedAt' | 'analyzedAt'>;
}

export async function analyzeIssue(owner: string, repoUrl: string, item: GitItem, signal?: AbortSignal, force = false) {
  const current = getIssueTriage(owner, repoUrl, item.number);
  if (!force && current && current.sourceUpdatedAt === item.updatedAt) return current;
  const context = {
    issue: { number: item.number, title: item.title, body: item.body, author: item.author, labels: item.labels, state: item.state, updatedAt: item.updatedAt },
    comments: (item.comments || []).map(comment => ({ id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt })),
  };
  const text = await assistant(owner, 'issue-triage', `只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。对输入 Issue 做结构化分诊并翻译为中文。category 只能是 bug、feature、question、documentation、performance、compatibility、security、other；priority 只能是 high、medium、low、unknown；confidence 只能是 high、medium、low；suggestedAction 只能是 request-information、reply、investigate、consider-feature、close、manual-review。不得凭空补充版本、错误或结论；信息不足时使用 unknown、manual-review 并列出缺失信息。commentsZh 必须保留输入评论 id 并逐条翻译，不能新增评论。`, context, [], signal);
  const parsed = parseTriage(text, item);
  return saveIssueTriage(owner, repoUrl, { ...parsed, workflowStatus: current?.workflowStatus || parsed.workflowStatus, repoUrl, number: item.number, sourceUpdatedAt: item.updatedAt, analyzedAt: new Date().toISOString() });
}

export type { IssueAction, IssueCategory, IssueConfidence, IssuePriority, IssueWorkflowStatus };
