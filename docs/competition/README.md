# 参赛资料

RepoCare 参加第八届全球校园人工智能算法精英大赛·算法主题赛（AI+开源），参赛方向为"AI 开发工具与开源协作"。技术报告与演示视频通过赛事平台提交，本目录保存可公开的配套资料。

| 文件 | 内容 |
| --- | --- |
| [作品名称与简介.md](作品名称与简介.md) | 作品名称与 300 字以内简介 |
| [第三方资源说明.md](第三方资源说明.md) | 开源及第三方资源使用清单（与技术报告附录 A 一致） |
| [第三方依赖清单.csv](第三方依赖清单.csv) | package-lock.json 中全部 490 个 npm 包的版本、许可证、用途与合规状态 |
| [试用任务与记录.md](试用任务与记录.md) | 首次使用者试用的任务与记录表 |

依赖清单由 `npx tsx scripts/export-dependency-inventory.ts docs/competition/第三方依赖清单.csv` 从锁文件生成，依赖升级后重新运行即可。

技术报告引用的实测记录都在仓库中：

| 内容 | 位置 |
| --- | --- |
| 双版本对照验证的设计 | [MAINTENANCE_VERIFICATION.md](../MAINTENANCE_VERIFICATION.md) |
| MarkupSafe、python-dotenv、Humanize 实测 | [MAINTENANCE_FIELD_TESTS.md](../MAINTENANCE_FIELD_TESTS.md) |
| h11、boltons、cattrs 实测与提示消融 | [MAINTENANCE_FRESH_EVALUATION.md](../MAINTENANCE_FRESH_EVALUATION.md) |
| ItsDangerous、Blinker 调查预算实测 | [MAINTENANCE_BOUNDED_EVALUATION.md](../MAINTENANCE_BOUNDED_EVALUATION.md) |
| TinyDB 报告收尾与插件预检 | [MAINTENANCE_RECOVERY_EVALUATION.md](../MAINTENANCE_RECOVERY_EVALUATION.md) |
| python-json-pointer、cachetools 冻结验收 | [MAINTENANCE_RELEASE_EVALUATION.md](../MAINTENANCE_RELEASE_EVALUATION.md) |
| 脱敏评测索引 | [docs/evaluation](../evaluation) |
| 可独立复查的检查 | [evaluation/cattrs-800](../../evaluation/cattrs-800/README.md)、[evaluation/itsdangerous-126](../../evaluation/itsdangerous-126/README.md) |
| 依赖审计 | [DEPENDENCY_REVIEW.md](../DEPENDENCY_REVIEW.md) |
