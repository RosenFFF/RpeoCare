export const docChapters = [
  { slug: '', file: 'README.md', title: '产品文档', description: '了解 RepoCare，找到适合你的使用路径。' },
  { slug: 'quickstart', file: 'quickstart.md', title: '快速开始', description: '从连接仓库到保存第一份改进草稿。' },
  { slug: 'deployment', file: 'deployment.md', title: '部署与运维', description: '本地运行、容器部署、备份与恢复。' },
  { slug: 'configuration', file: 'configuration.md', title: '账户与配置', description: '准备账户、模型连接与项目专属规则。' },
  { slug: 'modules', file: 'modules.md', title: '模块操作指南', description: '逐个了解工作区页面的作用和操作。' },
  { slug: 'workflows', file: 'workflows.md', title: '工作流与最佳实践', description: '把证据、验证和交付串成完整维护流程。' },
  { slug: 'troubleshooting', file: 'troubleshooting.md', title: '常见问题', description: '按现象排查连接、执行和发布问题。' },
  { slug: 'reference', file: 'reference.md', title: '参考与功能边界', description: '查阅术语、状态含义和深入资料。' },
] as const;

export function docHref(slug: string) { return slug ? `/docs/${slug}` : '/docs'; }

export function docLink(href: string) {
  const [file, anchor] = href.split('#');
  const chapter = docChapters.find(item => item.file === file);
  if (chapter) return `${docHref(chapter.slug)}${anchor ? `#${anchor}` : ''}`;
  if (/^\.\.\/[A-Z_]+\.md$/.test(file)) {
    return `https://github.com/RosenFFF/RpeoCare/blob/main/docs/${file.slice(3)}${anchor ? `#${anchor}` : ''}`;
  }
  return href;
}

export function headingId(text: string) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}
