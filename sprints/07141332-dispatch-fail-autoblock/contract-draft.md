# Contract Draft：dispatcher 坏任务自动隔离

**Sprint ID**: 07141332-dispatch-fail-autoblock
**Task ID**: 7c5d6df8-791c-4190-8db8-1274cef9071c
**Contract 版本**: v1（第 1 轮，无上轮 reviewer feedback）
**日期**: 2026-07-14

---

## [BEHAVIOR] 行为断言清单

### [BEHAVIOR-1] 三连失败 → 任务自动转 blocked
- **前置**：task 状态 queued；`triggerCeceliaRun` mock 返回 `{ success: false, error: 'payload missing callback_url' }`
- **操作**：连续调用 `dispatchNextTask`（或内部路径）3 次，每次均命中同一 task
- **断言**：
  - `task.status === 'blocked'`
  - `task.blocked_reason === 'dispatch_fail_autoblock'`
  - `task.metadata.dispatch_fail_consecutive === 3`（或写入 `blocked_detail`）
  - `raise('P2', 'dispatch_fail_autoblock', ...)` 被调用 **1 次**
  - 返回值 `dispatched === false`，`reason === 'dispatch_fail_autoblock'`

### [BEHAVIOR-2] blocked 任务不再进入候选池
- **前置**：task A 已 blocked（由 [BEHAVIOR-1] 触发）；task B 状态 queued
- **操作**：调用 `selectNextDispatchableTask`（或 `dispatchNextTask`）
- **断言**：
  - 返回/派发的任务 ID 为 task B（不是 task A）
  - task A 不被重新派发

### [BEHAVIOR-3] 成功派发重置连续计数
- **前置**：task 已失败 2 次（`metadata.dispatch_fail_consecutive === 2`）；第 3 次 `triggerCeceliaRun` 返回 `{ success: true }`
- **操作**：第 3 次调用 `dispatchNextTask`
- **断言**：
  - `task.metadata.dispatch_fail_consecutive === 0`（或字段被清除）
  - `task.status === 'in_progress'`（未 blocked）
- **续操作**：再失败 2 次
- **续断言**：`task.metadata.dispatch_fail_consecutive === 2`，task.status 仍为 queued（未 blocked，阈值未达 3）

### [BEHAVIOR-4] 阈值通过环境变量覆盖
- **前置**：`DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=2`
- **操作**：同一 task 失败 2 次
- **断言**：
  - `task.status === 'blocked'`，第 2 次失败即触发 autoblock
  - `raise('P2', 'dispatch_fail_autoblock', ...)` 被调用 1 次

### [BEHAVIOR-5] configError 失败不计入连续计数
- **前置**：`triggerCeceliaRun` 返回 `{ success: false, configError: true, reason: 'no_codex_cli' }`
- **操作**：连续 3 次
- **断言**：
  - `task.metadata.dispatch_fail_consecutive === 0`（或字段未被写入）
  - `task.status === 'queued'`（未 blocked）
  - `raise` 未被调用（autoblock 未触发）

### [BEHAVIOR-6] spawn_deduplicated 失败不计入连续计数
- **前置**：`triggerCeceliaRun` 返回 `{ success: false, reason: 'spawn_deduplicated' }`
- **操作**：连续 3 次
- **断言**：
  - `task.metadata.dispatch_fail_consecutive === 0`（或字段未被写入）
  - `task.status === 'queued'`（未 blocked）
  - `raise` 未被调用

### [BEHAVIOR-7] 阈值非法值回退默认 3
- **场景**：`DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=abc`（NaN）
- **断言**：实际阈值为 3（失败 2 次不 block，第 3 次 block）
- **场景 2**：`DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=0`（< 1）
- **断言**：实际阈值为 3（同上）

---

## ## E2E 验收段

### E2E-1（unit，自动化）：GP-1～GP-5 全通

执行命令：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/dispatch-fail-autoblock.test.js
```

期望输出：
- 5 个 `describe` 块（GP-1～GP-5）全部 PASS
- 无 failing / skipped test
- CI `packages/brain` test suite 绿

### E2E-2（unit，自动化）：既有 dispatcher 测试不红

执行命令：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/dispatch-executor-fail.test.js packages/brain/src/__tests__/dispatch-dedup.test.js packages/brain/src/__tests__/dispatch-events.test.js
```

期望输出：
- 全部 PASS，无 regression

### E2E-3（manual:bash，本地验证）：metadata 持久化验证

```bash
# 步骤 1：找一个 queued task（或插入测试数据）
psql $DATABASE_URL -c "SELECT id, title, status, metadata FROM tasks WHERE status='queued' LIMIT 1;"

# 步骤 2：通过 Brain API 触发派发（假设 cecelia-run 不可用时会失败累计）
# 或直接 UPDATE 模拟累积：
psql $DATABASE_URL -c "UPDATE tasks SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{dispatch_fail_consecutive}', '2') WHERE id='<task_id>';"

# 步骤 3：触发第 3 次失败（重启 Brain 后重试）
# restart brain, allow dispatcher to pick up same task

# 步骤 4：验证 task 已 blocked，且 metadata 持久化
psql $DATABASE_URL -c "SELECT id, status, blocked_reason, blocked_detail, metadata->>'dispatch_fail_consecutive' AS fail_count FROM tasks WHERE id='<task_id>';"
# 期望：status='blocked', blocked_reason='dispatch_fail_autoblock', fail_count='3'
```

### E2E-4（manual:bash，CI）：brain-ci.yml 全绿

```bash
gh run list --workflow=brain-ci.yml --limit=3
gh run view <latest_run_id>
```

期望：全部 steps 绿，无 failing test

---

## 技术实现要点（供 Planner 参考）

### 改动文件
| 文件 | 改动说明 |
|------|---------|
| `packages/brain/src/dispatcher.js` | 在失败路径（`!execResult.success` 且非 `configError` 且非 `spawn_deduplicated`）后：读 `metadata.dispatch_fail_consecutive` → +1 → 写回；达阈值调用 `blockTask()` + `raise('P2', ...)`；成功路径：仅在 `dispatch_fail_consecutive > 0` 时清零 |
| `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js` | 新增（GP-1～GP-5 对应 [BEHAVIOR-1]～[BEHAVIOR-5]） |

### 新增导入（dispatcher.js）
```js
import { blockTask } from './task-updater.js';
import { raise } from './alerting.js';
```

### 阈值常量
```js
export const DISPATCH_FAIL_AUTOBLOCK_THRESHOLD = (() => {
  const raw = parseInt(process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD || '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 3;
})();
```

### 失败路径插入点
在 `dispatcher.js` 约 L771（`await recordFailure('cecelia-run')` 之后，`await logTickDecision(...)` 之前）插入计数 + autoblock 逻辑：

```js
// dispatch-fail-autoblock：连续失败计数 + 阈值隔离
if (!execResult.configError && execResult.reason !== 'spawn_deduplicated') {
  try {
    const taskRow = await pool.query(
      `SELECT metadata FROM tasks WHERE id = $1`, [nextTask.id]
    );
    const prevCount = taskRow.rows[0]?.metadata?.dispatch_fail_consecutive ?? 0;
    const newCount = prevCount + 1;
    await pool.query(
      `UPDATE tasks SET metadata = COALESCE(metadata,'{}')::jsonb || $2::jsonb WHERE id = $1`,
      [nextTask.id, JSON.stringify({ dispatch_fail_consecutive: newCount })]
    );
    if (newCount >= DISPATCH_FAIL_AUTOBLOCK_THRESHOLD) {
      const detail = {
        consecutive_failures: newCount,
        last_error: execResult.error || execResult.reason || 'unknown',
        blocked_at_tick: new Date().toISOString(),
      };
      await blockTask(nextTask.id, { reason: 'dispatch_fail_autoblock', detail });
      const { raise } = await import('./alerting.js');
      raise('P2', 'dispatch_fail_autoblock',
        `[dispatch] task ${nextTask.id} (${nextTask.title}) auto-blocked after ${newCount} consecutive dispatch failures`
      );
      tickLog(`[dispatch] task ${nextTask.id} auto-blocked: dispatch_fail_consecutive=${newCount}`);
    }
  } catch (autoblockErr) {
    console.error(`[dispatch] autoblock logic failed (non-fatal): ${autoblockErr.message}`);
  }
}
```

### 成功路径清零（post-success bookkeeping 区块开头插入）
```js
// 成功派发后清零连续失败计数（仅在 > 0 时写 DB）
try {
  const metaRow = await pool.query(`SELECT metadata FROM tasks WHERE id = $1`, [nextTask.id]);
  if ((metaRow.rows[0]?.metadata?.dispatch_fail_consecutive ?? 0) > 0) {
    await pool.query(
      `UPDATE tasks SET metadata = COALESCE(metadata,'{}')::jsonb || $2::jsonb WHERE id = $1`,
      [nextTask.id, JSON.stringify({ dispatch_fail_consecutive: 0 })]
    );
  }
} catch (resetErr) {
  console.error(`[dispatch] dispatch_fail_consecutive reset failed (non-fatal): ${resetErr.message}`);
}
```

---

## 不变量确认（IN-1～IN-7）

| IN | 描述 | 对应测试 |
|----|------|---------|
| IN-1 | configError 失败不写计数、不 autoblock | GP-5 / [BEHAVIOR-5] |
| IN-2 | spawn_deduplicated 失败不写计数、不 autoblock | [BEHAVIOR-6]（扩展 GP-5） |
| IN-3 | autoblock 调用 `blockTask()`，`blocked_reason='dispatch_fail_autoblock'` | GP-1 / [BEHAVIOR-1] |
| IN-4 | 成功派发后 `dispatch_fail_consecutive` 归零（仅 > 0 时写 DB） | GP-3 / [BEHAVIOR-3] |
| IN-5 | 阈值非法值回退默认 3 | GP-4 / [BEHAVIOR-4]，[BEHAVIOR-7] |
| IN-6 | autoblock 后候选循环自动跳过（blocked 不入候选） | GP-2 / [BEHAVIOR-2] |
| IN-7 | `raise('P2', ...)` 在 block 时调用且仅调用 1 次 | GP-1 / [BEHAVIOR-1] |
