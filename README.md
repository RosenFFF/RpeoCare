# RepoCare · 开源项目维护工作台

面向开源项目维护者的前端原型。以浅色背景、清晰的深色文字与日夜主题为视觉基调，采用任务列表、证据详情、草稿审阅组成的轻量工作台。

## 运行

需要 Node.js 20.9 或更高版本（本次使用 Node.js 24 验证）。

在此目录打开终端：

```bash
npm install
npm run dev
```

打开 http://localhost:3000 。如果端口被占用：

```bash
npm run dev -- --port 3001
```

生产构建与类型检查：

```bash
npm run typecheck
npm run build
npm start
```

## 当前范围

这是可以点击、编辑、筛选和下载的**前端壳**，数据来自虚构的 `repocare-demo / csv-kit`，不是已接入真实仓库的产品。

| 页面 | 路由 | 已实现交互 |
|---|---|---|
| 产品首页 | `/` | 独立 C 形品牌雕塑、拖动与视角跟随、日夜主题、开始使用、演示入口 |
| 登录 / 注册 | `/?auth=login`、`/?auth=register` | GitHub/Gitee/GitLab 入口、邮箱表单校验、密码显隐、未开通提示 |
| 项目概览 | `/overview` | 待办分类、统计、直达条目、改进建议 |
| 项目体检 | `/audit` | 12 条预置检查、分类、证据展开、演示刷新 |
| Issue 分诊 | `/issues` | 搜索、筛选、原文、结构化详情、编辑草稿、本地确认 |
| PR 检查 | `/pull-requests` | 搜索、筛选、Diff、检查结果、审核意见、确认记录 |
| 规范改进 | `/improvements` | 3 份文件草稿、Diff、接受/恢复、下载真实文件 |
| 工作区设置 | `/settings` | 工作区名称、语言偏好、插件配置、保存/恢复默认 |

还包括：全局快速跳转（Ctrl/⌘ + K）、通知面板、使用指南、仓库连接草稿、移动导航、空状态、操作反馈和键盘焦点管理。

## 外观与导航

- 全站共用冷灰白、石墨色与低饱和松绿：`--action` / `--action-hover` / `--on-action` 控制主要操作，`--accent` 用于品牌与选中状态，`--focus` 控制键盘焦点。夜间主按钮为浅银灰。配色集中在 `src/app/appearance.css`，首页不再单独硬编码按钮颜色。
- 顶栏左侧的侧栏按钮可收起/展开桌面导航。收起后保留图标、待办数量与悬停名称。
- 顶栏右侧太阳／月亮图标一键切换白天与夜晚模式。页面背景、侧栏、弹窗、表单、标签和 Diff 同步适配。
- 主题与桌面侧栏状态保存在 `openbridge.appearance.v1`，刷新、切换页面后保留。手机继续使用完整的抽屉导航。
- 切换按钮支持键盘 Enter / Space；旧三色主题偏好自动按白天模式显示，保留侧栏状态。

深链接示例：`/issues?issue=39`、`/pull-requests?pr=45`、`/improvements?draft=bug-template`。

## 数据和演示边界

- 首页与登录注册使用同一展示布局；`/login`、`/register` 会重定向到对应表单。忘记密码入口为 `/?auth=reset`。
- **认证仅完成界面与本地校验，未接入 OAuth、数据库或邮件服务。** 提交不会创建账号、发送邮件或授予登录状态，不会将输入的邮箱、密码写入浏览器存储或发送到服务器。
- 可通过“体验演示”进入 `/overview`；该路由是公开演示，不是受认证保护的用户工作区。真实认证的接入范围见 `AUTH_INTEGRATION.md`。
- 没有 GitHub/Gitee OAuth、Token 请求、远程同步、模型调用、测试执行或后端服务。
- 体检、AI 分析和 PR 检查是明确标注的静态示例。刷新体检只刷新预置结果和演示时间。
- “确认”“接受”只更新浏览器状态，不会发送评论、修改仓库或合并 PR。
- 下载按钮会生成所选 `.md`/`.yml` 文件；文件内容仍是演示草稿，需要按实际项目核对。
- 插件与语言偏好是后端接入前的配置界面；当前不加载 Agent 插件，也不会翻译页面。
- 项目名称、连接草稿、偏好使用 `localStorage`；Issue/PR/规范的草稿与确认使用 `sessionStorage`，关闭当前浏览会话后可重置。
- 未登录账户；Maintainer 头像代表本地演示身份。

## 技术栈

- Next.js 16 App Router / React 19 / TypeScript。
- Lucide 图标、RepoCare 品牌标志和 Three.js 交互维护地图。
- 原生 CSS，自定义色彩、间距、响应式和组件样式，无外部字体或图片请求。
- 独立视图文件，后续可逐步替换为 FastAPI 返回的数据。

## 代码结构

```text
src/
  app/
    layout.tsx               页面元数据与全局样式
    page.tsx                 首页
    [view]/page.tsx           其余视图路由与404检查
    globals.css              主题、导航、首页、弹窗、响应式
    appearance.css           配色变量、收起侧栏、日夜按钮
  components/
    landing-page.tsx          产品首页与账号面板切换
    landing-page.css          首页、表单、响应式视觉
    auth-panel.tsx            登录 / 注册 / 找回密码表单
    brand-sculpture.tsx       首页独立品牌雕塑组件
    brand-scene.ts           开放 C 形缎带建模与按需渲染
    repo-exhibit.tsx          工作台概览的维护地图展示
    workspace.tsx            工作台壳、导航、弹窗、toast
    theme-picker.tsx         可键盘操作的日夜切换按钮
    views/
      overview-view.tsx       概览与待办
      audit-view.tsx          项目体检
      issues-view.tsx         Issue列表和详情
      pull-requests-view.tsx  PR列表和审核
      improvements-view.tsx   文件Diff与下载
      settings-view.tsx       浏览器设置
      *-views.css             各页面样式
  lib/
    auth-client.ts           未配置认证适配边界（当前不发起网络请求）
    navigation.ts            导航与视图类型
    use-demo-counts.ts       共享演示统计
    appearance.ts            配色定义、存储与首屏初始化
    use-appearance.ts        外观偏好与跨标签页同步
```

## 后端接入建议

1. 保留视图，将 `checks`、`ISSUES`、`PULL_REQUESTS`、`drafts` 逐步移到统一的数据访问层。
2. 先接只读仓库/Issue API，再接真实的体检与分诊任务状态。
3. 让每条分析结果具有来源、时间、真实状态（完成/失败/无法判断），替换演示文案。
4. 接入 FastAPI 的异步任务或 SSE 后，才把演示刷新替换为真实任务执行。
5. 所有对外写操作单独设置服务端授权、审批与审计；前端确认不能代替后端权限校验。
6. 当前不需要 Python–pi-agent 桥接代码；后续应先核实具体 pi 包和运行时，再确定后端边界。

## 维护建议

- 不在组件内硬编码 API 密钥。
- 保留 `package-lock.json`，其他机器优先用 `npm ci` 复现。
- 本地演示状态不适合作为正式数据库；实际用户数据需由服务端管理。
- 浏览器检查记录见 `QA.md`。

## RepoCare 品牌与 3D 概览

- 新 Logo 结合仓库分支节点与环抱形 C，侧栏、概览和浏览器图标保持一致。
- 概览使用本地生成的 Three.js 模型：带夹层与代码符号的立体文件夹、开放 C 形金属环，以及气泡、合并分支、折角文档、盾牌四种维护造型。
- 拖动旋转、节点/底部按钮选择、摘要跳转、暂停/继续、视角复位；任务数量沿用已有演示会话数据。
- 三维材质随日夜模式更新。Three.js 按需加载，像素比例限制为 1.6；离屏及隐藏标签页停止绘制，卸载释放资源。
- 遵循减少动态效果设置；WebGL 不可用或丢失时保留可操作的简洁视图。触屏画布允许纵向页面滚动。
- 代码：`src/components/project-showcase.tsx`、`project-showcase.css`、`repo-scene.ts`、`brand-mark.tsx`。
- 该场景呈现演示维护分类，不代表后台 Agent 正在执行任务。
