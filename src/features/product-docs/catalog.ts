export const docGroups = [
  { id: 'start', title: '开始使用' },
  { id: 'guides', title: '功能指南' },
  { id: 'practice', title: '实践与排查' },
  { id: 'admin', title: '部署与管理' },
  { id: 'reference', title: '参考' },
] as const;

export type DocGroupId = typeof docGroups[number]['id'];
export type DocIcon = 'home' | 'rocket' | 'concepts' | 'modules' | 'overview' | 'audit' | 'journey' | 'issues' | 'pulls' | 'maintenance' | 'drafts' | 'settings' | 'workflows' | 'help' | 'deploy' | 'config' | 'reference';

export interface DocChapter { slug: string; file: string; group: DocGroupId; title: string; nav?: string; description: string; icon: DocIcon }

/** Order here is the reading order: sidebar, previous/next links and search all follow it. */
export const docChapters: readonly DocChapter[] = [
  { slug: '', file: 'README.md', group: 'start', title: 'RepoCare 使用手册', nav: '文档首页', description: '了解 RepoCare 能做什么，按任务或角色找到要读的章节。', icon: 'home' },
  { slug: 'quickstart', file: 'quickstart.md', group: 'start', title: '快速开始', description: '约 15 分钟：连接仓库、完成第一次体检、保存第一份草稿。', icon: 'rocket' },
  { slug: 'concepts', file: 'concepts.md', group: 'start', title: '核心概念', description: '固定快照、证据、建议与确认——理解 RepoCare 如何得出每个结论。', icon: 'concepts' },
  { slug: 'modules', file: 'modules.md', group: 'guides', title: '功能总览', description: '工作区布局、各页面分工，以及所有页面共用的操作约定。', icon: 'modules' },
  { slug: 'overview', file: 'overview.md', group: 'guides', title: '项目概览', description: '查看项目状态与维护变化，从近期记录回到具体任务。', icon: 'overview' },
  { slug: 'audit', file: 'audit.md', group: 'guides', title: '项目体检', description: '在固定提交上检查文档、协作规范与工程配置，导出可追溯报告。', icon: 'audit' },
  { slug: 'contributor-path', file: 'contributor-path.md', group: 'guides', title: '贡献路径验证', description: '在隔离环境里检验新贡献者能否按文档完成安装、测试和检查。', icon: 'journey' },
  { slug: 'issues', file: 'issues.md', group: 'guides', title: 'Issue 分诊', description: '用关注矩阵排序反馈，完成 AI 分诊、人工确认、回复与复现。', icon: 'issues' },
  { slug: 'pull-requests', file: 'pull-requests.md', group: 'guides', title: 'PR 检查', description: '用审查航道找到卡住的变更，分块 AI 审查并筛选发现。', icon: 'pulls' },
  { slug: 'maintenance', file: 'maintenance.md', group: 'guides', title: '维护调查与对照验证', description: '围绕一个问题准备候选补丁，并用同一测试对比两个版本。', icon: 'maintenance' },
  { slug: 'drafts', file: 'drafts.md', group: 'guides', title: '草稿与交付', description: '编辑、校验并交付文档改进、Issue 回复和 PR 评论。', icon: 'drafts' },
  { slug: 'settings', file: 'settings.md', group: 'guides', title: '工作区设置', description: '模型连接、GitHub 授权、项目专属规则与本地偏好。', icon: 'settings' },
  { slug: 'workflows', file: 'workflows.md', group: 'practice', title: '工作流与最佳实践', description: '四个完整维护场景，以及控制成本、保留记录的做法。', icon: 'workflows' },
  { slug: 'troubleshooting', file: 'troubleshooting.md', group: 'practice', title: '常见问题', description: '按现象排查启动、连接、模型、执行和发布问题。', icon: 'help' },
  { slug: 'deployment', file: 'deployment.md', group: 'admin', title: '部署与运维', description: '本地运行、容器部署、隔离执行、备份恢复与升级。', icon: 'deploy' },
  { slug: 'configuration', file: 'configuration.md', group: 'admin', title: '管理员配置', description: '登录方式、环境变量与数据处理说明。', icon: 'config' },
  { slug: 'reference', file: 'reference.md', group: 'reference', title: '术语、状态与限额', description: '界面词汇、状态含义、处理上限与功能边界速查。', icon: 'reference' },
];

export function docHref(slug: string) { return slug ? `/docs/${slug}` : '/docs'; }

export function chapterByFile(file: string) { return docChapters.find(item => item.file === file); }

export function docLink(href: string) {
  const [file, anchor] = href.split('#');
  if (!file && anchor) return `#${anchor}`;
  const chapter = chapterByFile(file);
  if (chapter) return `${docHref(chapter.slug)}${anchor ? `#${anchor}` : ''}`;
  if (/^\.\.\/[A-Z_]+\.md$/.test(file)) {
    return `https://github.com/RosenFFF/RpeoCare/blob/main/docs/${file.slice(3)}${anchor ? `#${anchor}` : ''}`;
  }
  return href;
}

/** Markdown keeps repository-relative image paths so it also renders on GitHub; the site serves them from `public/`. */
export function docAsset(src: string) {
  return src.startsWith('../../public/') ? src.slice('../../public'.length) : src;
}

export function headingId(text: string) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}

/** Heading ids shared by the outline, the search index and the rendered page; repeats get a numeric suffix. */
export function uniqueId(text: string, used: Map<string, number>) {
  const base = headingId(text) || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

export const docSourceUrl = 'https://github.com/RosenFFF/RpeoCare/blob/main/docs/product/';
