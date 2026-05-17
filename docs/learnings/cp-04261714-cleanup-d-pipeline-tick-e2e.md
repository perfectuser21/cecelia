# Learning — cleanup-D 补 content-pipeline 幂等门 + tick-runner 全 plugin wire E2E

## 背景
brain-v2 D1.7c 后 8 个 plugin（dept-heartbeat / kr-progress-sync / heartbeat / goal-eval / pipeline-patrol / pipeline-watchdog / kr-health-daily / cleanup-worker）被抽出 tick-runner.js，但只有"源码字符串自省"测试（tick-runner.test.js 用 grep 验 import + 调用），缺真正调 `executeTick()` 验运行时 wire 的 E2E。content-pipeline LangGraph 的 C8b 幂等门（`state[primaryField] 已存在 → skip docker`）只有单元测试 placeholder 路径覆盖，没有"executor 调用次数减少"的硬验证。

## 做了什么
补 2 个 integration 测试：

1. **content-pipeline-idempotent.integration.test.js**（3 个用例）
   - mock pg-checkpointer + mock executor (vi.fn 计数)
   - 用例 1：空 state invoke → executor 被调 6 次，每节点各 1 次，达 END
   - 用例 2：state.findings_path 已存在 → research 跳过，executor 调 5 次，graph 仍达 END
   - 用例 3：多节点 primary output 已存在（research/copywrite/generate）→ 短路 3 个节点，仅 verdict 节点 + export 跑

2. **tick-runner-full-tick.integration.test.js**（1 个用例）
   - mock pool / 8 plugin / dispatcher / 30+ heavy modules
   - 用 smartQuery 让 `SELECT id FROM key_results` 返非空，避免 tick 早退（line 1033 `allGoalIds.length === 0` 早返）
   - 调 executeTick() 一次，验 8 plugin .tick 都被调、dispatcher.dispatchNextTask 被调、tickState.lastZombieSweepTime 被推进

## 根本原因
源码字符串 grep 能检出"import + 调用"语法，但不能检出运行时 wire 是否真触达 plugin（比如调用前 early-return、try/catch 吃掉异常、guard 永真等）。需要"真跑 executeTick + spy 验调用"的 E2E 才稳。content-pipeline 的 C8b 幂等门同理 — placeholder 测试只走 `placeholderNode`，不走 `runDockerNode` 内的 `state[primaryField]` 短路逻辑，需要 `createContentDockerNodes(mockExecutor, task)` + `vi.fn().toHaveBeenCalledTimes(N)` 才能真验。

## 下次预防
- [ ] 新加 plugin 到 tick-runner 时，必须同步在 `tick-runner-full-tick.integration.test.js` 加 spy 断言
- [ ] LangGraph workflow 加新短路/守卫逻辑时，必须在 integration test 用 `vi.fn().toHaveBeenCalledTimes()` 验"调用次数减少"，不能只验"trace 包含某节点"
- [ ] mock 大量模块时按"返回类型"分类：被 spread 的（`...arr`）必须返数组、被 `for...of` 的必须返 iterable、被读 `.x.y` 的必须返完整结构 — 一类一类核对，避免逐个错误重跑
