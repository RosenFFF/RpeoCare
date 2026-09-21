# RepoCare 项目工作规则

## 工作目录

- 当前维护目录：`C:\Users\LENOVO\Desktop\比赛\AIC\RepoCare`。
- 原 `openbridge-web` 是迁移备份，不在其中继续修改或启动服务。
- 首先阅读 `docs/ARCHITECTURE.md` 和 `docs/DEVELOPMENT.md`，按现有功能边界组织代码。
- 客户端不得导入 `src/server` 的运行时代码；共享类型放在 `src/contracts`。

## 每轮修改后自动同步 GitHub（用户明确授权）

1. 完成请求的修改后运行适当检查；结构、依赖或服务端变化执行 `npm run check`，UI 调整至少做类型检查与浏览器验证。
2. 检查 `git status` 和差异，只暂存本轮相关改动。不得提交密钥、`.env.local`、`data/`、SQLite、`.model-key`、依赖目录或构建产物，不得擅自纳入不相关的用户改动。
3. 使用清晰提交信息自动 commit，然后普通 push 到 `origin` 的当前工作分支；当前为 `main`。远程：`git@github.com:RosenFFF/RpeoCare.git`。无需每次询问用户是否同步。
4. 不强制推送、不重置用户修改、不覆盖远程历史。若检查、认证、网络或冲突阻塞，保留成果并报告具体问题，继续修复可独立解决的问题。
5. 推送成功后核对远程提交号，最终回复说明验证结果、提交号和同步状态。未经验证不可声称已同步。

## 实现与验证

- 保持真实功能与演示功能边界准确，修改功能同时维护相应说明。
- 用锁文件安装依赖，不嵌入旁边 pi-agent 仓库源码。
- 测试应使用临时数据库和 mock 模型；不以真实付费调用作为默认测试。
- UI 动效兼容窄屏及减少动态效果偏好，隐藏控件不能残留键盘焦点。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
