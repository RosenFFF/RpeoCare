# RepoCare · 开源项目维护工作台

围绕真实 GitHub 仓库开展体检、报告查看、Issue 分诊、PR 审阅和文档维护。AI 根据报告证据生成改进草稿，维护者可以在线编辑、预览和对比，审阅后明确确认发布。

## 本地启动

需要 Node.js 24。复制 .env.example 到 .env.local，按需配置模型、GitHub OAuth 和 SMTP。

```sh
npm ci
npm run dev
```

访问 http://127.0.0.1:3000/overview，连接仓库。公开仓库和基础规则无需模型；内容分析和草稿需要模型。GitHub 登录及写回需要自己的 OAuth 应用；邮箱验证和重置需要 SMTP。

## 功能

| 模块 | 当前能力 |
| --- | --- |
| 统一项目 | 连接真实仓库、指定分支、概览与历史任务、草稿统计 |
| 体检 | 固定提交快照、8 项基础检查、内容研判、文件证据、报告导出与跨文件改进依据核对 |
| 贡献路径验证 | 从固定快照的 README、CONTRIBUTING 和项目清单提取安装、测试与检查命令；维护者审阅后在隔离 Runner 中演练，并保留步骤证据 |
| 执行 | SSE、取消、新建重试、快照检查点恢复、同机共享 SQLite 的多 Worker |
| Issue / PR | Issue 问题地形图、随全局主题切换的 2D 分支导航、舒展的 PR 汇流图与 Issue↔PR 证据桥；保留可解释分诊、固定提交审查、结构化 AI 发现、CI/Status、Diff 证据校验和列表模式；分诊按需读取源码、引用证据与项目约定；详情内可继续调查并下载修复补丁；Bug 可生成复现计划并在 Docker/Playwright 隔离环境中三次验证、留存证据 |
| PR 证据化审查 | 固定 head/base、分块进度持久化、失败块重试、未审范围、Diff 坐标校验、Checks/Status、项目规则、人工筛选与 COMMENT 草稿；详情可深入核对关联源码 |
| 项目专属规则 | 从仓库读取候选或手动编辑，维护者确认后用于分诊和 PR 审查；展示字段、版本、标签、检查与来源依据 |
| 文档维护 | 从报告结合源码生成 README / CONTRIBUTING / Issue / PR 模板，核对已保存草稿的影响；文档资产导航、编辑／预览／Diff、来源追溯、保存、重新生成和下载 |
| GitHub 写回 | 确认后发布 Issue 评论、COMMENT 审阅或独立分支的草稿 PR；不自动合并 |
| 账户 | GitHub OAuth + PKCE、邮箱注册 / 验证 / 登录 / 密码重置、退出 |
| 模型 | 多协议配置、加密密钥、工具往返测试、调用及 token 用量 |
| 运维 | Lint、类型检查、单元/集成测试、浏览器回归脚本、CI、容器配置、健康检查、备份、清理 |

## 使用流程

1. 在概览连接仓库；私有仓库先在设置中授权 GitHub 仓库访问。
2. 在设置配置模型，运行连接测试。
3. 体检完成后阅读报告；在贡献路径页核对自动提取的命令，确认后由隔离 Runner 演练新贡献者的最小操作路径。
4. 在规范改进中选择检查项生成草稿；在文档维护工作台查看来源证据，在线编辑，并切换预览或 Diff 核对前后内容。
5. 保存、下载或重新生成草稿。文件类草稿经明确确认后创建独立分支和 Draft PR，不直接修改默认分支。
6. Issue / PR 页面生成的回复草稿也在规范改进中审阅。写入前检查 PR / 默认分支是否已有新提交。

## 工程结构

```text
src/app/                 页面与 API 入口
src/components/workspace/ 工作台外壳
src/features/            功能界面（workbench 为真实项目功能）
src/server/audit/        快照、规则、Agent、任务和 Worker 队列
src/server/agent/        持久维护会话、源码工具、项目知识与交付物
src/server/auth/         邮箱认证和邮件
src/server/github/       GitHub OAuth、读取、写回
src/server/workbench/    项目、草稿、分诊、PR 审查和模型使用量
src/server/journey/      贡献路径命令提取与演练计划生成
src/server/reproduction/  复现计划校验、队列与 Docker 执行器
reproduction/             最小权限 Runner 镜像与 Playwright 执行入口
src/server/models/       模型连接、加密与协议适配
src/contracts/           共享数据类型
src/shared/              共用组件、样式与浏览器工具
tests/                   audit、models、workbench、e2e
scripts/                 Worker、备份、清理和模型目录工具
docs/                    开发、架构、配置、验收边界
```

## 验证与维护

```sh
npm run check
npm run test:e2e
npm run backup
npm run cleanup
# 完成备份并确认后，才执行实际清理
npm run cleanup -- --apply
```

测试使用临时数据库和 mock 模型/GitHub，不发布测试内容。GitHub Actions 安装 Chromium 后执行浏览器回归。历史验证记录见 [QA](docs/QA.md)。

自动 Git 同步规则见 [AGENTS.md](AGENTS.md)。密钥、数据库、备份和构建产物不提交。

## 配置与边界

- [部署与运行](docs/DEPLOYMENT.md)
- [账户配置](docs/AUTH_INTEGRATION.md)
- [体检范围](docs/AUDIT_SETUP.md)
- [PR 分块审查](docs/PR_REVIEW_WORKFLOW.md)
- [项目专属规则](docs/PROJECT_RULES.md)
- [PR 审查历史记录](docs/PR_REVIEW.md)
- [项目维护 Agent](docs/MAINTENANCE_AGENT.md)
- [Bug 复现实验室](docs/REPRODUCTION.md)
- [实现与验收清单](docs/IMPLEMENTATION_STATUS.md)
- [架构](docs/ARCHITECTURE.md) / [开发约定](docs/DEVELOPMENT.md)

常规项目体检不会运行被检查仓库的代码。贡献路径与 Issue 复现都要求维护者先审阅计划并明确确认，随后才由独立 Worker 在 Docker Runner 中执行受限命令。Docker 未启用时安全阻塞，不回退宿主机。贡献路径绑定体检时的固定快照，依赖准备与断网验证分开执行；结果只说明该快照下被选中的最小路径是否走通。多语言支持是配置识别，不是全语言静态分析。文档工作台的预览和 Diff 只用于内容审阅，尚未接入 Markdown 链接、命令或渲染安全的完整自动检查。草稿保留原体检报告的来源信息，仍须由维护者核对证据后发布。旧任务没有文件快照时仍能阅读报告，生成替换草稿需重新体检。

GitHub、邮箱和匿名本地会话目前为独立身份空间，不按同名邮箱自动合并。Gitee/GitLab 尚未接入。多 Worker 只支持同机共享数据库，跨主机分布式部署尚需独立数据库和队列。公网部署必须配置 HTTPS、认证与反向代理限流。
