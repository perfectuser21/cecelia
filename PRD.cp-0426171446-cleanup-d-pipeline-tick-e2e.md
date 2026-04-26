# PRD: cleanup-D — content-pipeline 幂等门 + tick-runner 完整 tick E2E

**分支**：cp-0426171446-cleanup-d-pipeline-tick-e2e
**日期**：2026-04-26
**Brain task**：#4（team `brain-v2-tdd-cleanup`）

## 背景

brain-v2 D1.7c 把 8 个 plugin 抽出 tick-runner.js 后，仅有"读源码字符串验 import + 调用语法"的 `tick-runner.test.js`，**没有真跑 executeTick 的 E2E** 验运行时 wire 是否真把 plugin 调上。如果未来某次重构把 plugin 调用挪到 early-return 之前/之后，源码 grep 测试通过、但运行时 plugin 永不被调，回归不会被检出。

content-pipeline LangGraph 的 C8b 幂等门（`createContentDockerNodes` 内 `if (state[primaryField]) return resume`）只有 placeholder 路径覆盖，**没有"executor 调用次数减少"的硬验证**。如果未来幂等门逻辑被破坏（比如条件写反），节点就会被反复 spawn 烧 docker，单测无法捕获。

## 修复范围

补 2 个 integration 测试：

### E2E 3 — content-pipeline-idempotent.integration.test.js
- mock pg-checkpointer + executor (`vi.fn()` 计数)
- 用例 1：空 state → executor 调 6 次（每节点 1 次），到达 END
- 用例 2：state.findings_path 已存在 → executor 调 5 次（research 跳过），到达 END
- 用例 3：3 个节点的 primary output 已存在 → 短路 3 个节点，仅 verdict + export 跑

### E2E 4 — tick-runner-full-tick.integration.test.js
- 全 mock 模式 — pool / 8 plugin / dispatcher / 30+ heavy modules
- smartQuery 让 `SELECT id FROM key_results` 返非空（避免 tick early-return）
- 调 `executeTick()` 一次
- 验 8 plugin .tick 都被调（dept-heartbeat / kr-progress-sync / heartbeat / goal-eval / pipeline-patrol / pipeline-watchdog / kr-health-daily / cleanup-worker）
- 验 dispatcher.dispatchNextTask 被调
- 验 tickState.lastZombieSweepTime 被推进

## 约束

- 走 /dev 全流程
- 不改 src/*（仅加 test）
- 测试必须不真连 PostgreSQL / Docker / 网络

## 成功标准

1. 新增 2 个 integration test 文件，4 个用例全 pass
2. 既有 brain integration 测试无回归（content-pipeline-graph.test.js / tick-dispatch.integration.test.js 不受影响）
3. mock 链完整 — 即使 tick-runner.js 内有任意 try/catch 失败，8 plugin .tick 仍被调用
