import { BookMarked, BookOpen, CircleAlert, CircleDot, Files, FlaskConical, GitPullRequest, Info, KeyRound, LayoutDashboard, LayoutGrid, LifeBuoy, Lightbulb, OctagonAlert, Rocket, Route, ScanLine, Server, SlidersHorizontal, TriangleAlert, Workflow, type LucideIcon } from 'lucide-react';
import type { DocIcon } from './catalog';
import type { CalloutKind } from './remark-docs';

const chapterIcons: Record<DocIcon, LucideIcon> = {
  home: BookOpen, rocket: Rocket, concepts: Lightbulb, modules: LayoutGrid, overview: LayoutDashboard, audit: ScanLine,
  journey: Route, issues: CircleDot, pulls: GitPullRequest, maintenance: FlaskConical, drafts: Files, settings: SlidersHorizontal,
  workflows: Workflow, help: LifeBuoy, deploy: Server, config: KeyRound, reference: BookMarked,
};

export function ChapterIcon({ icon, size = 18 }: { icon: DocIcon; size?: number }) {
  const Icon = chapterIcons[icon];
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

export const callouts: Record<CalloutKind, { label: string; Icon: LucideIcon }> = {
  note: { label: '说明', Icon: Info },
  tip: { label: '提示', Icon: Lightbulb },
  important: { label: '重要', Icon: CircleAlert },
  warning: { label: '注意', Icon: TriangleAlert },
  caution: { label: '警告', Icon: OctagonAlert },
};
