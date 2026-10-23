# 部署与运维

RepoCare 的网页和 API 由同一个 Next.js 应用提供，后台 Worker 负责执行任务。首次部署建议先完成本地启动，再按需配置登录和模型。以下容器及公网步骤是基于仓库配置的部署指引，需要在你的目标环境验收。

## 环境准备

需要 Node.js 24、npm，以及访问 GitHub 的网络。执行模型任务还需要访问对应模型服务。Docker 只在容器部署或隔离验证时需要。

在项目根目录执行以下命令，先确认 Node 版本，再安装锁文件中的依赖：

```sh
node --version
npm ci
```

首次配置时，将 `.env.example` 复制为 `.env.local`；已有配置应保留并补充缺失项，不能覆盖。环境变量说明见[账户与配置](configuration.md)。

## 本地启动

```sh
npm run dev
```

默认访问 `http://127.0.0.1:3000`。此命令同时启动网页、体检 Worker、维护 Agent Worker 和复现 Worker；复现功能仍需另外启用和准备 Docker。终端关闭或按 Ctrl+C 后，这组服务停止。

日常演示可使用构建后的版本：

```sh
npm run build
npm start
```

需要使用 3001 端口时，Windows PowerShell 在启动前执行：

```powershell
$env:PORT = '3001'
npm start
```

macOS/Linux 的对应启动命令为 `PORT=3001 npm start`。同步将 `.env.local` 中的 `REPOCARE_APP_URL` 设置为实际访问地址；OAuth 回调也要匹配这个地址。

只运行 `npm run start:web` 会启动页面和 API，不会启动任务 Worker。若页面可访问而任务一直排队，检查是否误用了这个命令。

## 容器部署

先准备 `.env.local`，配置 GitHub OAuth 或 SMTP 邮箱登录。附带的 Compose 会强制要求登录；未准备登录方式就启动，会导致无法正常进入工作区。

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail 100 web worker agent-worker
```

默认入口是 `http://127.0.0.1:3000`。Compose 启动 `web`、`worker`、`agent-worker`，它们共享 `repocare-data` 数据卷。保留这个卷才能保留数据库和本地主密钥。

**附带 Compose 不包含复现 Worker，也不启用 Docker 隔离执行**。需要隔离验证时，使用下节的本机部署方式，或另行设计并验收执行环境。不要把网页服务启动成功当作 Runner 已就绪。

## 启用隔离验证

本机部署需要已运行的 Docker Engine 或 Docker Desktop。在项目根目录构建执行镜像：

```sh
npm run repro:image
```

在 `.env.local` 设置 `REPOCARE_REPRO_ENABLED=true`，然后重新启动完整服务。确认复现 Worker 在线、镜像存在，再从产品中审阅计划并提交执行。

默认禁止网络访问。确实需要安装依赖时，由管理员设置 `REPOCARE_REPRO_ALLOW_NETWORK=true`，用户仍须审阅具体依赖准备步骤；验证阶段保持离线。执行范围和失败含义见[工作流](workflows.md)。

## 检查服务是否可用

打开 `/api/health`，正常结果包括 `status: "ok"`、`database: true` 和 `worker: true`。其中 Worker 检查针对体检 Worker，**不代表模型、GitHub 登录、Agent Worker 或 Docker 已验证成功**。

部署验收依次检查：页面能打开；登录可用；公开仓库能连接；一次基础体检能完成；需要的模型连接测试通过；启用隔离验证时能读取执行状态。写回权限只在明确选择测试目标并确认发布时验证。

## 公网运行

公开提供服务前，配置 HTTPS 反向代理、正确的 `REPOCARE_APP_URL` 和登录方式，并限制登录、模型调用和任务创建的请求频率。代理应保留正确 Host，并支持不缓冲的 SSE 事件流，否则进度可能延迟显示。

当前队列基于同机共享 SQLite；不能直接将多个独立服务器的数据库各自运行后当作分布式部署。公网部署还需管理员自行验收域名、证书、邮件和 OAuth 配置。

## 备份与恢复

```sh
npm run backup
```

脚本使用 SQLite 在线备份，将结果写入 `backups/` 下的时间目录，并在使用本地密钥文件时一并复制 `.model-key`。如果使用环境变量 `REPOCARE_MASTER_KEY`，应另行安全保存同一个值。复现证据目录和 `.env.local` 不包含在数据库备份中，需要单独备份。

恢复时先停止 Web 和全部 Worker，保留当前数据副本，再按备份恢复数据库及配套密钥；不要混用旧数据库的 WAL/SHM 文件。启动后检查健康状态、历史任务和模型连接解密是否正常。首次恢复演练应在独立目录和端口进行，确认可用后再替换正式数据。

## 升级与清理

升级前备份，停止服务，保存当前版本号；更新代码后执行 `npm ci` 和 `npm run check`，成功后重启。若升级失败，保留故障日志；回退时使用相匹配的旧代码和升级前备份，不能假定旧程序兼容升级后的数据库。

```sh
npm run cleanup
```

清理默认只预览。确认预览范围并完成备份后，才执行 `npm run cleanup -- --apply`。保留天数由 `REPOCARE_RETENTION_DAYS` 控制，默认 90 天，最低 7 天。实际清理会删除历史数据，不能用作解决页面故障的通用方法。
