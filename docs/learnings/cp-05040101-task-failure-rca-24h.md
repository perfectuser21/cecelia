# RCA — 24h 任务成功率 21% 的根因

- 事件日期：2026-05-04
- 影响面：Brain 任务调度 — 2026-05-03 19:00 之后批次 dev 任务 100% 进入 quarantine
- 严重度：P0（任何首次未在 60min 内完成的任务都注定进 quarantine）
- 数据窗口：2026-05-03 12:00 → 2026-05-04 12:00（最近 24h）

---

## 1. 现象拆桶

| 状态 | 数量 | 真实性质 |
|------|------|---------|
| failed | 20 | **不是新故障** — 一次性清理历史债务 |
| quarantined | 16 | **真正的故障** — 全部同一 bug |
| cancelled (content-pipeline) | 368 | Dashboard 批量取消，无 reason 记录 |
| cancelled (dev) | 15 | 无 reason 记录 |
| completed | 9 | 正常 |

> 用户感知的"34 失败"≈ 20 failed + 16 quarantined（去重后约 32-34，跟 PRD 数字吻合）。

---

## 2. 桶 1：20 failed 的真相 — 退役类型一次性清债

**全部 20 行 `error_message`**：
```
task_type harness_task retired (subsumed by harness_initiative full graph)
task_type harness_planner retired (subsumed by harness_initiative full graph)
```

`failure_class = pipeline_terminal_failure`。

- **created_at 全部在 2026-04-26 16:49**（1 周前的批次，3 个 initiative 拆出的 19+1 行）
- **updated_at 集中在 2026-05-03 11:00-17:00**（昨天才被 drain）
- 来源：`packages/brain/src/dispatcher.js:261-279` 的批量 drain SQL（PR #2660 引入，2026-04-26）
- `_RETIRED_HARNESS_TYPES_DISPATCH` = `harness_task / harness_ci_watch / harness_fix / harness_final_e2e / harness_planner`

**结论**：这 20 个不是系统正在产生新失败，而是历史 queued 行被 drain 清空。**已经处理完，不会复发**。无需任何 follow-up。

---

## 3. 桶 2：16 quarantined 的真相 — `run_triggered_at` 不重置导致永久超时

### 3.1 共同特征

所有 16 个 quarantined dev 任务的 `payload.quarantine_info`：
```json
{
  "reason": "repeated_failure",
  "details": {
    "threshold": 3,
    "last_error": {
      "type": "timeout",
      "message": "Task timed out after 781 minutes (limit: 60min)",
      "timeout_limit": 60,
      "elapsed_minutes": 781
    },
    "failure_count": 3
  },
  "previous_status": "in_progress"
}
```

- `elapsed_minutes` 全部在 **781-784**（约 13 小时）
- `timeout_limit: 60` （生产 env 把默认 100min 调到 60min）
- `previous_status: in_progress` — 任务在 in_progress 态被 patrol 杀掉

### 3.2 patrol_cleanup 事件揭穿循环

`cecelia_events.patrol_cleanup`（2026-05-03 20:58 → 21:23 的 25 分钟切片）：

| 时间 | task_id 短码 | elapsed_minutes |
|------|-------------|-----------------|
| 21:23:23 | 854a63af | 781 |
| 21:23:23 | 48105a5f | 781 |
| 21:22:23 | 48105a5f | 784 |
| 21:22:23 | 5466aad0 | 784 |
| 21:18:22 | 3ea7ab49 | 781 |
| 21:18:22 | 5466aad0 | 781 |
| 21:17:23 | 3ea7ab49 | 784 |
| 21:17:23 | 5466aad0 | 784 |
| ...（同一组 task_id 反复出现 10+ 次）|

**关键观察**：
- 同一个 task_id（如 `5466aad0`）在 25 分钟内被 patrol_cleanup **10+ 次**
- 每次 cleanup 看到的 `elapsed_minutes` 几乎不变（781-784，浮动 ≤3 分钟）
- 说明每次 cleanup 后任务被 requeue + 重新派发，但 elapsed 没有归零

### 3.3 代码级根因

`packages/brain/src/tick-helpers.js:117-181` (`autoFailTimedOutTasks`)：

```js
// L120: 算 elapsed 的源
const triggeredAt = task.payload?.run_triggered_at || task.started_at;
const elapsed = (Date.now() - new Date(triggeredAt).getTime()) / (1000 * 60);

// L153-156: requeue 时清 started_at / claimed_*，但 NOT 清 payload.run_triggered_at
await pool.query(
  `UPDATE tasks SET status = 'queued', claimed_by = NULL,
   claimed_at = NULL, started_at = NULL, updated_at = NOW() WHERE id = $1`,
  [task.id]
);
```

**Bug**：requeue 路径只清 `started_at`，但 `triggeredAt` 计算优先用 `payload.run_triggered_at`。后者一旦被首次派发设置，就**永远不重置**。

### 3.4 死循环时序

```
T0     : dispatcher claim → 设置 started_at = T0、payload.run_triggered_at = T0
T0+60m : autoFailTimedOutTasks 看到 elapsed=60 → kill + requeue（清 started_at，留 run_triggered_at）
T1     : dispatcher 再 claim → 设置 started_at = T1（run_triggered_at 还是 T0）
T1+1tick (~1min): autoFailTimedOutTasks 算 elapsed = now - T0 ≈ 61min → 再次 kill + requeue
       failure_count++ → 1
T2     : 同样的循环，failure_count → 2
T3     : 同样的循环，failure_count → 3 → quarantineTask 触发
```

实际数据（task `5466aad0`）：
- 创建：2026-05-03 19:01
- 第一次 patrol_cleanup（推算）：2026-05-03 20:01（60min 后）
- 多轮反复 patrol_cleanup 至 21:22（每次 elapsed=781-784，未归零）
- 21:22:23 quarantined（previous_status: in_progress）

### 3.5 为什么 16 个全是"修这个 bug"的任务？

被 quarantined 的 16 个 dev 任务标题：
- `[Wave1-A] tick-runner.js 去阻塞 — LLM fire-and-forget + thalamus 30s timeout`
- `[Wave1-B] Circuit Breaker PostgreSQL 持久化 — 重启自动恢复状态`（与当前分支 `cp-circuit-breaker-persist` 同主题）
- `Auto-Fix: PROBE_FAIL_RUMINATION (RCA probe_rumination)`
- `fix(brain): revert-to-queued 不清 claimed_by — 21处 SET status=queued 补 claimed_by=NULL`
- 等

系统在 2026-05-03 19:00 同时派发了一批"修复自身基础设施"的元任务。这些任务本身就因为现有 tick-runner 阻塞 + revert-to-queued 没清 claimed_by + timeout 算法 bug 而无法完成。**自愈系统撞上了它要修的那个 bug**，全部进 quarantine。

---

## 4. 桶 3：368 cancelled content-pipeline + 15 cancelled dev — 诊断盲区

`error_message` 全部为 NULL，`payload.cancel_reason` 也全部为 NULL，无法区分：
- Dashboard 用户主动批量取消？
- 系统自动 cancellation（pre-flight check / gate 拒绝）？
- 状态机异常迁移？

**这是排查时的次要盲区**，但不是当前 21% 成功率的主因。建议任何 cancel 路径强制写 `payload.cancel_reason`，但优先级 P2。

---

## 5. 修复建议（按优先级）

### P0 — 修 elapsed 算法（彻底解决 16 quarantined 这一类）

任选其一：

**选项 A**：requeue 时连带清 `run_triggered_at`：
```js
// tick-helpers.js:153
await pool.query(
  `UPDATE tasks SET status = 'queued',
     claimed_by = NULL, claimed_at = NULL, started_at = NULL,
     payload = COALESCE(payload, '{}'::jsonb) - 'run_triggered_at',
     updated_at = NOW() WHERE id = $1`,
  [task.id]
);
```

**选项 B**（更稳）：交换优先级 — 优先用 `started_at`：
```js
// tick-helpers.js:120
const triggeredAt = task.started_at || task.payload?.run_triggered_at;
```

> **A 更彻底**（让 run_triggered_at 真正只代表"原始首次派发时间"，不再被 elapsed 复用）。但需先确认没有其他地方依赖跨 requeue 持久化的 run_triggered_at（建议 grep 全仓库验证）。

### P0 — 释放当前 16 个被错杀的任务

quarantine TTL = 24h，会在 2026-05-05 09:48-10:22 自动 release。但 release 后会再次撞同一 bug → 再次 quarantine。

正确做法：**先 deploy P0 修复，再人工 release** —
```bash
curl -X POST localhost:5221/api/brain/quarantine/{task_id}/release \
  -H "Content-Type: application/json" \
  -d '{"action":"retry_once","reviewer":"rca-cp-05040101"}'
```

### P2 — Cancel 路径必填 reason

`packages/brain/src/routes/tasks.js`、Dashboard 批量取消按钮、各种 cancellation 调用：统一改成 `payload.cancel_reason` 必填，且记录 `cancelled_by` 角色。

### P3 — Tick 事件可观测性

`event_type='tick'` 在 `cecelia_events` 中 24h 内 0 行。tick 调度执行频率不可观测。建议按 hourly tick summary 写一行（不是每 tick 都写，避免淹没事件表）。

---

## 6. 不再发生的措施

1. **任何"重置任务到 queued"路径**必须连带重置时间锚字段（`started_at` / `claimed_at` / `payload.run_triggered_at`）。可在 `task-updater.js` 抽 `revertToQueued(task_id)` 共用函数，21 处 `SET status=queued` 散点收编（恰好是任务 `2fb89c77` 的主题）。
2. **patrol_cleanup 事件检测自循环**：同一 task_id 在 30min 内出现 ≥3 次 patrol_cleanup → 触发告警（说明清理无效）。
3. **退役类型 drain 已成熟**（PR #2660），但建议给 `_RETIRED_HARNESS_TYPES_DISPATCH` 加单元测试覆盖率检查，避免回归。

---

## 7. 直接回答 PRD 问题

> **是超时、依赖缺失、资源竞争，还是任务粒度设计有问题？**

**都不是**。是 **timeout 检测算法 bug 导致的死循环**：任务首次派发后 60min 未完成，就因 `run_triggered_at` 不被重置而永远超时，3 个 cycle 后被错杀进 quarantine。任务粒度本身没问题（dev 任务正常 30-60min 跑完）。

> **根本原因决定是调整拆分策略还是强化系统容量。**

**两者都不需要**。需要修 `tick-helpers.js:120 + 153-156` 的 elapsed 算法。无需改任务粒度，无需扩容。
