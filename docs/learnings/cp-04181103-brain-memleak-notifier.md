# Learning: Brain 内存泄漏根治 — notifier._lastSent 无界增长

- **Branch**: cp-04181103-brain-memleak-notifier
- **Brain Task**: `f9fb75fa-57b0-4e4c-9b90-8c1af9b1c42f`
- **Date**: 2026-04-18

## 症状

Brain 进程长时间运行后 RSS 从重启基线 ~100MB 涨到 449MB，触发 Alertness `memory_available_mb < 600MB`，`slot_budget.dispatchAllowed=false`，dispatcher 停止派发。恶性循环：无派发 → executor 连续 3 次 fail → circuit breaker 熔断。

实测 Brain (PID 82401) RSS 已达 746 MB。

## 调研：Top 3 嫌疑（排名按内存泄漏严重度）

| # | 文件 | 数据结构 | 每次写入来源 | 是否有清理 | 评估 |
|---|---|---|---|---|---|
| 1 | `packages/brain/src/notifier.js:19` | `_lastSent` (Map) | 每任务 completed/failed/patrol 一次，key = `task_completed_${task_id}` 等 UUID-based | **无** — 只 set 不 delete | **最严重** |
| 2 | `packages/brain/src/cortex.js:178,333` | `_reflectionState` / `_outputDedupState` (Map) | 每次 cortex 分析，key = event/output sha256 前 16 字符 | 仅启动时从 DB 加载时过滤过期条目；**运行时 set 后永不 evict** | 中 |
| 3 | `packages/brain/src/harness-watcher.js:21` | `lastPollTime` (Map) | 每次 ci_watch tick，key = task_id | **无** — 只 set 不 delete | 轻（基数只有 harness 任务） |

### 其他已审查但排除的嫌疑

| 位置 | 为何排除 |
|---|---|
| `alertness/escalation.js:80` escalationHistory | 有 `MAX_HISTORY_SIZE=50` + shift |
| `alertness/metrics.js` responseTimeHistory/cpuHistory/operationHistory | 都有 cap + shift |
| `alertness/index.js:55` stateHistory | 有 `MAX_HISTORY_SIZE=100` + shift |
| `alertness/healing.js:153` healingHistory | 经查有 cap |
| `cognitive-core.js:134,435` _tickTimestamps / _tickEventBuffer | 分别 cap=20/30 |
| `watchdog.js` _taskMetrics/_idleMetrics/_lastHealingTrigger | 有 cleanup 路径 delete |
| `account-usage.js` spending/auth Map | key=accountId，基数固定（3-5） |
| `alerting.js` _p0RateLimit | key=eventType（class-level，非 task_id），基数小 |
| `websocket.js` heartbeatInterval | 有 close 清理 |
| `setInterval/setTimeout` 扫查 | 所有模块 interval 都是 module-scope 单例 |
| `EventEmitter .on()` 扫查 | 无长期累积 listener，生命周期与 ws/child process 绑定 |

## 根本原因

`notifier.js` 的 `sendRateLimited(eventKey, text)` 用调用方拼接的 `eventKey` 做限流：

```js
async function notifyTaskCompleted(info) {
  return sendRateLimited(`task_completed_${info.task_id}`, text);
}
```

`task_id` 是 UUID，每个任务唯一；`_lastSent.set(eventKey, now)` 写入后**从未 delete**。这意味着：

- 每天数百到数千个任务 → 每天数百到数千个新 UUID key。
- 每个 entry (UUID string + timestamp) 计对象头 + V8 Map bucket ~ 120–200 bytes。
- 几周跑下来 Map 有数万条，再叠加 V8 堆碎片 → 数十 MB。
- 与其他次级泄漏（cortex hash、harness-watcher）协同把基线 100MB 推到 400+MB。

语义上，**任何超过 `RATE_LIMIT_MS` (60s) 的 entry 对限流已完全无效**，留在 Map 里纯粹浪费内存——这是经典的"无清理 TTL 缓存"反模式。

## 修复方案（选 #1 的理由 + 实现）

**为什么先修 #1**：写入频率最高（线性增长）+ key 基数最大（UUID）+ 完全无 cap。修 #1 能立即止住最主要的内存出血点。

**实现**（`packages/brain/src/notifier.js`）：

1. 新增 `_pruneExpired(now)`：遍历 `_lastSent`，删除 `now - ts >= RATE_LIMIT_MS` 的 entry。这些 entry 已失效，删掉不改变限流语义。
2. `sendRateLimited()` 内在写入前先调 `_pruneExpired(now)`。
3. 硬上限兜底：`_MAX_ENTRIES = 1000`，超限整表 `clear()`（最坏是重复发一次通知，业务可接受）。
4. 回归测试 `src/__tests__/notifier-memory-leak.test.js`：4 个 case 覆盖 TTL GC、未过期不误删、硬上限兜底、原有 60s 限流语义未破坏。

## Follow-up（本 PR 不修）

- **#2 cortex._outputDedupState / _reflectionState**：在 tick 周期里加一个 sweep，扫 Map 删 `now - lastSeen > REFLECTION_WINDOW_MS` 的条目（同时 DELETE 对应 working_memory 行）。
- **#3 harness-watcher.lastPollTime**：在 ci_watch 任务进入 completed/failed 终态更新 SQL 附近 `lastPollTime.delete(task.id)`。

### 根本原因

`_lastSent` Map 的 key 包含任务 UUID，只写不删；每任务一条永久记录，日累月积突破 Brain RSS 阈值，触发 Alertness 暂停派发。

### 下次预防

- [ ] 新增 rate-limit / dedup Map 必须自带 TTL pruning 或 LRU
- [ ] UUID 作 Map key 属高危模式，review 必卡
- [ ] 月度巡检 `/api/brain/context` 应包含主要 Map size
