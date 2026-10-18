# cattrs PR #800 公开复查用例

这是已参与开发的历史PR，不能重新计为未见案例，也不运行模型。检查代码由本项目提供，Apache-2.0；上游生产代码通过Git获取固定版本，在本机保留原许可，不随本目录复制分发。

先阅读`case.json`和`checks.py`，需要Node.js 24、Git、Docker及已构建Runner。`npx tsx scripts/replay-maintenance-case.ts --prepare-only`只下载固定源码、校验测试指纹并生成两份manifest，不运行项目代码。审阅输出后运行`npx tsx scripts/replay-maintenance-case.ts --reviewed --allow-network`，准备阶段需要网络下载项目声明依赖，测试阶段断网，禁止回退到宿主机。

原版预期目标断言失败、正常用例通过；既有PR生产改动版两个节点都应通过。每版只运行一次，不把该复查称为三次稳定验收、Agent首次交付或完整套件通过。测试不能证明所有边界都已覆盖。

固定来源与两份manifest保存在`data/public-replay-...`。每版实际环境、步骤、结果与制品位于命令输出的`data/python-preparation-...`，其`results.json`同时保存预检记录。源码下载或依赖准备受阻时，保留失败目录；另行复查不能覆盖或补记为首次成功。
