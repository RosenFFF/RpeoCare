# 部署与运维

RepoCare 的网页和 API 由同一个 Next.js 应用提供，耗时任务交给三个后台 Worker。本章说明如何在本机运行、用容器部署、启用隔离执行，以及日常的检查、备份、恢复和升级。

> [!NOTE]
> 本机运行步骤与仓库脚本一致。容器部署和公网运行是基于仓库配置的部署指引，需要在你的目标环境中自行验收。

## 进程组成

| 进程 | npm 脚本 | 负责 |
| --- | --- | --- |
| Web | `dev:web` / `start:web` | 网页与 API，默认只监听 `127.0.0.1` |
| 体检 Worker | `worker` | 项目体检任务 |
| 维护 Agent Worker | `agent-worker` | PR 分块审查、维护调查 |
| 复现 Worker | `repro-worker` | Docker 隔离执行；需另外启用 |

所有进程通过同一个 SQLite 数据库协作，必须运行在同一台机器上、使用同一个 `REPOCARE_DB_PATH`。

## 环境准备

- **Node.js 24 或更高版本**和 npm；
- 能访问 GitHub 的网络，使用模型时还需要能访问对应的模型服务；
- Docker 只在容器部署或启用隔离执行时需要。

在项目根目录确认 Node 版本，然后按锁文件安装依赖：

```sh
node --version
npm ci
```

首次配置时，把 `.env.example` 复制为 `.env.local`。已有的 `.env.local` 请保留，只补充缺少的配置项，不要整个覆盖。各配置项见[管理员配置](configuration.md)。

## 本地启动

开发和日常试用：

```sh
npm run dev
```

默认访问 `http://127.0.0.1:3000`。这一条命令会同时启动网页和三个 Worker；关闭终端或按 `Ctrl` + `C` 后，全部服务一起停止。复现 Worker 会运行，但隔离执行仍需按[下文](#启用隔离执行)启用。

演示或长期运行时，使用构建后的版本：

```sh
npm run build
npm start
```

**更换端口**：在 Windows PowerShell 中，启动前设置环境变量：

```powershell
$env:PORT = '3001'
npm start
```

macOS / Linux 使用 `PORT=3001 npm start`。同时把 `.env.local` 中的 `REPOCARE_APP_URL` 改成实际访问地址，OAuth 回调地址也要一致。

> [!WARNING]
> 只运行 `npm run start:web` 只会启动网页和 API，不会启动任何 Worker。页面能打开但任务一直排队时，先检查是否误用了这个命令。

## 容器部署

先准备 `.env.local`，并配置 GitHub OAuth 或 SMTP 邮箱登录——附带的 Compose 强制要求登录，没有登录方式将无法进入工作区。

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail 100 web worker agent-worker
```

默认入口是 `http://127.0.0.1:3000`。Compose 启动 `web`、`worker` 和 `agent-worker` 三个服务，它们共享 `repocare-data` 数据卷；保留这个数据卷才能保留数据库和本地主密钥。

> [!IMPORTANT]
> 附带的 Compose **不包含复现 Worker，也不启用 Docker 隔离执行**。需要隔离验证时，请使用本机部署，或另行设计并验收执行环境。网页服务启动成功不代表 Runner 已就绪。

## 启用隔离执行

Bug 复现、贡献路径验证和对照验证都需要在 Docker 中运行仓库代码。

1. 确认本机已运行 Docker Engine 或 Docker Desktop。
2. 在项目根目录构建执行镜像：

```sh
npm run repro:image
```

3. 在 `.env.local` 中设置 `REPOCARE_REPRO_ENABLED=true`，然后重新启动完整服务。
4. 在工作区确认复现 Worker 在线（例如 Issue 详情的复现区域会显示“队列 Worker 在线”“Docker 沙箱已启用”）。
5. 从产品中审阅一份计划并提交执行，作为验收。

**网络策略**：默认禁止任何网络访问。确实需要安装依赖时，管理员可以设置 `REPOCARE_REPRO_ALLOW_NETWORK=true`，此时只有依赖准备阶段可以联网，并且用户仍须逐条审阅依赖步骤；验证阶段始终断网。

**时间预算**：`REPOCARE_REPRO_MAX_SECONDS` 控制单次执行的时间预算，默认 180 秒，有效范围 30–300 秒。

**资源限制**：每个容器限制为 2 个 CPU、2 GB 内存、256 个进程，使用只读根文件系统并禁止提升权限。

## 检查服务是否可用

打开 `/api/health`，正常结果包括 `status: "ok"`、`database: true` 和 `worker: true`。

> [!NOTE]
> 这里的 `worker` 只代表体检 Worker。健康检查**不验证**模型连接、GitHub 登录、维护 Agent Worker 或 Docker。

### 部署验收清单

- [ ] 页面能打开，`/api/health` 正常
- [ ] 登录方式可用（GitHub OAuth 或邮箱）
- [ ] 能连接一个公开仓库
- [ ] 一次基础体检能完成
- [ ] 需要的模型连接测试通过
- [ ] 启用隔离执行时，能读取执行状态并完成一次计划
- [ ] 写回权限只在选定测试仓库、明确确认发布时验证

## 公网运行

公开提供服务前：

- 配置 HTTPS 反向代理，设置正确的 `REPOCARE_APP_URL` 和登录方式；
- 代理需保留正确的 `Host`，并支持**不缓冲的 SSE 事件流**，否则进度可能延迟显示；
- 限制登录、模型调用和任务创建的请求频率；
- 自行验收域名、证书、邮件和 OAuth 配置。

当前队列基于同机共享的 SQLite，不能把多台服务器各自运行的数据库当作分布式部署。

## 备份与恢复

```sh
npm run backup
```

脚本使用 SQLite 在线备份，把结果写入 `backups/` 下按时间命名的目录；使用本地密钥文件时会一并复制 `.model-key`。

> [!CAUTION]
> 数据库和加密主密钥必须配套保存。使用环境变量 `REPOCARE_MASTER_KEY` 时，请另外安全保存同一个值；丢失主密钥后，已保存的模型连接将无法解密。复现证据目录和 `.env.local` 不在数据库备份中，需要单独备份。

**恢复步骤**

1. 停止 Web 和全部 Worker。
2. 保留当前数据的副本。
3. 用备份恢复数据库和配套密钥。不要混用旧数据库的 `-wal` / `-shm` 文件。
4. 启动后检查健康状态、历史任务，以及模型连接能否正常解密。

首次恢复演练请在独立目录和端口进行，确认可用后再替换正式数据。

## 升级与清理

**升级**

1. 备份，停止服务，记下当前版本号。
2. 更新代码后执行 `npm ci` 和 `npm run check`。
3. 检查通过后重新启动。

升级失败时保留故障日志。回退需要使用匹配的旧代码和升级前的备份，不能假定旧程序兼容升级后的数据库。

**清理历史数据**

```sh
npm run cleanup
```

清理默认只预览。确认预览范围并完成备份后，再执行 `npm run cleanup -- --apply`。保留天数由 `REPOCARE_RETENTION_DAYS` 控制，默认 90 天，最少 7 天。实际清理会删除历史数据，不能用作解决页面故障的通用方法。
