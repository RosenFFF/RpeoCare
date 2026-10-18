# ItsDangerous #126 原版行为复查

此入口复查[历史Issue #126](https://github.com/pallets/itsdangerous/issues/126)在1.1.0固定提交`6e6359864be6055860adf1e11d8bb0db69ff1840`的行为。`baseline.json`中的测试由本项目编写，采用仓库Apache-2.0许可；上游源码由执行器下载，保留其自身许可，不在这里复制分发。

先审阅manifest内的测试和计划，按项目说明安装Node.js 24、Git、Docker并构建Runner，然后运行：

```sh
npx tsx scripts/accept-python-preparation.ts evaluation/itsdangerous-126/baseline.json --reviewed
```

目标检查要求：使用`max_age`时拒绝未来时间戳。正常检查覆盖有效期内、边界、过期及篡改消息。该判据由执行者在本批模型调用前固定，不能代表全部时钟偏差策略。预期原版目标失败、正常行为通过，因此整份计划状态应为`not-reproduced`；这里不把红色目标断言称为环境失败。

此入口不调用模型、不安装额外依赖；仓库代码只由现有Docker执行器运行，不能回退宿主机。结果位于命令输出的`data/python-preparation-.../results.json`，每次只执行一次。该案例的受限模型阶段未保存候选，故没有模型候选对照或自主修复成功结论。批次和失败见[调查预算实测](../../docs/MAINTENANCE_BOUNDED_EVALUATION.md)。
