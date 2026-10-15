# 部署与运行

## 开发与生产

开发：`npm run dev` 同时启动 Web、体检、复现和维护 Agent Worker。生产：`npm run build` 后 `npm start`。已有 Web 时，体检使用 `npm run worker`，维护 Agent 使用 `npm run agent-worker`；所有进程必须共享同一个 SQLite 文件和主密钥。维护会话与固定源码工具见 [MAINTENANCE_AGENT.md](MAINTENANCE_AGENT.md)。

体检队列使用逐任务租约。进程中断后，过期任务最多自动领取 3 次。文件收集完成后保存快照；体检恢复时使用同一快照并重新运行规则和 AI，不恢复模型内部会话。维护 Agent 使用独立租约和完整轮次的消息检查点。旧串行体检 Worker 不应与新 Worker 混跑。

## 容器

准备 .env.local，设置 OAuth、SMTP、模型、固定主密钥与正式 REPOCARE_APP_URL。执行：

```sh
docker compose up --build -d
```

Web 绑定宿主机 127.0.0.1:3000。通过 Nginx/Caddy 等反向代理提供 HTTPS，转发正确 Host，关闭 SSE 缓冲，并按来源 IP 对 /api/auth 和任务/模型接口限流。Compose 强制登录，数据保存于 repocare-data 卷。不要把 SQLite 放在跨机器共享网络文件系统上。

当前 Dockerfile 为可运行的单机打包方案，保留 Worker 运行所需依赖；尚未做最小镜像优化。发布前执行实际镜像构建与运行验证。

## 健康检查与日志

GET /api/health 返回数据库和 Worker 状态；Worker 离线返回 503。Worker 输出任务开始/结束结构化日志，不输出模型密钥。该接口是存活探针，不包含业务记录。模型请求和 token 统计在概览展示；自定义端点没有可靠价格时不估算费用。

## 备份与恢复

`npm run backup` 使用 SQLite 在线备份 API，保存到已忽略的 backups/时间目录，并复制本地 .model-key（未使用环境主密钥时）。该目录包含敏感数据，不上传 Git。

恢复时停止所有 Web/Worker，保存当前数据库备份后恢复 SQLite 和配套密钥；确认没有混用旧 WAL/SHM 文件再启动。环境变量主密钥须另行安全保存。恢复操作不会自动执行。

`npm run cleanup` 只预览保留期外的终态任务；完成备份后可运行 `npm run cleanup -- --apply`。默认 90 天，可设置 REPOCARE_RETENTION_DAYS，最低 7 天。被草稿引用的任务保留。没有配置操作系统定时任务，需按运维计划调用该命令。
