# Sprint PRD：dispatcher 坏任务自动隔离

**Sprint ID**: 07141332-dispatch-fail-autoblock
**Task ID**: 7c5d6df8-791c-4190-8db8-1274cef9071c
**日期**: 2026-07-14
**状态**: READY

---

## 一、背景与症状

2026-07-14 11:04–11:38，research 任务 `9fbfbb63` 因 `buildCodexBridgePayload` 缺少
`callback_url` 导致 `triggerCeceliaRun` 每次必返回 `success=false`。dispatcher 每 tick
将其 revert 回 `queued`，下一 tick 它仍以高优先级排候选头名，再次被选中，再次失败——
34 分钟内占据派发槽、熔断（cecelia-run breaker）OPEN 后半开探针仍命中同一任务，
后续 P1 harness 任务零派发，靠人工 `block` 止血。

**根因**：dispatcher 在 `triggerCeceliaRun` 失败后仅 revert `queued` + 计入熔断计数，
对单任务连续失败无任何隔离机制，坏任务可无限霸占队列头。

---

## 二、目标与约束

### 目标
在 dispatcher 派发失败路径上挂钩：同一任务连续失败达阈值 → 自动转 `blocked`，
排出候选池，其余任务恢复正常派发。

### 硬约束（不可违反）
1. **不改熔断器语义**：`circuit-breaker.js` / `recordFailure('cecelia-run')` 逻辑保持原样
2. **不动 harness 并发闸**：`MAX_CONCURRENT_HARNESS_INITIATIVES` 不受影响
3. **blocked 走既有状态机**：调用 `task-updater.js::blockTask()` 同款路径，
   不发明新状态、不新增 DB 字段（复用 `blocked_reason` / `blocked_detail` / `metadata`）
4. **只挂 dispatcher 派发失败路径**：仅 `triggerCeceliaRun` 返回 `success=false`
   且非 `configError` 且非 `spawn_deduplicated` 时触发计数——
   任务执行失败（zombie-reaper 管辖）、pre-flight 失败（已有三振逻辑）不受影响
5. **计数持久化**：重启不丢，存入 `tasks.metadata`（`dispatch_fail_consecutive`）

---

## 三、功能需求（FR）

### FR-1 连续失败计数
- 每次 `triggerCeceliaRun` 失败（`!execResult.success`，且非 `configError`，
  且非 `spawn_deduplicated`）后，读取 `tasks.metadata.dispatch_fail_consecutive`，
  加 1 后写回。
- 成功派发时将 `dispatch_fail_consecutive` 清零（reset to 0）。
- 字段写入合并进现有 `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL` 那次
  或单独 `UPDATE tasks SET metadata = ...`，不允许新增独立表或列。

### FR-2 阈值自动隔离
- 当 `dispatch_fail_consecutive` 达到阈值 `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD`（默认 3）
  时，调用 `blockTask(taskId, { reason: 'dispatch_fail_autoblock', detail: {...} })`。
- `detail` 包含：`{ consecutive_failures: N, last_error: '...', blocked_at_tick: <ISO> }`。
- 阈值通过环境变量 `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD` 覆盖（`parseInt`，合法值 ≥ 1）；
  非法值回退默认 3。
- `configError` 和 `spawn_deduplicated` 两类失败**不计入**连续计数，不触发 autoblock。

### FR-3 候选不再含 blocked 任务
- 无需额外实现：`selectNextDispatchableTask`（`dispatch-helpers.js`）已过滤
  `status != 'blocked'`，FR-2 调用 `blockTask` 后下一 tick 自动排出。

### FR-4 告警
- autoblock 触发时调用 `raise('P2', 'dispatch_fail_autoblock', message)`
  （`alerting.js` 现有接口）。
- 单元测试通过 mock `alerting` 模块断言调用发生（不依赖真实飞书推送）。

### FR-5 成功重置
- 派发成功后（`execResult.success === true`，进入 post-success bookkeeping 区块前）
  将 `dispatch_fail_consecutive` 清零——仅当字段 > 0 时才写 DB（避免无效更新）。
- 语义：**连续**计数，成功打断即归零；下次失败重新从 1 累计。

---

## 四、Golden Path（测试先行）

### GP-1：三连失败 → 自动 blocked（failing test 先 commit）
```
arrange: task queued, mockTriggerCeceliaRun 返回 { success: false, error: 'payload missing callback_url' }
act:     连续调用 dispatchNextTask（或 dispatcher 内部逻辑）3 次
assert:  task.status === 'blocked'
         task.blocked_reason === 'dispatch_fail_autoblock'
         task.metadata.dispatch_fail_consecutive === 3（或已写入 blocked_detail）
         raise('P2', ...) 被调用 1 次
```

### GP-2：第 4 个 tick 候选选择跳过该任务
```
arrange: task 已 blocked（GP-1 后）+ 另一个 queued task B
act:     dispatchNextTask（或 selectNextDispatchableTask）
assert:  返回 dispatched task_id === B.id（不是 blocked task）
```

### GP-3：成功重置连续计数
```
arrange: task 失败 2 次（metadata.dispatch_fail_consecutive === 2），第 3 次成功
act:     第 3 次 triggerCeceliaRun 返回 { success: true }
assert:  task.metadata.dispatch_fail_consecutive === 0（或字段被清除）
         task.status === 'in_progress'（非 blocked）
act:     再失败 2 次
assert:  task.metadata.dispatch_fail_consecutive === 2（未触发 block）
```

### GP-4：阈值可覆盖
```
arrange: DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=2
act:     失败 2 次
assert:  task.status === 'blocked'
```

### GP-5：configError 不计入
```
arrange: triggerCeceliaRun 返回 { success: false, configError: true }
act:     3 次
assert:  task.metadata.dispatch_fail_consecutive === 0（或未写）
         task.status === 'queued'（未 blocked）
```

---

## 五、验收标准（DoD）

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | failing test 先 commit，修复后全绿 | CI `packages/brain` test suite |
| 2 | `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD` env 生效 | GP-4 单测 |
| 3 | 计数持久化（重启不丢） | metadata 存 DB，GP-1 断言 |
| 4 | 既有 dispatcher 测试全过 | CI 不红 |
| 5 | CI 全绿（brain-ci.yml） | GitHub Actions |

---

## 六、非功能需求（NFR）

- **延迟**：autoblock 逻辑在 `triggerCeceliaRun` 失败后同步执行，整体增加 < 5ms
  （仅一次 DB UPDATE + 一次 blockTask 调用）
- **DB 写放大**：仅在失败路径写计数，正常派发成功路径仅在 `dispatch_fail_consecutive > 0`
  时才清零（条件写，避免每次成功都多一次 UPDATE）
- **幂等**：同一任务重复 block（竞态）由 `blockTask` WHERE 子句 `AND status IN ('queued', 'in_progress', 'failed')` 天然幂等
- **可观测**：autoblock 时 `[dispatch]` 日志输出含 task_id + consecutive_failures；
  `blocked_detail` 可通过 `/api/brain/tasks?status=blocked` 接口查询

---

## 七、实现范围

### 改动文件
| 文件 | 改动说明 |
|------|---------|
| `packages/brain/src/dispatcher.js` | 在 `triggerCeceliaRun` 失败后插入计数+autoblock逻辑；成功后清零 |
| `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js` | 新增（GP-1～GP-5）|

### 不动文件
- `circuit-breaker.js`：不改熔断语义
- `dispatch-helpers.js`：候选过滤已排 blocked，无需改
- `task-updater.js`：复用 `blockTask()`，不改接口
- `pre-flight-check.js`：三振逻辑独立，不合并

---

## 八、不变量（Invariants）

1. **IN-1**：`configError=true` 的失败不写 `dispatch_fail_consecutive`，不触发 autoblock
2. **IN-2**：`spawn_deduplicated` 的失败不写 `dispatch_fail_consecutive`，不触发 autoblock
3. **IN-3**：autoblock 调用 `blockTask()` 同款路径，`blocked_reason='dispatch_fail_autoblock'`
4. **IN-4**：成功派发后 `dispatch_fail_consecutive` 归零（仅在 > 0 时写 DB）
5. **IN-5**：阈值 env `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD` 非法值（NaN / < 1）回退默认 3
6. **IN-6**：autoblock 后候选循环下一 tick 自动跳过（无需额外过滤代码）
7. **IN-7**：`raise('P2', 'dispatch_fail_autoblock', ...)` 在 block 时调用且仅调用 1 次

共 **7 条不变量**，**5 条 FR**。

---

## 九、累积 FR 追踪

| Sprint | FR | 描述 |
|--------|-----|------|
| 07141331-research-dispatch-payload | FR-A | buildCodexBridgePayload 补 callback_url |
| **07141332-dispatch-fail-autoblock** | **FR-1~5** | dispatcher 坏任务自动隔离（本 Sprint）|

累积 FR 总数：**6**（含前序 Sprint 1 条）

---

*生成时间：2026-07-14 | Brain Task: 7c5d6df8*
