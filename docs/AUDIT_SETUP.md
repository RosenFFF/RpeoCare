# RepoCare 真实项目体检

## 启动

要求 Node.js 24+。在项目根目录执行：

```powershell
npm ci
npm run dev
```

访问 http://127.0.0.1:3000/audit。该命令同时启动 Web 与独立 Worker。已有 Web 进程时，只运行 `npm run worker` 即可。`npm run build` 后使用 `npm start` 可启动本机生产模式；这是持续运行的 Node 服务，不适合直接部署为有执行时限的无状态函数。

Worker 与 Web 使用同一个工作目录和 SQLite 文件。支持同机多 Worker，逐任务租约防止重复领取；进程意外退出后恢复已保存快照，最多自动领取 3 次。排队任务继续执行。服务停止时排队任务不会凭空完成。

## 第一次体检

1. 在项目体检面板输入一个公开 GitHub 仓库，例如 `https://github.com/octocat/Hello-World`。
2. 提交后观察右侧执行轨迹中的读取仓库、收集文件、规范检查、Agent 分析、生成报告五个阶段；体检执行期间仓库地址会锁定，可随时停止任务。
3. 在执行轨迹中点击阶段，查看摘要和文件依据。节点成功是执行成功，不代表检查全部通过。
4. 完成后查看报告并导出 JSON 或 Markdown。刷新页面或从历史任务中重新打开报告；报告完成后页面不再提供追问输入框。
5. 对需要改进的检查项进入“规范改进”，在文档维护工作台中选择文档资产，查看草稿来源，编辑内容并在编辑、预览、Diff 三种视图之间切换。

## 文档维护工作台

规范改进页提供一组面向维护者的文档资产工作区。它会根据最近一次体检报告生成 README、贡献指南以及 Issue／PR 模板等可编辑 Markdown 草稿，并保留生成草稿对应的检查项、任务和证据来源，方便回到报告核对依据。

工作台支持保存修改、重新生成草稿和下载 Markdown 文件。编辑器、渲染预览和前后 Diff 可独立切换，便于在发布前检查改动范围。文件草稿发布时会创建独立分支和 Draft PR，必须由维护者明确确认；Issue 评论和 PR 审阅草稿仍沿用各自的发布确认流程。

当前版本的预览和 Diff 用于内容审阅，不会执行目标仓库的命令，也不会自动合并或直接修改默认分支。许可证内容、CI 执行结果和需要维护者决策的安全策略仍须人工确认。

只有报告持久化完成后，才返回完成状态。SSE 连接断开不会停止 Worker；重连会取得最新完整快照，漏掉中间事件也不会丢失最终状态。

## 页面配置模型

打开 `/settings` 的模型连接，填写名称、服务商、协议、基础地址、模型 ID，选择填写新密钥后保存。第一个连接默认用于新任务；连接测试会验证模型工具调用及结果回传。支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages，允许自定义模型别名。测试及体检可能产生模型费用。

密钥用 AES-256-GCM 加密保存在服务端；默认主密钥为数据库同目录的 `.model-key`，也可设置 `REPOCARE_MASTER_KEY`（64 位十六进制）。备份数据库时保留相应主密钥，不要直接替换或丢失。Web 和 Worker 必须共享主密钥。Windows 目录权限依赖当前账户与 ACL。连接按浏览器 Cookie 隔离，清除 Cookie 后不能通过原会话访问。

任务入队时保存加密配置快照，后续编辑或删除连接不改变该任务；任务结束后删除配置快照。报告仅保留模型元数据，不返回密钥。没有保存的默认连接时回退到以下环境变量。

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

- 读取公开 GitHub 仓库或已授权私有仓库的所选分支，首次读取后固定到同一 commit SHA。
- 8 项确定性检查：README、许可证文件、贡献指南、Issue 模板、PR 模板、GitHub Actions、测试脚本、代码规范配置。
- 工程脚本分析支持根目录 Node.js，另识别 Python/Go/Java 测试文件及常见多语言代码规范配置；存在不等于执行通过。
- 单次优先读取最多 11 份维护文件，每份不超过 100 KB，总内容不超过 300 KB。目录截断、读取失败、未分析范围均保留说明。
- Agent 工具仅包含 `list_files`、`read_file`、`search_files`，访问范围是已收集快照，不访问本机文件、不执行代码、不修改仓库。
- Agent 最多 7 轮、18 次工具调用、90 秒；报告只分析 README 可用性、贡献说明可用性、文档与命令一致性，并核验引用原文。
- 配置存在不代表可以运行；本版本不声称测试通过、不做许可证法律判断或完整代码安全审计。
- 文件收集后保存快照，服务中断可从快照重跑规则和 AI；“重新体检”创建新任务并读取新的提交版本，旧记录保留。

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

接口使用 HttpOnly、SameSite 会话 Cookie 隔离浏览器任务，所有查询都检查归属；写操作校验同源。本地匿名模式不是账户认证；配置 GitHub 或邮箱登录后使用持久账户。每会话最多两个活动任务，每小时最多 30 个任务，总队列最多 20 个。

## 数据与部署

SQLite 文件及其 WAL/SHM 辅助文件位于已忽略的 `data/` 目录，备份时使用 SQLite 备份方式或停止 Web/Worker 后整体复制。可使用 cleanup 命令预览和清理过期历史，见 DEPLOYMENT.md。

当前默认只监听本机 `127.0.0.1`。在正式开放公网前，必须启用账户认证、配置持久卷、HTTPS 和反向代理限流；匿名浏览器限额不应被当作公网防滥用机制。同机多 Worker 共用 SQLite；跨机器部署仍需独立共享数据库和队列。

## 验证

```powershell
npm run test
npm run typecheck
npm run build
```

自动测试使用临时数据库和可控 GitHub/模型响应，不依赖真实 Token 或模型额度。真实公开仓库和浏览器的验证记录见 `QA.md`。
