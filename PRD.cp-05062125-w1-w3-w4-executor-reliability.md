# PRD — feat(brain): harness executor 可靠性升级 (W1+W3+W4)

## 背景

`packages/brain/src/executor.js` 的 `harness_initiative` 路由分支永远用 `:1` thread_id 调
LangGraph，无 AbortSignal、无节点级事件流，导致 MJ1 stuck at step 75 死循环。

Spec: `docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md` §W1 §W3 §W4
Plan: `docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md` §Work Stream 1/3/4

## 目标

抽出 `runHarnessInitiativeRouter(task, opts)` 为可测函数，合并三件可靠性原语：

- **W1** thread_id 版本化：`harness-initiative:<id>:<attemptN>`，attemptN = `task.execution_attempts + 1`，
  仅 `payload.resume_from_checkpoint=true` 才续 checkpoint，否则 fresh start；同 attemptN 已有
  checkpoint 但未 resume → 升 N 写新 thread（保留旧 checkpoint 诊断）
- **W3** AbortSignal + watchdog：invoke 加 `signal`，deadline 来源 `initiative_runs.deadline_at`
  (fallback 6h)，`setTimeout` 触发 abort 标 `task.failure_class='watchdog_deadline'`；
  额外新建 `harness-watchdog.js` `scanStuckHarness` 兜底扫描 + tick 5min 注册
- **W4** streamMode='updates'：`compiled.invoke` → `compiled.stream`，逐 node `emitGraphNodeUpdate`
  写 `task_events` 表（cap 100 条防写爆）

## 改动范围

- `packages/brain/src/executor.js` — export `runHarnessInitiativeRouter` + `summarizeNodeState`
- `packages/brain/src/events/taskEvents.js` — 新增 `emitGraphNodeUpdate`
- `packages/brain/src/harness-watchdog.js` — 新建 `scanStuckHarness`
- `packages/brain/src/tick-runner.js` + `tick-state.js` — 5min 注册 watchdog
- `packages/brain/migrations/268_task_events.sql` — 新建 task_events 表
- `packages/brain/src/selfcheck.js` — EXPECTED_SCHEMA_VERSION 267→268
- `DEFINITION.md` — schema_version 267→268
- `tests/integration/harness-thread-id-versioning.test.js` — W1
- `tests/integration/harness-watchdog.test.js` — W3 invoke 级
- `tests/integration/harness-watchdog-tick.test.js` — W3 兜底扫描
- `tests/integration/harness-stream-events.test.js` — W4

## 不在 scope

- W2 (RetryPolicy)、W5 (interrupt) — 由 sibling agent 处理 (cp-05062124-w2-w5)
- Dashboard LiveMonitor 消费 graph_node_update — 后续 PR
- W6 (docker-executor OOM 修复) — 独立 PR

## 成功标准

参见 DoD 文件：所有 5 个 [BEHAVIOR] 条目通过验证。
