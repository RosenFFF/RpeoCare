# 账户与授权

## GitHub

创建 GitHub OAuth App，回调地址为 REPOCARE_APP_URL + /api/auth/github/callback。本地示例：http://127.0.0.1:3000/api/auth/github/callback。

配置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、REPOCARE_APP_URL。登录默认申请 read:user；设置中的仓库授权会申请 repo，以读取私有仓库和写入。用户在 GitHub 页面决定是否批准，实际发布仍校验仓库 push 权限。

实现包括 state Cookie、一次性服务端 state、PKCE S256、令牌加密保存、随机会话令牌哈希、HttpOnly/SameSite Cookie、退出。账户以 GitHub 数字 ID 识别，不按昵称合并。

## 邮箱

配置 SMTP_HOST、SMTP_PORT、SMTP_SECURE、SMTP_USER、SMTP_PASSWORD、SMTP_FROM。邮件链接使用固定 REPOCARE_APP_URL。SMTP 要求 TLS。注册密码至少 10 位，scrypt 加盐保存；验证和重置链接 30 分钟有效、单次使用；密码重置后撤销已有会话。接口有数据库请求限额，公网仍须反向代理按真实来源 IP 限流。

## 身份与权限边界

REPOCARE_REQUIRE_LOGIN=true 时工作区和业务 API 要求登录；Compose 默认启用。本地默认允许匿名会话读取公开仓库。账号与匿名会话互相隔离；登录后不会自动把匿名任务与模型连接移入账户。

邮箱账户和 GitHub 账户也不自动关联；使用不同方式登录会进入不同工作区。Gitee/GitLab 按钮仍提示未接入。账号合并、多因素认证、管理员管理界面未实现。

## 验收

配置真实 OAuth App 后需验证登录成功/拒绝/过期/回调不匹配，私有仓库读取和最小权限。配置 SMTP 后需验证实际邮件送达、链接使用及过期。模拟测试不能替代提供商验收。
