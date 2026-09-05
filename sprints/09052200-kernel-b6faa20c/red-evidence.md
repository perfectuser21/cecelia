# Red 证据 — check-handoffs.mjs 契约 schema 化

冻结合同测试已随 `chore(harness): import contract` 落盘（TESTS_ALREADY_PRESENT 分支），
Generator 不重复 checkout，直接在当前 fleet 签发分支上验红。

## 测试执行（实现前）

命令：`vitest run sprints/09052200-kernel-b6faa20c/tests/ --reporter=json`

退出码：`1`（全红，符合预期）

统计：`numTotalTestSuites=1 numFailedTestSuites=1 numTotalTests=0`
（实现文件 `packages/brain/src/orchestrator/check-handoffs.mjs` 尚不存在，
整个测试套件在 import 阶段即加载失败，无法收集用例——这正是合同 Test Contract
「预期红证据」栏预判的红：`Failed to load url check-handoffs.mjs`。）

套件加载失败信息（原样）：

```
Failed to load url ../../../packages/brain/src/orchestrator/check-handoffs.mjs
(resolved id: ../../../packages/brain/src/orchestrator/check-handoffs.mjs)
in /workspace/sprints/09052200-kernel-b6faa20c/tests/check-handoffs-contracts.test.mjs.
Does the file exist?
```

Green 阶段将新建该模块（导出 CODING_CELLS / LEADGEN_CELLS / ASSERTION_CATEGORIES /
CONTRACTS / evaluateAssertion / runCellContracts + CLI），使 13 条断言全绿。
