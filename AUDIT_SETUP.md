# RepoCare 真实项目体检

## 启动

要求 Node.js 24+。在项目根目录执行：

```powershell
npm ci
npm run dev
```

访问 http://127.0.0.1:3000/audit。该命令同时启动 Web 与独立 Worker。已有 Web 进程时，只运行 `npm run worker` 即可。`npm run build` 后使用 `npm start` 可启动本机生产模式；这是持续运行的 Node 服务，不适合直接部署为有执行时限的无状态函数。

Worker 与 Web 使用同一个工作目录和 SQLite 文件。默认单 Worker 串行执行任务，数据库租约防止重复领取；进程意外退出，租约过期后重启会将上次中断任务标记失败，用户可重新体检。排队任务继续执行。服务停止时排队任务不会凭空完成。

## 第一次体检

1. 输入一个公开 GitHub 仓库，例如 `https://github.com/octocat/Hello-World`。
2. 点击开始，观察读取仓库、收集文件、规范检查、Agent 分析、生成报告五个节点。
3. 点击节点查看本步骤的摘要和依据。节点成功是执行成功，不代表检查全部通过。
4. 完成后查看动态检查结果，并导出 JSON 或 Markdown。刷新页面或从历史任务中重新打开报告。

只有报告持久化完成后，才返回完成状态。SSE 连接断开不会停止 Worker；重连会取得最新完整快照，漏掉中间事件也不会丢失最终状态。

## 服务端配置

复制 `.env.example` 为 `.env.local`，编辑后重新启动 Web 和 Worker。不要将真实密钥提交 Git；不要使用 `NEXT_PUBLIC_` 前缀。

| 变量 | 用途 |
|---|---|
| `REPOCARE_GITHUB_TOKEN` | 可选；提高 GitHub API 额度，不会让本版本开放私有仓库 |
| `REPOCARE_AI_PROVIDER` | pi-ai 内置服务商目录中的名称 |
| `REPOCARE_AI_MODEL` | 该服务商目录中的模型 ID |
| `REPOCARE_AI_API_KEY` | 对应服务商的 API 密钥 |
| `REPOCARE_AI_BASE_URL` | 可选服务端端点覆盖，通常留空；只填写可信端点 |
| `REPOCARE_DB_PATH` | 默认 `data/repocare.sqlite`，Web 和 Worker 必须一致 |

查看当前安装版本支持的模型：

```powershell
npm run agent:models
npm run agent:models -- deepseek
```

按目录输出填写实际拥有权限的 provider/model，模型目录不代表账户有额度。启用模型后，每次体检会将已收集的公开文件片段发送给配置的服务商，并可能产生模型费用。未配置时跳过 Agent，仍提供真实基础检查。配置不合法、模型超时或引用校验失败会明确标注，不生成虚假的成功报告。

本次使用核验过接口的 pi-agent-core / pi-ai 0.73.1；npm 已提示该包作用域后续迁移至 `@earendil-works`。当前实现锁定版本，避免未经验证的 SDK 迁移。无需安装 pi coding CLI，也不会加载用户本机 coding agent 凭据。

## 检查范围

- 仅读取公开 GitHub 仓库默认分支，首次读取后固定到同一 commit SHA。
- 8 项确定性检查：README、许可证文件、贡献指南、Issue 模板、PR 模板、GitHub Actions、测试脚本、代码规范配置。
- 工程脚本分析当前支持根目录 Node.js 项目；其他语言和需要深入分析的子项目明确标记无法判断。
- 单次优先读取最多 11 份维护文件，每份不超过 100 KB，总内容不超过 300 KB。目录截断、读取失败、未分析范围均保留说明。
- Agent 工具仅包含 `list_files`、`read_file`、`search_files`，访问范围是已收集快照，不访问本机文件、不执行代码、不修改仓库。
- Agent 最多 7 轮、18 次工具调用、90 秒；报告只分析 README 可用性、贡献说明可用性、文档与命令一致性，并核验引用原文。
- 配置存在不代表可以运行；本版本不声称测试通过、不做许可证法律判断或完整代码安全审计。
- 当前没有跨步骤断点续跑；“重新体检”创建新任务并读取新的提交版本，旧记录保留。

## HTTP 接口

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/audit/capabilities` | Worker 在线、模型配置存在性、GitHub Token 存在性 |
| POST | `/api/audit/runs` | 输入 `{repoUrl}`，返回新任务（202） |
| GET | `/api/audit/runs?limit=8` | 当前浏览器会话的最近任务 |
| GET | `/api/audit/runs/:id` | 最新任务快照 |
| GET | `/api/audit/runs/:id/events` | SSE `snapshot` 事件，数据为完整 AuditRun，附递增 seq |
| GET | `/api/audit/runs/:id/report` | 已生成报告，否则 409 |
| POST | `/api/audit/runs/:id/cancel` | 取消并中断后续执行 |
| POST | `/api/audit/runs/:id/retry` | 新建任务，保留原任务 |

接口使用 HttpOnly、SameSite 会话 Cookie 隔离浏览器任务，所有查询都检查归属；写操作校验同源。它不是用户账户认证。每会话最多两个活动任务，每小时最多 30 个任务，总队列最多 20 个。

## 数据与部署

SQLite 文件及其 WAL/SHM 辅助文件位于已忽略的 `data/` 目录，备份时使用 SQLite 备份方式或停止 Web/Worker 后整体复制。暂未实现历史自动清理。

当前默认只监听本机 `127.0.0.1`。在正式开放公网前，需要完成账户认证、账户级配额、部署环境持久卷和 HTTPS；匿名浏览器限额不应被当作公网防滥用机制。多台机器/多 Worker 部署需要共享数据库与任务队列，不能复制本地 SQLite 到各实例独立执行。

## 验证

```powershell
npm run test
npm run typecheck
npm run build
```

自动测试使用临时数据库和可控 GitHub/模型响应，不依赖真实 Token 或模型额度。真实公开仓库和浏览器的验证记录见 `QA.md`。
