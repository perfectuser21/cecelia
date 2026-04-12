# Learning — preparePrompt 圈复杂度重构

## 根本原因

`preparePrompt` 函数中多个 `if-else` 大块（harness_generate、sprint_report、harness_planner、sprint_contract_propose、sprint_contract_review）以内联方式写在主函数体内，而不是提取为子函数，导致圈复杂度积累到 77。

## 解决方案

1. 将 5 个内联大块提取为命名子函数（`_prepareHarnessGeneratePrompt`、`_prepareHarnessReportPrompt`、`_prepareHarnessPlannerPrompt`、`_prepareContractProposePrompt`、`_prepareContractReviewPrompt`）
2. 主函数改为纯 dispatcher，只保留 3 个 if 分支 + 统一路由表
3. 同步将 sprint_report/harness_report、sprint_planner/harness_planner 等类型移入 `routes` 对象

## 下次预防

- [ ] 向 `preparePrompt` 新增 taskType 时，优先写子函数，然后在 `routes` 表中注册一行——禁止将异步 fetch 逻辑直接内联到主函数体
- [ ] 路由表模式（`const routes = { taskType: (t) => handler(t) }`）是标准扩展点，新增类型只改路由表，不动主函数结构
