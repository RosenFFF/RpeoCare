# 开发约定

## 日常启动

在项目根目录使用 Node.js 24（见 `.nvmrc`）和 npm。提交 `package-lock.json`，安装使用 `npm ci`。

```sh
npm ci
npm run dev
```

`dev` 同时运行 Web、体检 Worker 和复现 Worker；复现功能默认关闭，访问 `http://127.0.0.1:3000/workspace`，首次进入体检，已有成功报告时进入概览。执行正式体检需要 Worker 在线。环境变量见 [体检部署说明](AUDIT_SETUP.md)。

## 代码组织

- 功能代码进入 `src/features/<功能>/`，文件沿用小写短横线命名，样式与组件就近放置。
- 服务端业务进入 `src/server/`，前后端协议进入 `src/contracts/`，路由只负责请求处理与装配。
- 遵循已有局部代码风格和 `.editorconfig`，避免为格式化重写无关文件。
- 对行为修改添加或更新有效测试；简单可逆的 UI 调整以类型检查和浏览器交互验证为主。
- 更新受影响的文档，确保演示功能和真实功能描述准确。

## 验证命令

```sh
npm run lint
npm run typecheck
npm test
npm run build
# 完整检查也可以一次运行
npm run check
```

`typecheck` 先运行 `next typegen`，因此新克隆也能生成路由类型。测试使用临时目录和 mock 模型，不应调用付费模型或修改用户数据库。GitHub Actions 在 main 推送和 PR 时运行完整检查。

浏览器回归：先运行 `npm run build`，再运行 `npm run test:e2e`。测试启动独立的 3100 端口生产服务，数据库位于已忽略的 `test-results/e2e.sqlite`，不会复用当前开发服务器。CI 安装 Chromium 并运行这些用例，失败时保留 trace。工作区测试还覆盖 OAuth/PKCE 回调、防重复发布、账户隔离、邮件令牌、Worker 接管和快照恢复。

## 本会话自动同步规则

用户已授权：Codex 每完成一轮代码修改，运行相应检查、审阅差异，然后自动提交并推送到 `origin` 的工作分支。当前为 `main`，远程为 `git@github.com:RosenFFF/RpeoCare.git`。不再逐次询问同步权限。

使用有意义的提交信息，例如 `feat(audit): ...`、`fix(models): ...`、`refactor: ...`。提交前检查暂存差异，只纳入本轮明确相关的文件。不得提交环境密钥、SQLite、模型密钥、依赖目录、构建输出及无关文件。

普通推送成功后核对远程分支提交号，并向用户报告提交号和同步结果。网络、认证或远程冲突导致失败时保留本地成果，报告真实原因；不强制推送，不覆盖远程历史。检查失败先修复，不把未通过的改动描述为已验证完成。

这是 Codex 的持久项目工作规则，不是监视文件保存的后台同步程序；手动修改文件不会立即自动上传。规则原文见根目录 `AGENTS.md`。


## 复现 Runner

复现相关改动至少运行 `node --check reproduction/runner.mjs`、单元测试和完整 `npm run check`。本地 Docker 可用时再运行 `npm run repro:image`，并使用专用公开测试仓库验收。不要在测试中回退到宿主机执行仓库命令。配置与生产隔离要求见 [REPRODUCTION.md](REPRODUCTION.md)。
