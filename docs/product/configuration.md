# 管理员配置

本章面向部署管理员：如何配置登录方式、环境变量的含义与默认值，以及 RepoCare 如何处理数据。普通用户需要的模型连接、GitHub 授权和项目规则在界面中配置，见[工作区设置](settings.md)。

所有配置写在项目根目录的 `.env.local` 中（从 `.env.example` 复制）。修改后需要重新启动相关服务。

> [!CAUTION]
> 这些配置只在服务端使用。不要给任何密钥加 `NEXT_PUBLIC_` 前缀，也不要把 `.env.local`、密钥或其截图写入文档或提交到 Git 仓库。

## 选择登录方式

| 方式 | 适合 | 需要配置 |
| --- | --- | --- |
| 免登录（匿名会话） | 个人在本机使用 | 默认即可，`REPOCARE_REQUIRE_LOGIN=false` |
| GitHub 登录 | 需要私有仓库或发布到 GitHub | GitHub OAuth 应用的 Client ID 和 Secret |
| 邮箱登录 | 团队成员没有或不想使用 GitHub 登录 | SMTP 邮件服务 |

公开部署前，请设置 `REPOCARE_REQUIRE_LOGIN=true`（附带的 Docker Compose 已强制开启），并至少配置一种登录方式。

### 配置 GitHub OAuth

1. 在 GitHub 的 Developer settings 中新建一个 OAuth App。
2. **Homepage URL** 填写 RepoCare 的访问地址，与 `REPOCARE_APP_URL` 一致。
3. **Authorization callback URL** 填写 `<REPOCARE_APP_URL>/api/auth/github/callback`，例如本机为 `http://127.0.0.1:3000/api/auth/github/callback`。
4. 把生成的 Client ID 和 Client Secret 写入 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`，重启服务。

协议、主机名和端口三者都必须与浏览器实际访问的地址一致，否则回调会失败。

### 配置邮箱登录

填写 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD` 和 `SMTP_FROM`。用户注册后需要按邮件完成验证；忘记密码时使用重置流程，不要重复注册来找回旧工作区。

## 环境变量参考

### 基础

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `REPOCARE_APP_URL` | `http://127.0.0.1:3000` | 真实访问地址，也是登录回调的基础地址 |
| `REPOCARE_DB_PATH` | `data/repocare.sqlite` | Web 与所有 Worker 共用的数据库路径 |
| `REPOCARE_REQUIRE_LOGIN` | `false`（Compose 中为 `true`） | 是否要求登录才能进入工作区 |
| `REPOCARE_RETENTION_DAYS` | `90` | 历史数据清理期限，最少 7 天 |
| `PORT` | `3000` | 启动端口，见[更换端口](deployment.md#本地启动) |

### GitHub

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth 应用 |
| `REPOCARE_GITHUB_TOKEN` | 空 | 服务端读取 GitHub 的令牌，用于提高匿名请求的额度。只用于读取，不能代替用户的发布授权 |

### 邮件

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` | 空 | 邮箱验证与密码重置邮件 |
| `SMTP_PORT`、`SMTP_SECURE` | `587`、`false` | 按邮件服务商要求配置端口与 TLS |

### 模型与加密

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `REPOCARE_MASTER_KEY` | 空，此时使用数据库目录下的 `.model-key` | 加密已保存的模型密钥和 GitHub 凭据。指定时使用 64 位十六进制值，并且**必须保持不变** |
| `REPOCARE_AI_PROVIDER`、`REPOCARE_AI_MODEL`、`REPOCARE_AI_API_KEY` | 空 | 可选的服务端模型连接。用户没有选择账户默认模型时使用 |
| `REPOCARE_AI_BASE_URL` | 空 | 可选，覆盖上述模型的服务地址，一般留空 |

服务端模型的服务商和模型 ID 必须在内置的模型目录中。可以运行 `npm run agent:models -- <服务商>` 列出可用的模型 ID，这条命令不会发起模型调用。日常使用更推荐让用户在界面中配置[模型连接](settings.md#配置模型连接)。

### 隔离执行

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `REPOCARE_REPRO_ENABLED` | `false` | 是否启用 Docker 隔离执行 |
| `REPOCARE_REPRO_IMAGE` | `repocare-repro-runner:local` | 执行镜像，由 `npm run repro:image` 构建 |
| `REPOCARE_REPRO_ARTIFACTS` | `data/reproduction` | 执行日志与证据目录 |
| `REPOCARE_REPRO_ALLOW_NETWORK` | `false` | 是否允许经过审阅的依赖准备阶段联网；验证阶段始终断网 |
| `REPOCARE_REPRO_MAX_SECONDS` | `180` | 单次执行的时间预算，有效范围 30–300 秒 |

## 数据与外部服务

**发送给模型的内容**：模型分析会把任务需要的仓库内容、Issue 原文或证据发送给用户选择的模型服务。用于私有仓库前，请确认该服务符合你的数据使用要求。

**隔离执行**：Runner 不注入 GitHub Token，当前复现只支持公开 GitHub 仓库（HTTPS 地址）。仓库代码永远不会在宿主机上执行。

**数据存放位置**

| 数据 | 位置 |
| --- | --- |
| 报告、任务、草稿、模型连接、项目规则 | 服务端数据库 |
| 模型密钥 | 服务端数据库，使用主密钥加密，界面不回显 |
| 复现日志与证据 | `REPOCARE_REPRO_ARTIFACTS` 目录 |
| 外观、侧栏、本地工作区偏好、通知已读状态 | 用户的浏览器 |

退出登录不会清空服务端数据。数据库与主密钥需要配套备份，见[备份与恢复](deployment.md#备份与恢复)。
