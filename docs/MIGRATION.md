# 2026-09-21 目录整理

新的唯一日常开发目录：`C:\Users\LENOVO\Desktop\比赛\AIC\RepoCare`。

原目录 `C:\Users\LENOVO\Desktop\比赛\AIC\openbridge-web` 保留为迁移时备份，不继续开发或推送。Git 历史、分支和远程仓库保持不变。参赛计划书及 `pi-agent` 参考源码继续留在 AIC 上级目录，避免混入应用仓库。

## 路径对照

| 原位置 | 新位置 |
| --- | --- |
| `src/components/views/audit-*` | `src/features/audit/` |
| 其他 `src/components/views/` 页面 | `src/features/<功能>/` |
| 首页和认证组件 | `src/features/landing/`、`src/features/auth/` |
| 概览和仓库 3D 组件 | `src/features/overview/` |
| `src/components/workspace.tsx` | `src/components/workspace/workspace.tsx` |
| 共享品牌、主题组件 | `src/shared/components/` |
| `src/lib/audit/` 实现 | `src/server/audit/` |
| `src/lib/models/` 实现 | `src/server/models/` |
| 上述两处 `types.ts` | `src/contracts/audit.ts`、`src/contracts/models.ts` |
| 其他 `src/lib/` | `src/shared/lib/` |
| `tests/*.test.ts` | `tests/audit/`、`tests/models/` |
| 配置、认证、QA 文档 | `docs/` |

源码引用随文件同步调整，路由、API 和数据库格式保持兼容。新增 EditorConfig、Git 行尾约定、Node 版本文件、统一验证命令和 GitHub CI。保留本轮之前的体检 UI 简化及侧栏收起动画。

## 本地数据迁移

切换服务前检查活动任务，停止原项目 Web/Worker 后迁移整个 `data` 目录及配套加密密钥。新目录重新安装锁定依赖、生成构建，启动后验证数据库完整性、已有记录数量、模型密钥可解密以及 Worker 在线。

运行数据只存本地，不进入 GitHub。后续新增任务只记录在新目录；旧备份不会随新目录继续更新。备份时先停止 Web/Worker，并一并保存数据库、WAL（若存在）、模型密钥和环境配置。
