# 项目架构

RepoCare 当前是一个 Next.js 应用和一个独立 Node.js Worker，共用本地 SQLite。保持单仓库、单 package.json，便于本地开发和部署；尚不需要拆成多个服务或 monorepo。

## 目录职责

| 目录 | 职责 | 修改示例 |
| --- | --- | --- |
| `src/app` | URL、页面装配、API 入口、全局样式 | 新增路由或接口 |
| `src/features` | 按功能聚合 React 页面组件与样式 | 修改体检界面到 `audit/` |
| `src/components/workspace` | 工作台外壳、功能视图装配 | 修改全局导航 |
| `src/server/audit` | 仓库采集、规则、Agent、任务持久化 | 新增检查规则 |
| `src/server/models` | 模型连接、加密、运行时适配 | 新增模型协议 |
| `src/server/reproduction` | Bug 复现计划校验、SQLite 队列、Docker 执行器 | 新增复现模式或隔离策略 |
| `reproduction` | Runner 镜像与沙箱内 Playwright/测试执行入口 | 调整证据采集 |
| `src/contracts` | 可跨前后端共享的类型、枚举和纯定义 | 调整报告数据结构 |
| `src/shared` | 可复用组件、浏览器逻辑和公共样式 | 修改主题和通用交互 |
| `scripts` | 命令行入口 | Worker 生命周期 |
| `tests/audit`、`tests/models` | 业务测试，含隔离 SQLite 和 mock 模型 | 验证任务取消、密钥与工具调用 |
| `docs` | 架构、配置、开发及历史验证说明 | 记录实现边界 |

组件优先在功能目录内部复用。只有被多个功能使用的代码才移入 `shared`。服务端代码从 `server` 导入；客户端只能导入 `contracts` 的纯定义，不得从 `server` 导入运行时实现。

## 体检执行链

浏览器 → Next.js Route Handler → SQLite 队列 → 独立 Worker → GitHub 固定提交快照 → 规则检查 → 可选 pi Agent → 报告落库。浏览器通过 SSE 获取阶段进度。

pi Agent 通过 npm SDK 接入，版本由锁文件固定。旁边的 `pi-agent` 源码目录仅作参考，不是运行依赖，不复制进本仓库。GitHub 源码同步由开发者工具的 Git/SSH 完成，与产品内只读 GitHub API 体检是两条独立链路。

## 状态和数据

- `data/repocare.sqlite` 保存体检任务、报告和加密模型配置。
- `data/.model-key` 是本地加密主密钥。备份或迁移数据库时必须配套保存；配置了环境变量主密钥时也需保持一致。
- `.env.local` 存放本地配置，禁止提交；`.env.example` 只包含配置示例。
- 浏览器 cookie 隔离任务与模型连接；保持同一访问域名和端口可以继续使用原有浏览器会话。
- `.next`、`node_modules`、测试临时文件和本地运行数据不属于版本化源码。

工作台入口 `/workspace` 按当前项目状态跳转：优先恢复当前项目成功报告或首次执行任务，已有项目但无报告时进入概览引导；首次 GitHub 登录且尚未连接项目时进入 `/projects` 仓库选择页，匿名/邮箱无项目时仍进入体检。项目选择不自动创建任务或调用模型，详见 [PROJECT_SELECTION.md](PROJECT_SELECTION.md)。概览仅显示当前仓库与分支的最近成功报告；首次未完成时显示引导，重新体检、失败或取消时保留上次成功结果。报告直接按项目查询，不受历史列表分页影响。

项目概览保留原有 3D 维护地图，检查项来自真实报告，草稿数量来自当前项目。Issue / PR 数量通过独立 GitHub 请求获取，区分加载、零值和不可用，不阻塞报告展示；概览定时刷新并响应工作区切换与体检完成事件。模型、OAuth、SMTP 和公网部署仍需外部配置。真实工作台模块见 server/auth、server/github、server/workbench 以及 features/workbench。


## Issue 复现执行链

Issue 正文与评论 → AI 严格 JSON 计划 → 服务端安全校验 → 维护者人工确认 → SQLite 队列 → 独立复现 Worker → 固定 Git commit → Docker Runner 三次执行 → 机器判据与 SHA-256 证据。Web 进程不执行仓库代码；执行阶段网络关闭，Docker 不可用时不回退宿主机。详细边界见 [REPRODUCTION.md](REPRODUCTION.md)。


## PR 审查执行链

真实页面 → `/api/workbench/review` → GitHub head/base 与前 100 个文件、CI/Status、最多 3 条关联需求 → 有界模型上下文 → Zod + Diff 坐标/原文校验 → SQLite 报告与人工事件历史 → 维护者筛选 → 草稿工作台 → 发布前版本校验 → GitHub COMMENT。PR 代码不执行，Docker 无前置依赖。详见 PR_REVIEW.md。


## 维护收件列表（2026-10-05）

Issue 与 PR 使用 `features/workbench/review-inbox.tsx` 共用收件列表，不再各自采用双栏/卡片布局。列表的快捷视图、搜索、维度筛选、排序和分页属于同一工作区；记录按内容自然收缩，点击后进入全宽详情，返回恢复筛选和焦点。分类纯函数位于 inbox-model.ts，布局独立于已有详情/服务端审查逻辑。详见 REVIEW_INBOX.md。
