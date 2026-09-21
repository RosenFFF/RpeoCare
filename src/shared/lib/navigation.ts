import { LayoutDashboard, ScanLine, CircleDot, GitPullRequest, Files, SlidersHorizontal } from "lucide-react";

export const navigation = [
  { id: "audit", label: "项目体检", english: "Project audit", href: "/audit", icon: ScanLine },
  { id: "overview", label: "项目概览", english: "Overview", href: "/overview", icon: LayoutDashboard },
  { id: "issues", label: "Issue 分诊", english: "Issue triage", href: "/issues", icon: CircleDot, count: 3 },
  { id: "pull-requests", label: "PR 检查", english: "Pull requests", href: "/pull-requests", icon: GitPullRequest, count: 2 },
  { id: "improvements", label: "规范改进", english: "Improvements", href: "/improvements", icon: Files },
  { id: "settings", label: "工作区设置", english: "Settings", href: "/settings", icon: SlidersHorizontal },
] as const;
export type ViewId = typeof navigation[number]["id"];
export function isView(value: string): value is ViewId { return navigation.some(item => item.id === value); }
