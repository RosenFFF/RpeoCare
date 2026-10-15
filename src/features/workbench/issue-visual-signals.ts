import type { GitItem, IssueCategory } from '@/contracts/workbench';
import { issueCategories, issueClassification } from './inbox-model';
import { issueDiscussion, issueTitleNeedsContext } from './issue-map-model';

export type VisualIssueCategory = IssueCategory | 'unknown';
export type AttentionProfile = 'maintenance' | 'response';
export const visualCategoryNames: Record<VisualIssueCategory, string> = { ...issueCategories, unknown: '待确认' };
export const attentionProfiles = {
  maintenance: { label: '维护优先', weights: { priority: 45, freshness: 25, discussion: 15, idle: 15 } },
  response: { label: '响应优先', weights: { priority: 25, freshness: 20, discussion: 30, idle: 25 } },
} as const;
export const signalCategoryOrder: VisualIssueCategory[] = ['bug', 'feature', 'question', 'documentation', 'performance', 'compatibility', 'security', 'other', 'unknown'];

type CategorySignal = { category: VisualIssueCategory; source: string; reason: string; provisional: boolean; stale: boolean };
const labelAliases: Record<IssueCategory, string[]> = {
  bug: ['bug', 'defect', 'regression', '缺陷', '错误'],
  feature: ['feature', 'feature request', 'enhancement', '功能', '功能建议'],
  question: ['question', 'support question', '使用咨询', '问题咨询'],
  documentation: ['docs', 'documentation', '文档'],
  performance: ['performance', 'perf', '性能'],
  compatibility: ['compatibility', '兼容性'],
  security: ['security', 'vulnerability', '安全'],
  other: ['other', '其他'],
};
const titlePatterns: [IssueCategory, RegExp][] = [
  ['security', /\b(?:cve-\d{4}-\d+|vulnerability|xss|csrf|sql injection|security flaw)\b|安全漏洞|鉴权绕过/i],
  ['performance', /\b(?:performance|slow|latency|memory leak|high cpu)\b|性能|内存泄漏|卡顿/i],
  ['compatibility', /\b(?:compatib(?:ility|le)|(?:php|laravel|symfony|node|python)\s+v?\d+(?:\.\d+)*)\b|兼容|版本适配/i],
  ['documentation', /\b(?:documentation|readme|docs|documentaci[oó]n)\b|文档|说明书/i],
  ['feature', /\b(?:feature request|enhancement|proposal|suggestion|add|implement|impl[eé]mente|agregar|ajouter)\b|新增|功能建议|希望增加/i],
  ['bug', /\b(?:bug|error|crash(?:es|ed)?|exception|broken|fails?|failing|regression)\b|doesn['’]t work|does not work|not working|报错|崩溃|不起作用|无法/i],
  ['question', /\b(?:how (?:to|do|can)|why|question|help with|c[oó]mo|por qu[eé]|comment (?:utiliser|faire))\b|如何|怎么|为什么|[?？]$/i],
];

/** Visual hints are separate from saved triage and are never written back. */
export function issueCategorySignal(item: GitItem): CategorySignal {
  const fields = issueClassification(item);
  if (fields.category) return {
    category: fields.category, provisional: !item.triage?.review?.category || fields.stale, stale: fields.stale,
    source: `${fields.stale ? '历史' : ''}${item.triage?.review?.category ? '维护者确认' : 'AI 分析'}`,
    reason: item.triage?.review?.category ? '来自维护者保存的分类确认。' : '来自已保存的 AI 分诊，仍需维护者核对。',
  };
  const labels = item.labels.map(label => ({ raw: label, normalized: label.toLowerCase().replace(/^(?:type|kind|category)[\s:/-]+/, '').trim() }));
  const matchedLabels = (Object.keys(labelAliases) as IssueCategory[]).flatMap(category => {
    const match = labels.find(label => labelAliases[category].includes(label.normalized));
    return match ? [{ category, label: match.raw }] : [];
  });
  if (matchedLabels.length === 1) return { category: matchedLabels[0].category, provisional: true, stale: false, source: '标签线索', reason: `GitHub 标签“${matchedLabels[0].label}”匹配类别词表；未替代维护者分诊。` };
  if (matchedLabels.length > 1) return { category: 'unknown', provisional: true, stale: false, source: '多类线索', reason: `标签同时指向${matchedLabels.map(match => issueCategories[match.category]).join('、')}，保留待确认。` };
  if (issueTitleNeedsContext(item.title)) return { category: 'unknown', provisional: true, stale: false, source: '信息待核对', reason: '标题过短或仅为链接，需阅读正文后确认类别。' };
  const matches = titlePatterns.filter(([, pattern]) => pattern.test(item.title)).map(([category]) => category);
  if (matches.length === 1) return { category: matches[0], provisional: true, stale: false, source: '标题线索', reason: `标题匹配“${issueCategories[matches[0]]}”词表规则，仅用于导航，不是 AI 分析或已确认类别。` };
  return { category: 'unknown', provisional: true, stale: false, source: matches.length > 1 ? '多类线索' : '信息待核对', reason: matches.length > 1 ? `标题同时含${matches.map(category => issueCategories[category]).join('、')}线索，保留待确认。` : '没有可用的已保存分类或明确标签、标题线索。' };
}

export type AttentionPart = { key: 'priority' | 'freshness' | 'discussion' | 'idle'; label: string; points: number | null; maximum: number; reason: string };
export type IssueAttention = { known: number; unknown: number; parts: AttentionPart[] };

/** A transparent viewing heuristic, not severity, confidence, or predicted impact. */
export function issueAttention(item: GitItem, profile: AttentionProfile, asOf: number): IssueAttention {
  const fields = issueClassification(item);
  const weights = attentionProfiles[profile].weights;
  const comments = issueDiscussion(item);
  const updated = Date.parse(item.updatedAt);
  const days = Number.isFinite(updated) && updated <= asOf ? Math.floor((asOf - updated) / 86_400_000) : undefined;
  const priorityRatio = { high: 1, medium: .55, low: .2, unknown: 0 };
  const priorityKnown = fields.priority !== 'unknown' && !fields.stale;
  const parts: AttentionPart[] = [
    { key: 'priority', label: '已有优先级', maximum: weights.priority, points: priorityKnown ? Math.round(weights.priority * priorityRatio[fields.priority]) : null, reason: fields.stale ? '原文更新，历史优先级需核对，暂不计入。' : priorityKnown ? `高／中／低分别取本项权重的 100%／55%／20%，来源：${item.triage?.review?.priority ? '维护者确认' : 'AI 建议'}。` : '优先级待判断，保留未知，不视为低优先级。' },
    { key: 'freshness', label: '分析时效', maximum: weights.freshness, points: item.triage ? fields.stale ? weights.freshness : 0 : null, reason: item.triage ? fields.stale ? '分诊后原文更新，需重新核对。' : '分诊对应当前原文，未发现版本过期。' : '尚未分析，无法比较分诊与原文版本。' },
    { key: 'discussion', label: '讨论量', maximum: weights.discussion, points: comments === undefined ? null : Math.round(weights.discussion * Math.min(1, Math.log2(1 + comments) / 5)), reason: comments === undefined ? '评论数未知，不当作零。' : `${comments} 条评论；按 log₂(1 + 评论数) / 5 计算，31 条及以上封顶。讨论量不表示严重程度。` },
    { key: 'idle', label: '静置时长', maximum: weights.idle, points: days === undefined ? null : Math.round(weights.idle * Math.min(1, days / 90)), reason: days === undefined ? '更新时间缺失、无效或位于未来，暂不计入。' : `距上次更新 ${days} 天，按天数 / 90 计算，90 天封顶；不代表维护者尚未回复。` },
  ];
  return { known: parts.reduce((sum, part) => sum + (part.points ?? 0), 0), unknown: parts.reduce((sum, part) => sum + (part.points === null ? part.maximum : 0), 0), parts };
}

export type IssueVisualSignal = { classification: CategorySignal; attention: IssueAttention };
export type IssueMapSignals = {
  byUrl: ReadonlyMap<string, IssueVisualSignal>;
  counts: Partial<Record<VisualIssueCategory, number>>;
  category: VisualIssueCategory | 'all';
  onCategory: (category: VisualIssueCategory | 'all') => void;
  profile: AttentionProfile;
  onProfile: (profile: AttentionProfile) => void;
  attentionSorted: boolean;
};
