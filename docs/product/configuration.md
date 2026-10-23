# 账户与配置

先配置当前任务真正需要的连接。浏览公开仓库和基础体检可先开始；模型分析、私有仓库访问、隔离验证和发布各有独立条件。

## 登录与 GitHub 授权

“工作区设置 → GitHub 账户”用于查看账户、仓库访问与发布权限。GitHub 登录和授权仓库访问是不同步骤；登录成功不等于已经取得写入权限。私有仓库读取或发布前，按页面提示完成仓库授权，并确认该 GitHub 用户实际拥有目标仓库所需权限。

匿名会话、邮箱账户和 GitHub 账户是不同身份，数据不会自动合并。开始长期使用前先确定登录身份；清除匿名会话 Cookie 后，可能无法再访问原会话数据。

邮箱登录需要部署管理员配置 SMTP。注册后按邮件完成验证；忘记密码时使用重置流程，不要重复注册来尝试找回旧工作区。

## 配置模型连接

1. 打开“工作区设置 → 模型连接”，添加连接。
2. 按模型服务商说明选择协议，填写服务地址、模型名称和 API Key。基础地址不能误填成完整的生成接口路径。
3. 保存后运行连接测试；涉及工具调用的任务还需要工具往返能力正常。测试会发起真实请求，可能产生费用。
4. 将可用连接设为默认，再返回原任务开始分析。

**预期结果**：连接测试有明确结果，默认连接指向你选择的模型。保存成功仅表示配置已保存。上下文和输出预算按页面说明填写，不要把未知额度设成无限；用量统计以服务商返回信息为准。

连接失败时，先核对协议、地址、模型标识和密钥权限，再查看错误摘要。不要为了重试而连续新建多个连接；处理方法见[常见问题](troubleshooting.md)。

## 确认项目专属规则

在设置中的项目专属规则区域，可以从仓库读取候选约定或手动编辑。检查规则来源、适用版本、标签名称、必需字段和检查名称，确认后保存，供 Issue 分诊和 PR 审查使用。

规则中的命令用于表达项目约定，保存规则不会自动执行命令。仓库规范改变时重新核对规则，避免模型按过时约定评价贡献者。

## 管理员配置参考

以下为 `.env.example` 暴露的产品配置项。修改后重新启动相关服务；密钥保留在服务端配置中，不要写入文档、截图或 Git 仓库。

| 配置项 | 默认或未配置行为 | 用途 |
| --- | --- | --- |
| `REPOCARE_APP_URL` | `http://127.0.0.1:3000` | 真实访问地址及登录回调基础地址 |
| `REPOCARE_DB_PATH` | `data/repocare.sqlite` | Web 与 Worker 共用的数据库路径 |
| `REPOCARE_REQUIRE_LOGIN` | `false`；附带 Compose 强制为 true | 是否要求登录 |
| `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth 应用；回调路径为 `/api/auth/github/callback` |
| `REPOCARE_GITHUB_TOKEN` | 空 | 服务端 GitHub 读取令牌；不能代替用户发布授权 |
| `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` | 空 | 邮箱验证与密码重置邮件 |
| `SMTP_PORT`、`SMTP_SECURE` | `587`、`false` | 按邮件服务商要求配置端口与 TLS 方式 |
| `REPOCARE_MASTER_KEY` | 空时使用数据库目录的 `.model-key` | 模型密钥加密；指定时使用 64 位十六进制值并保持稳定 |
| `REPOCARE_AI_PROVIDER`、`REPOCARE_AI_MODEL`、`REPOCARE_AI_API_KEY`、`REPOCARE_AI_BASE_URL` | 空 | 可选的环境级体检模型配置；日常优先通过模型连接界面配置 |
| `REPOCARE_RETENTION_DAYS` | `90` | 历史数据清理期限，最低 7 天 |
| `REPOCARE_REPRO_ENABLED` | `false` | 是否启用隔离验证 |
| `REPOCARE_REPRO_IMAGE` | `repocare-repro-runner:local` | 隔离执行镜像 |
| `REPOCARE_REPRO_ARTIFACTS` | `data/reproduction` | 验证日志及证据目录 |
| `REPOCARE_REPRO_ALLOW_NETWORK` | `false` | 是否允许经审阅的依赖准备阶段联网 |
| `REPOCARE_REPRO_MAX_SECONDS` | `180` | 隔离执行时间预算 |

## 数据与外部服务

模型分析会把任务所需的仓库内容或证据发送给你选择的模型服务；使用私有仓库前，应确认该服务符合你的数据使用要求。隔离 Runner 不注入 GitHub Token，当前复现范围限公开 GitHub HTTPS 仓库。

报告、任务、草稿等保存在服务端数据库；外观等偏好保存在当前浏览器。退出登录不等于清空服务端数据。数据库与加密主密钥应配套备份，见[备份与恢复](deployment.md)。
