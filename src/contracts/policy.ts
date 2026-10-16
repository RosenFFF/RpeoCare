import type { IssueCategory } from './workbench';

export const policyKinds = ['required-field', 'supported-version', 'label-map', 'required-check', 'test-change', 'command', 'guidance'] as const;
export type PolicyKind = typeof policyKinds[number];
export const policyKindLabels: Record<PolicyKind, string> = { 'required-field': 'Issue 必填信息', 'supported-version': '支持的运行时版本', 'label-map': '标签分类', 'required-check': 'PR 必须检查', 'test-change': 'PR 测试变更', command: '项目验证命令', guidance: '维护约定' };
export const policyFields = { runtime: '运行时版本', platform: '操作系统 / 平台', reproduction: '复现步骤', expected: '预期行为', actual: '实际行为' } as const;
export interface PolicySource { kind: 'manual' | 'repository'; path?: string; commitSha?: string; excerpt?: string; line?: number }
export interface ProjectRule { id: string; kind: PolicyKind; title: string; value: string; field?: keyof typeof policyFields; category?: IssueCategory; appliesTo: 'issue' | 'pr' | 'both'; source: PolicySource }
export interface ProjectPolicy { revision: number; repoUrl: string; rules: ProjectRule[]; updatedAt: string; confirmedAt?: string }
export interface PolicyDocument { revision: number; active: ProjectPolicy | null; draft: ProjectPolicy | null }
export interface PolicyCheck { ruleId: string; title: string; status: 'met' | 'missing' | 'attention' | 'unknown' | 'reference'; detail: string; evidence?: string; source: PolicySource }
export interface PolicyAssessment { revision: number; confirmedAt: string; checks: PolicyCheck[] }
export interface PolicyObservation { ruleId: string; quote: string; value: string }
