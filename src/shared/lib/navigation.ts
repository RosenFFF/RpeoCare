import { LayoutDashboard, ScanLine, CircleDot, GitPullRequest, Files, SlidersHorizontal, Bot } from "lucide-react";

export const navigation = [
  { id: "overview", label: "项目概览", english: "Overview", href: "/overview", icon: LayoutDashboard },
  { id: "audit", label: "项目体检", english: "Project audit", href: "/audit", icon: ScanLine },
  { id: "issues", label: "Issue 分诊", english: "Issue triage", href: "/issues", icon: CircleDot, count: 3 },
  { id: "pull-requests", label: "PR 检查", english: "Pull requests", href: "/pull-requests", icon: GitPullRequest, count: 2 },
  { id: "improvements", label: "草稿与交付", english: "Drafts and delivery", href: "/improvements", icon: Files },
  { id: "settings", label: "工作区设置", english: "Settings", href: "/settings", icon: SlidersHorizontal },
  { id: "agent", label: "项目 Agent", english: "Repository agent", href: "/agent", icon: Bot },
] as const;
export type ViewId = typeof navigation[number]["id"];
export function isView(value: string): value is ViewId { return navigation.some(item => item.id === value); }
