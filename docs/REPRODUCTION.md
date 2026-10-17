# Issue Bug 复现实验室

RepoCare 的复现实验室将 Issue 文本转化为**先审阅、再执行、可重复、带证据**的验证任务。它不是把大模型的判断直接当成事实：只有隔离环境中的机器判据在 3 次独立尝试中至少命中 2 次，界面才显示“稳定复现”。

## 四个阶段

1. **结构化计划**：模型结合 Issue 正文、评论和分诊结果生成严格 JSON，明确环境、准备步骤、交互步骤、预期故障、机器判据、风险和缺失信息。服务端使用 Zod 与二次安全校验拒绝额外字段、外部 URL、宿主路径、Shell 运算符和未允许的命令。
2. **项目测试优先**：允许复用 `npm test`、受限 npm scripts、pytest/unittest、`go test` 和项目内 Playwright 测试。依赖安装只允许在单独准备阶段执行。npm 附加 `--ignore-scripts --no-audit --no-fund`；Python 限定目标依赖目录和受支持的根目录清单或项目安装，边界见 [需求与对照验证](MAINTENANCE_VERIFICATION.md)。
3. **浏览器 / HTTP 复现**：Playwright 可以访问沙箱内 `localhost`，执行 goto/click/fill/expect；HTTP 步骤也只允许 localhost。收集页面截图、Trace、视频、控制台与网络记录。
4. **Docker 隔离与证据链**：独立 Worker 获取公开 GitHub 仓库并锁定 commit SHA。每次尝试前恢复干净工作区，在无 capabilities、只读根文件系统、资源限制和执行期断网的 Runner 中运行。证据文件保存 SHA-256，下载时再次校验。

## 安全边界

- `REPOCARE_REPRO_ENABLED` 默认关闭；Docker 不可用时任务安全阻塞，**绝不回退到宿主机执行仓库代码**。
- Web 进程只生成和确认计划；实际执行由 `scripts/reproduction-worker.ts` 处理。
- 维护 Agent 的 Python 计划还提供独立静态环境预检。预检只读取固定源码，不能作为复现或测试通过记录；支持范围见 [确认前环境检查](MAINTENANCE_VERIFICATION.md#固定-runner-环境预检)。
- 仅支持 GitHub 公开仓库的 HTTPS 克隆。当前不会把用户 GitHub token 注入 Runner。
- 最多同时排队或执行 2 个任务；任务按账户与项目隔离。
- 执行阶段 `--network none`。只有经人工审阅后显式设置 `REPOCARE_REPRO_ALLOW_NETWORK=true`，依赖准备阶段才使用网络。
- 证据不包含克隆的整个源码工作区；单文件、文件数和总大小均有限制。
- Docker socket 等同于高权限接口。生产环境应把复现 Worker 部署在独立 Runner 主机或经过严格限制的 Docker API 代理后，不要把 socket 暴露给 Web 容器。

## 本地启用

需要 Docker Engine / Docker Desktop 正常运行。

```sh
npm run repro:image
```

在 `.env.local` 中配置：

```dotenv
REPOCARE_REPRO_ENABLED=true
REPOCARE_REPRO_IMAGE=repocare-repro-runner:local
REPOCARE_REPRO_ARTIFACTS=data/reproduction
REPOCARE_REPRO_ALLOW_NETWORK=false
REPOCARE_REPRO_MAX_SECONDS=180
```

然后运行 `npm run dev`。开发命令会同时启动 Web、体检 Worker、维护 Agent Worker 和复现 Worker。若计划包含 npm 或受支持的 Python 依赖安装，先审阅清单与来源，再明确开启依赖网络。Python 构建可能执行项目代码，执行范围仍限制在容器内。

## 结果解释

- **稳定复现**：3 次独立执行至少 2 次命中 oracle。
- **未稳定复现**：沙箱执行完成，但未达到 2/3 阈值；不能据此认定 Issue 无效。
- **环境阻塞**：Docker、Runner 镜像、依赖网络或源码快照不可用。
- **执行失败**：计划或项目命令在沙箱内异常终止。
- **计划不安全**：结构或安全校验未通过，不进入队列。

证据只能证明当前固定提交、Runner 镜像和计划下的观察结果。浏览器、操作系统、硬件、私有服务或用户数据相关问题仍可能需要维护者补充环境后重新生成计划。
