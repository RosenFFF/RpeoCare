# 项目架构

RepoCare 由 Next.js Web、体检 Worker、复现 Worker 和维护 Agent Worker 共用本地 SQLite。保持单仓库、单 package.json，便于本地开发和部署。

## 目录职责

| 目录 | 职责 | 修改示例 |
| --- | --- | --- |
| `src/app` | URL、页面装配、API 入口、全局样式 | 新增路由或接口 |
| `src/features` | 按功能聚合 React 页面组件与样式 | 修改体检界面到 `audit/` |
| `src/components/workspace` | 工作台外壳、功能视图装配 | 修改全局导航 |
| `src/server/audit` | 仓库采集、规则、Agent、任务持久化 | 新增检查规则 |
| `src/server/agent` | 维护会话、固定提交源码工具、检查点、项目知识和交付物 | 扩展调查工具及任务恢复 |
| `src/server/journey` | 从固定快照生成贡献路径演练计划 | 调整命令提取规则 |
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

项目概览保留 3D 维护地图，并在维护观测中展示真实报告的结果构成、类别分布和最近十二份成功报告的变化；图表联动最多三项后续事项，并可带筛选打开完整报告。未知状态保留独立语义，历史口径不一致时不推断改善幅度，详见 [OVERVIEW_INSIGHTS.md](OVERVIEW_INSIGHTS.md)。草稿数量来自当前项目；Issue / PR 数量通过独立 GitHub 请求获取，区分加载、零值和不可用，不阻塞报告展示。概览定时刷新并响应工作区切换与体检完成事件。模型、OAuth、SMTP 和公网部署仍需外部配置。真实工作台模块见 server/auth、server/github、server/workbench 以及 features/workbench。


## 维护 Agent 执行链

现有分诊、PR 审查、文档生成动作 → 请求内的只读 pi 工具循环 → 固定提交源码与协作上下文 → 原有结构化结果及读取依据。Issue、PR、体检报告和文档草稿详情中的深入处理动作 → SQLite 持久队列 → 独立 Agent Worker → 阶段结论、补丁、回复草稿和待确认执行计划。结果留在对应业务页面，导航没有独立 Agent 模块。阶段可补充、停止和继续，知识由用户确认保存及停用；复现与补丁对照验证复用隔离执行器。实现、恢复与资源边界见 [MAINTENANCE_AGENT.md](MAINTENANCE_AGENT.md)。

## Issue 复现执行链

Issue 正文与评论 → AI 严格 JSON 计划 → 服务端安全校验 → 维护者人工确认 → SQLite 队列 → 独立复现 Worker → 固定 Git commit → Docker Runner 三次执行 → 机器判据与 SHA-256 证据。Web 进程不执行仓库代码；执行阶段网络关闭，Docker 不可用时不回退宿主机。详细边界见 [REPRODUCTION.md](REPRODUCTION.md)。

## 贡献路径验证执行链

体检固定快照 → README、CONTRIBUTING 与项目清单中的受支持命令 → 服务端安全校验 → 维护者核对命令及来源 → SQLite 队列 → 独立复现 Worker → 同一固定 commit 的 Docker Runner → 单次安装、测试与代码检查 → 分步退出码和 SHA-256 证据。贡献路径复用 Issue 复现的隔离执行器与制品存储，但使用独立任务语义和 `all-steps-pass` 判据。依赖准备可以在显式配置后受限联网；验证阶段断网。概览只显示当前项目最近一次验证状态，详细计划、执行状态和证据留在体检页的贡献路径标签中。


## PR 审查执行链

真实页面 → `/api/workbench/review` → GitHub head/base 与前 100 个文件、CI/Status、最多 3 条关联需求 → 有界模型上下文 → Zod + Diff 坐标/原文校验 → SQLite 报告与人工事件历史 → 维护者筛选 → 草稿工作台 → 发布前版本校验 → GitHub COMMENT。PR 代码不执行，Docker 无前置依赖。详见 PR_REVIEW.md。


## 维护收件列表（2026-10-05）

Issue 与 PR 使用 `features/workbench/review-inbox.tsx` 共用筛选、分页和详情导航，默认分别进入分诊工作地图与 PR 分支目录；PR 选择目标分支后进入变更图，也可切换精确列表。`issue-work-map.tsx` 按下一步处理动作提供总览、分组聚焦与依据面板，`issue-map-model.ts` 仅根据已有处理状态和原文更新时间分流；默认阅读视图保持正常字号，探索画布按需复用缩放与平移，issue-visual-signals.ts 负责独立的类别线索及可解释关注分，统一接入筛选、排序和批量范围；`pull-branch-atlas.tsx` 读取真实分支并支持目录分页，`branch-orbit-field.tsx` 以固定的可访问按钮展示分支星港，`branch-orbit-scene.ts` 按需加载 Three.js 绘制可暂停、离屏释放的装饰环带并在失败时退回静态 SVG；PR 列表使用 base 参数按目标分支分页；`pull-map-model.ts` 计算全部 PR 节点与布线通道，`pull-confluence.tsx` 在同一画布中将带详细信息的节点汇向目标分支，`use-pr-canvas.ts` 管理鼠标锚点缩放、拖拽与全图适应，`pull-voyage.tsx` 管理选中节点的观察与按需证据读取；`maintenance-pulse.tsx` 负责两类入口装配。列表接口将 SQLite 中与当前 head SHA 匹配的 PR 审查摘要合入 GitHub 数据，并用已保存的显式关联建立 Issue↔PR 证据桥。未知 CI 和过期审查不被推断为通过。分类纯函数位于 inbox-model.ts，PR 信号边界位于 pull-voyage-model.ts，视图不改变已有详情、分析、人工确认和发布边界。详见 REVIEW_INBOX.md。


## 规范改进与草稿审阅（2026-10-07）

`features/drafts` 管理分类列表与全宽审阅，`shared/lib/draft-diff`、`draft-quality` 为纯比较与校验，服务端 `draft-quality`、`draft-publication` 提供有界快照依据与只读交付核对。草稿 API 按项目先过滤后分页，成功报告复用 overview 的仓库/分支查询；版本表以兼容方式创建，旧草稿仍可读取。单文件及 2–4 文件 Draft PR 发布沿用实际权限/基准校验，批次 SQLite 状态原子迁移。详见 DRAFT_WORKSPACE.md。

## 模型连接配置改进（2026-10-07）

模型设置以默认概览、连接列表、显式新增/编辑组织，防同名/同目标误建，并保留旧重复项安全原位编辑。服务商字段说明与基础端点预设在 shared/lib/model-connection；不包含秘密，不发起自动平台发现。存储事务保证保存/明确设默认一致；现有账号模型连接不自动合并删除。详见 MODEL_CONNECTIONS.md。
