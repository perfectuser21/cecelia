# 秋米任务豁免 cecelia-run 熔断 + 路由幂等 设计说明书

日期：2026-09-23　任务：Brain 9a1b0fe6　决策：bug-fix（qiumi_task 被 cecelia-run 熔断误伤 + 每 tick 重复路由）

## 0. 现象与根因（生产实证 2026-09-23 03:48–03:55）

- 首条秋米真活 72b010e9 在 03:48:25、03:50:28 各留一条 `qiumi_route_decided`（run_id 不同），无 `openclaw_agent_spawned`，状态每次回 queued；`POST /api/brain/circuit-breaker/cecelia-run/reset` 后 03:54 一次成功。
- 根因链（`packages/brain/src/dispatcher.js`）：
  1. `:795-812` 候选循环内 `dispatchQiumiTask` 已完成 Jev 路由 + `persistDecision`（写 run_id/model/qiumi_route + task_events）再 `break`；
  2. `:955` `needsBridgeCheck = !HARNESS_INFLIGHT_TASK_TYPES.includes(type)` → qiumi_task 不在 INF → true；
  3. `:960-966` `!isAllowed('cecelia-run')`（其它任务 map_stale / codex ENOENT 连败使其 OPEN/HALF_OPEN）→ 回 queued + 放 claim + `circuit_breaker_open`，无日志无事件；
  4. `:968-999` HALF_OPEN 放行后仍要过 `checkCeceliaRunAvailable()`（bridge 健康），不可用 → `no_executor` 回 queued；
  5. `:1192-1205` openclaw 路径 spawn 失败也 `recordFailure('cecelia-run')`，反向污染 bridge 熔断。
- qiumi_task 的执行体是 `openclaw-agent`（Brain 经 ssh 直派 MMV），**不经 cecelia-bridge**，两道 bridge 闸对它都是误伤；路由副作用在闸之前发生则导致每 tick 白打 Jev 并生成新 run_id。

## 1. 目标（主理人已拍板，不得推翻）

| # | 改动 | 落点 |
|---|---|---|
| ① | `needsBridgeCheck` 改为「不在 INF **且** 注册表 surface 不是 `openclaw-agent`」：`getTaskType(type)?.surface !== 'openclaw-agent'`。两道 bridge 闸（熔断 + `checkCeceliaRunAvailable`）同时豁免 | dispatcher.js:955 |
| ② | `dispatchQiumiTask` 入口（读全行之前）先 `isAllowed('openclaw-agent')`；OPEN → 释放 claim、`recordDispatchResult(pool,false,'openclaw_agent_circuit_open',undefined,id)`、返回 `{outcome:'skip'}`，**不路由** | dispatcher.js `routeAndPersistQiumi` 开头 |
| ③ | 路由幂等：全行 `payload.qiumi_route` 与 `payload.run_id` 同时存在 → 不调 `routeQiumiTask`/`persistDecision`，直接 `{outcome:'proceed'}`（沿用既有 run_id；执行体的 ALREADY 探针已按 run_id 防重起） | dispatcher.js `routeAndPersistQiumi` |
| ④ | 熔断计数分键：`execResult.executor === 'openclaw-agent'`（或 task surface 为 openclaw-agent）时失败 `recordFailure('openclaw-agent')`、成功 `recordSuccess('openclaw-agent')`，不动 `cecelia-run` | dispatcher.js:1192-1205 与成功分支 |

不做：不改 `circuit-breaker.js` 语义/阈值；不手抄任务类型名单（一律从 `lib/task-type-registry.js` 派生，铁律 76cb816c）；不动 executor / 收割器。

## 2. 方案比较

- A（选）**按注册表 surface 派生豁免 + qiumi 独立熔断键**：与 `HARNESS_INFLIGHT_TASK_TYPES` 豁免同构、名单单一来源；openclaw-agent 有自己的熔断，bridge 故障与 MMV 故障互不牵连。
- B 把 `qiumi_task` 打 INF 标签复用现有豁免：改一处但语义错（INF = harness 在途集合，被 monitor/pipeline-watchdog 消费），会让 qiumi 进入 harness 监控口径。否。
- C 只 reset 熔断不改代码：每次别人的任务坏了秋米就停摆，且每 tick 白打 Jev。否。

## 3. 数据流（修后）

```
tick → 候选 qiumi_task（claim 成功）
  → dispatchQiumiTask
      ├ isAllowed('openclaw-agent')=false → 放 claim → skip（不路由）
      ├ payload 已有 qiumi_route+run_id → proceed（不打 Jev）
      └ 否则 便宜闸 → Jev → persistDecision → proceed
  → 标 in_progress
  → needsBridgeCheck=false（surface=openclaw-agent）→ 跳过 cecelia-run 熔断与 bridge 健康检查
  → triggerCeceliaRun → 0.7 分支 → triggerOpenclawAgent（ssh MMV，ALREADY 探针）
      ├ 成功 → recordSuccess('openclaw-agent')
      └ 失败 → 回 queued（既有回滚）+ recordFailure('openclaw-agent')
```

## 4. 错误处理

- `openclaw-agent` 熔断 OPEN：任务留 queued、claim 释放、派发统计记 `openclaw_agent_circuit_open`；主理人可 `POST /api/brain/circuit-breaker/openclaw-agent/reset`。
- `getTaskType(type)` 为 null（未知类型，注册表返回 null）：`?.surface` 取 undefined → `needsBridgeCheck` 维持原语义（true）。
- 幂等 proceed 后 spawn 失败：既有回滚回 queued，payload 仍带 run_id → 下一 tick 直接 proceed 复用 run_id，探针 `.pid/.exit` 决定是否重起（Task 5 I2 语义）。

## 5. 测试策略

- **unit（vitest，`src/__tests__/dispatcher-qiumi-routing.test.js`，先红后绿）**
  1. `isAllowed('cecelia-run')=false` 且候选为 qiumi_task → 仍调用 `triggerCeceliaRun`，`checkCeceliaRunAvailable` 未被调用，任务未被回滚为 queued；变异：还原 `needsBridgeCheck` 为旧式 → 红。
  2. 全行 payload 已含 `qiumi_route`+`run_id` → `routeQiumiTask`/`persistDecision` 未被调用，outcome=proceed；变异：删幂等分支 → 红。
  3. `isAllowed('openclaw-agent')=false` → outcome=skip、claim 释放 SQL 被调、`recordDispatchResult(...,'openclaw_agent_circuit_open')`、`routeQiumiTask` 未被调用；变异：删前置检查 → 红。
  4. openclaw 路径 `execResult.success=false`（executor 'openclaw-agent'）→ `recordFailure('openclaw-agent')` 被调且 `recordFailure('cecelia-run')` 未被调；成功 → `recordSuccess('openclaw-agent')`；变异：分键改回 → 红。
- **integration**：无（无新表/迁移）。
- **E2E / 生产复验**：合并部署后，在生产 `POST /api/brain/circuit-breaker/cecelia-run/reset` 与人为使其 OPEN（或等其自然 OPEN）两种状态下，中文表建一条文字探针委派行，断言 `task_events` 只有一条 `qiumi_route_decided` 且随后有 `openclaw_agent_spawned`。

## 6. 影响范围

只改 `packages/brain/src/dispatcher.js`（约 20 行）与其测试；派发统计新增 reason `openclaw_agent_circuit_open`；熔断器新增键 `openclaw-agent`（内存+DB 自动创建，无迁移）。
