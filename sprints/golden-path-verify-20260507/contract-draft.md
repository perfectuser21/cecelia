# Sprint Contract Draft (Round 1)

> 验证 PR #2816：harness_initiative 任务执行完毕后 `tasks.status` 自动回写为终态（`completed` / `failed`），dispatcher 不再重复拉起。
> 本 Sprint **不修改 executor.js**，只构造端到端真实运行场景 + 复跑单元层断言。
> **journey_type**：autonomous

---

## Golden Path

[主理人触发 harness_initiative 任务] → [Brain dispatcher 派发 → executor 走 harness_initiative 分支 → runHarnessInitiativeRouter 调 compiled.stream/invoke] → [graph 跑完所有阶段（PASS 或 FAIL）] → [`tasks.status` 写入 `completed` 或 `failed`，`completed_at` 非空] → [dispatcher 后续 tick 不再把这条 task_id 重新派发]

---

### Step 1: 触发一个真实 harness_initiative 任务（fresh probe task）

**可观测行为**: 在数据库 `tasks` 表插入一条 `task_type='harness_initiative'`、`status='queued'` 的新任务，6 分钟内被 dispatcher 拉起，状态变为 `in_progress`、`started_at` 非空。

**为何要 fresh task 不复用 `84075973-...`**：本 Initiative 自身正在跑（meta-recursive），它的 row 在测试期间 status 必然是 `in_progress`，无法用作"终态判定"样本。改造为：插入一条**最小可执行**的 harness_initiative 探针任务，观察其完整生命周期。

**验证命令**:
```bash
PROBE_TASK_ID=$(psql "$DB" -t -A -c "
  INSERT INTO tasks (task_type, status, payload, priority, created_at)
  VALUES (
    'harness_initiative',
    'queued',
    '{\"initiative_id\":null,\"resume_from_checkpoint\":false,\"_probe\":true,\"_probe_sprint\":\"golden-path-verify-20260507\"}'::jsonb,
    50,
    NOW()
  )
  RETURNING id
")
echo "PROBE_TASK_ID=$PROBE_TASK_ID"
[ -n "$PROBE_TASK_ID" ] || { echo "FAIL: probe task insert returned empty"; exit 1; }

# 等待 dispatcher 拉起（最多 6 分钟，覆盖 1 个 5min tick 周期 + 余量）
for i in $(seq 1 36); do
  STATUS=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$PROBE_TASK_ID'")
  case "$STATUS" in in_progress|completed|failed) break ;; esac
  sleep 10
done

STARTED_AT=$(psql "$DB" -t -A -c "SELECT started_at FROM tasks WHERE id='$PROBE_TASK_ID'")
[ -n "$STARTED_AT" ] && [ "$STARTED_AT" != "null" ] || {
  echo "FAIL: probe task never started within 6 minutes (status=$STATUS, started_at=$STARTED_AT)"
  exit 1
}
echo "✅ Step 1: probe task started at $STARTED_AT"
```

**硬阈值**:
- `tasks WHERE id=$PROBE_TASK_ID` 的 `started_at` 在 6 分钟内非空；
- `status` ∈ `{in_progress, completed, failed}`，**不是** `queued`。

---

### Step 2: graph 真的跑了且已停手

**可观测行为**: `task_events` 表至少出现 1 条 `event_type='graph_node_update'` 且 `task_id=$PROBE_TASK_ID` 的行（证明 streamMode 'updates' 真把 graph 节点 emit 出来），且最近 5 分钟内不再出现新的 graph_node_update（证明 graph 跑完终止，不是死循环）。

**验证命令**:
```bash
# graph 至少跑过一个节点
for i in $(seq 1 60); do
  NC=$(psql "$DB" -t -A -c "
    SELECT count(*) FROM task_events
     WHERE task_id='$PROBE_TASK_ID'
       AND event_type='graph_node_update'
       AND created_at > NOW() - interval '60 minutes'
  ")
  [ "$NC" -ge 1 ] && break
  sleep 10
done
[ "$NC" -ge 1 ] || {
  echo "FAIL: graph_node_update event count = $NC (expected >=1)"
  exit 1
}
echo "✅ Step 2a: graph emitted $NC node updates"

# graph 停手判定：最近 5min 内无新 event；若仍有，再等 5min 复测
for i in $(seq 1 36); do
  RECENT=$(psql "$DB" -t -A -c "
    SELECT count(*) FROM task_events
     WHERE task_id='$PROBE_TASK_ID'
       AND event_type='graph_node_update'
       AND created_at > NOW() - interval '5 minutes'
  ")
  [ "$RECENT" -eq 0 ] && break
  sleep 30
done
[ "$RECENT" -eq 0 ] || {
  echo "FAIL: graph still emitting node updates within last 5min after 18min wait (count=$RECENT)"
  exit 1
}
echo "✅ Step 2b: graph quiesced (no new node updates in last 5min)"
```

**硬阈值**:
- `task_events` 表中 `event_type='graph_node_update' AND task_id=$PROBE_TASK_ID AND created_at > NOW() - interval '60 minutes'` 的 count ≥ 1；
- 最近 5 分钟内 `graph_node_update` count = 0（graph 已停手）。

---

### Step 3: tasks.status 写入终态（**核心断言**）

**可观测行为**: 探针任务的 `status` 字段最终值 ∈ `{completed, failed}`，**不是** `in_progress` 或 `queued`；`completed_at` 非空且 `>= started_at`。

**验证命令**:
```bash
# graph quiesce 后再给 90s 让 status writeback 落地
sleep 90

ROW=$(psql "$DB" -t -A -F '|' -c "
  SELECT status, started_at, completed_at, error_message
    FROM tasks WHERE id='$PROBE_TASK_ID'
")
STATUS=$(echo "$ROW" | cut -d'|' -f1)
STARTED_AT=$(echo "$ROW" | cut -d'|' -f2)
COMPLETED_AT=$(echo "$ROW" | cut -d'|' -f3)
ERROR_MSG=$(echo "$ROW" | cut -d'|' -f4)

echo "status=$STATUS started_at=$STARTED_AT completed_at=$COMPLETED_AT error_message=$ERROR_MSG"

# 核心断言：终态
case "$STATUS" in
  completed|failed) ;;
  *) echo "FAIL: terminal status expected completed|failed, got '$STATUS'"; exit 1 ;;
esac

# completed_at 非空且 >= started_at（用 SQL 比时间戳，规避 shell 时区/格式坑）
[ -n "$COMPLETED_AT" ] && [ "$COMPLETED_AT" != "null" ] || {
  echo "FAIL: completed_at is empty (status=$STATUS)"; exit 1
}
ORDER_OK=$(psql "$DB" -t -A -c "
  SELECT (completed_at >= started_at) FROM tasks WHERE id='$PROBE_TASK_ID'
")
[ "$ORDER_OK" = "t" ] || {
  echo "FAIL: completed_at ($COMPLETED_AT) not >= started_at ($STARTED_AT)"; exit 1
}
echo "✅ Step 3: terminal status=$STATUS, completed_at >= started_at"
```

**硬阈值**:
- `status` ∈ `{completed, failed}`；
- `completed_at IS NOT NULL` 且 `completed_at >= started_at`；
- 时间戳比对用 SQL（防时区/格式造假）。

---

### Step 4: dispatcher 不再重复拉起这条 task_id

**可观测行为**: 终态落地后 10 分钟内，`run_events` 表中 `task_id=$PROBE_TASK_ID` 的活跃 run（`status IN ('running','queued')`）数量 = 0，且 `tasks.status` 不会被某个 tick 改回 `queued` / `in_progress`。

**验证命令**:
```bash
# 终态后再观察 10 分钟（覆盖至少 2 个 5min tick 周期）
sleep 600

# 4a：tasks.status 没被回滚
STATUS_AFTER=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$PROBE_TASK_ID'")
case "$STATUS_AFTER" in
  completed|failed) ;;
  *) echo "FAIL: status regressed from terminal back to '$STATUS_AFTER' after 10min"; exit 1 ;;
esac

# 4b：没有新的活跃 run 针对该 task
ACTIVE_RUNS=$(psql "$DB" -t -A -c "
  SELECT count(*) FROM run_events
   WHERE task_id='$PROBE_TASK_ID'
     AND status IN ('running','queued')
     AND ts_start > NOW() - interval '10 minutes'
")
[ "$ACTIVE_RUNS" -eq 0 ] || {
  echo "FAIL: dispatcher created $ACTIVE_RUNS new active runs for terminal task"; exit 1
}

# 4c：tick_decisions 没有针对该 task_id 的 requeue/reschedule 决策
REQUEUE_COUNT=$(psql "$DB" -t -A -c "
  SELECT count(*) FROM tick_decisions
   WHERE created_at > NOW() - interval '10 minutes'
     AND payload->>'task_id' = '$PROBE_TASK_ID'
     AND payload->>'action' IN ('executor_failed','requeue','reschedule')
")
[ "$REQUEUE_COUNT" -eq 0 ] || {
  echo "FAIL: dispatcher logged $REQUEUE_COUNT requeue/reschedule decisions for terminal task"; exit 1
}
echo "✅ Step 4: no requeue/active-run for terminal task in last 10min (status=$STATUS_AFTER)"
```

**硬阈值**:
- 10 分钟观察窗内 `tasks.status` 仍 ∈ `{completed, failed}`，未回退；
- `run_events` 中 `status IN ('running','queued') AND ts_start > NOW() - interval '10 minutes'` 的 count = 0；
- `tick_decisions` 中针对该 task_id 的 requeue/reschedule 决策 count = 0。

---

### Step 5: 单元层守护断言不退化

**可观测行为**: 优先跑 PR #2816 自带的 `executor-harness-initiative-status-writeback.test.js`；若该文件**不存在**（PRD 假设的测试文件未在 main 上落地），fallback 跑 `tests/ws2/` 下本 Sprint 自补的 4 项 BEHAVIOR 单元测试。两者择一，不能缺。

**验证命令**:
```bash
TEST_PATH="packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js"
if [ -f "$TEST_PATH" ]; then
  npx vitest run "$TEST_PATH" --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
  PASSED=$(grep -cE "✓" /tmp/ws2-unit.log || true)
  FAILED=$(grep -cE "✗" /tmp/ws2-unit.log || true)
  [ "$PASSED" -ge 4 ] && [ "$FAILED" -eq 0 ] || {
    echo "FAIL: status-writeback unit tests passed=$PASSED failed=$FAILED (expected passed>=4 failed=0)"
    exit 1
  }
else
  npx vitest run sprints/golden-path-verify-20260507/tests/ws2/ --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
  PASSED=$(grep -cE "✓" /tmp/ws2-unit.log || true)
  FAILED=$(grep -cE "✗" /tmp/ws2-unit.log || true)
  [ "$PASSED" -ge 4 ] && [ "$FAILED" -eq 0 ] || {
    echo "FAIL: ws2 fallback unit tests passed=$PASSED failed=$FAILED (expected passed>=4 failed=0)"
    exit 1
  }
fi
echo "✅ Step 5: unit-layer status writeback assertions hold"
```

**硬阈值**:
- 4 项断言全部 PASS（来自 PRD 引用文件 OR 本 Sprint 补的 fallback 测试）；
- 0 failed。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/golden-path-verify-20260507"

echo "=== Step 1: 注入 harness_initiative 探针任务 ==="
PROBE_TASK_ID=$(psql "$DB" -t -A -c "
  INSERT INTO tasks (task_type, status, payload, priority, created_at)
  VALUES (
    'harness_initiative',
    'queued',
    '{\"initiative_id\":null,\"resume_from_checkpoint\":false,\"_probe\":true,\"_probe_sprint\":\"golden-path-verify-20260507\"}'::jsonb,
    50,
    NOW()
  )
  RETURNING id
")
echo "PROBE_TASK_ID=$PROBE_TASK_ID"
[ -n "$PROBE_TASK_ID" ] || { echo "FAIL: insert returned empty"; exit 1; }

echo "=== Step 1 wait: dispatcher pickup (≤6min) ==="
for i in $(seq 1 36); do
  STATUS=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$PROBE_TASK_ID'")
  case "$STATUS" in in_progress|completed|failed) break ;; esac
  sleep 10
done
STARTED_AT=$(psql "$DB" -t -A -c "SELECT started_at FROM tasks WHERE id='$PROBE_TASK_ID'")
[ -n "$STARTED_AT" ] && [ "$STARTED_AT" != "null" ] || { echo "FAIL Step 1: never started"; exit 1; }

echo "=== Step 2a: 等 graph 跑出至少 1 个节点 ==="
for i in $(seq 1 60); do
  NC=$(psql "$DB" -t -A -c "SELECT count(*) FROM task_events WHERE task_id='$PROBE_TASK_ID' AND event_type='graph_node_update' AND created_at > NOW() - interval '60 minutes'")
  [ "$NC" -ge 1 ] && break
  sleep 10
done
[ "$NC" -ge 1 ] || { echo "FAIL Step 2a: graph_node_update count=$NC"; exit 1; }

echo "=== Step 2b: graph quiesce ==="
QUIESCED=0
for i in $(seq 1 36); do
  RECENT=$(psql "$DB" -t -A -c "SELECT count(*) FROM task_events WHERE task_id='$PROBE_TASK_ID' AND event_type='graph_node_update' AND created_at > NOW() - interval '5 minutes'")
  if [ "$RECENT" -eq 0 ]; then QUIESCED=1; break; fi
  sleep 30
done
[ "$QUIESCED" -eq 1 ] || { echo "FAIL Step 2b: graph never quiesced in 18min"; exit 1; }

echo "=== Step 3: 终态断言 ==="
sleep 90
ROW=$(psql "$DB" -t -A -F '|' -c "SELECT status, started_at, completed_at, error_message FROM tasks WHERE id='$PROBE_TASK_ID'")
STATUS=$(echo "$ROW" | cut -d'|' -f1)
COMPLETED_AT=$(echo "$ROW" | cut -d'|' -f3)
case "$STATUS" in completed|failed) ;; *) echo "FAIL Step 3: status=$STATUS"; exit 1 ;; esac
[ -n "$COMPLETED_AT" ] && [ "$COMPLETED_AT" != "null" ] || { echo "FAIL Step 3: completed_at empty"; exit 1; }
ORDER_OK=$(psql "$DB" -t -A -c "SELECT (completed_at >= started_at) FROM tasks WHERE id='$PROBE_TASK_ID'")
[ "$ORDER_OK" = "t" ] || { echo "FAIL Step 3: completed_at < started_at"; exit 1; }

echo "=== Step 4: 无重复拉起（10min 观察） ==="
sleep 600
STATUS_AFTER=$(psql "$DB" -t -A -c "SELECT status FROM tasks WHERE id='$PROBE_TASK_ID'")
case "$STATUS_AFTER" in completed|failed) ;; *) echo "FAIL Step 4: status regressed to $STATUS_AFTER"; exit 1 ;; esac
ACTIVE=$(psql "$DB" -t -A -c "SELECT count(*) FROM run_events WHERE task_id='$PROBE_TASK_ID' AND status IN ('running','queued') AND ts_start > NOW() - interval '10 minutes'")
[ "$ACTIVE" -eq 0 ] || { echo "FAIL Step 4: $ACTIVE active runs after terminal"; exit 1; }
REQUEUE=$(psql "$DB" -t -A -c "SELECT count(*) FROM tick_decisions WHERE created_at > NOW() - interval '10 minutes' AND payload->>'task_id'='$PROBE_TASK_ID' AND payload->>'action' IN ('executor_failed','requeue','reschedule')")
[ "$REQUEUE" -eq 0 ] || { echo "FAIL Step 4: $REQUEUE requeue decisions"; exit 1; }

echo "=== Step 5: 单元层守护断言 ==="
TEST_PATH="packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js"
if [ -f "$TEST_PATH" ]; then
  npx vitest run "$TEST_PATH" --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
else
  npx vitest run "$SPRINT_DIR/tests/ws2/" --reporter=verbose 2>&1 | tee /tmp/ws2-unit.log
fi
PASSED=$(grep -cE "✓" /tmp/ws2-unit.log || true)
FAILED=$(grep -cE "✗" /tmp/ws2-unit.log || true)
[ "$PASSED" -ge 4 ] && [ "$FAILED" -eq 0 ] || { echo "FAIL Step 5: passed=$PASSED failed=$FAILED"; exit 1; }

echo "✅ Golden Path 验证通过 (PROBE_TASK_ID=$PROBE_TASK_ID, 终态=$STATUS_AFTER)"
```

**通过标准**: 脚本 exit 0，且最终 echo 中 `终态=$STATUS_AFTER` ∈ `{completed, failed}`。

---

## Workstreams

workstream_count: 2

### Workstream 1: 端到端真实运行 + DB 终态断言

**范围**:
- 编写 `scripts/probe-harness-initiative-writeback.sh`：注入探针任务 → 等终态 → 断言 4 步硬阈值（Steps 1–4）；
- 脚本退出码 = E2E 验收脚本退出码（任一步失败 exit ≠ 0）；
- 输出归档到 `${SPRINT_DIR}/run-${TIMESTAMP}/result.json`，含 PROBE_TASK_ID、终态、各步耗时。

**大小**: M（约 150–250 行 shell + jq）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/probe-status-writeback.test.ts`

---

### Workstream 2: 单元层守护断言（fallback）

**范围**:
- 跑 PR #2816 自带 `executor-harness-initiative-status-writeback.test.js`；
- 该文件不存在时 → 在 `tests/ws2/` 下补 4 项 BEHAVIOR 单元测试，覆盖：
  1. `runHarnessInitiativeRouter` 收到 `final={}`（无 error）→ 返回 `ok=true`；
  2. 收到 `final={error:'evaluator_fail'}` → 返回 `ok=false, finalState.error='evaluator_fail'`；
  3. compiled.stream 抛 AbortError（watchdog）→ 写 `task.failure_class='watchdog_deadline'`，返回 `ok=false, error='watchdog_deadline'`；
  4. compiled.stream 抛任意未知异常 → 异常向上抛（被外层 caller catch），不污染 task row；
- 复跑 dispatcher 现有 `dispatcher-default-graph.test.js`，确认 dispatcher 不会重选 status=completed/failed 的 task。

**大小**: M（约 150–250 行 TS + vitest）

**依赖**: 与 WS1 并行；E2E 脚本里 Step 5 依赖 WS2 产物存在。

**BEHAVIOR 覆盖测试文件**: `tests/ws2/status-writeback-unit.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/probe-status-writeback.test.ts` | (a) 探针任务在 6min 内被 dispatcher 拉起；(b) graph 至少 emit 1 个 node update 后停手；(c) 探针终态 ∈ {completed, failed} 且 completed_at >= started_at；(d) 终态后 10min 不被重新派发 | WS1 → 4 failures（脚本未实现 / 探针注入失败 / 终态判定失败 / 重派检测失败） |
| WS2 | `tests/ws2/status-writeback-unit.test.ts` | (a) graph success → router ok=true；(b) graph error → router ok=false；(c) watchdog → 写 failure_class；(d) 未知异常 → 不静默吞 | WS2 → 4 failures（mock 未搭好 / 4 项断言全红） |

---

## 验证命令规范自检（GAN 对抗焦点 — Reviewer 重点）

- [x] 所有 `SELECT count(*)` 都带时间窗口（`created_at > NOW() - interval 'X minutes'` / `ts_start > NOW() - interval 'X minutes'`），防止历史数据污染或手动 INSERT 造假；
- [x] 时间戳比较用 SQL `(completed_at >= started_at)`，规避 shell 字符串/时区造假；
- [x] 没有 `echo "ok"` / `true` 假绿验证；
- [x] `$PROBE_TASK_ID` 在 Step 1 注入后才被引用，`$DB` 由 cecelia-run 注入或 fallback `postgresql://localhost/cecelia`；
- [x] 探针用 fresh task 而非复用 `84075973-...`，避免"自指悖论"（meta-recursive 任务永远 in_progress）；
- [x] 终态判定接受 `{completed, failed}` 双终态，匹配 PRD"FAIL 也算闭环"；
- [x] Step 4 观察窗 = 10min（覆盖至少 2 个 5min tick 周期），避开"恰好这一 tick 没拉到所以假绿"；
- [x] Step 5 双路径设计应对 PRD 引用的 unit test 文件可能不存在的现实（避免 hard-coded 文件路径假绿）。

---

## 已知 PRD 风险登记（Risks Registered）

供 Reviewer 评估"是否需打回 PRD"：

1. **PR #2816 引用的测试文件 `executor-harness-initiative-status-writeback.test.js` 在当前 main 上不存在**（已 grep 确认）。Step 5 用 fallback 路径处理，但 PRD 假设可能不成立 → 建议 Reviewer 让 Planner 在下一轮明确：是 PRD 写错了文件名 / PR 没合上去 / 还是该测试本就要本 Sprint 自补。
2. **executor.js 的 harness_initiative 分支（lines 2964–2982）当前未直接调用 `updateTaskStatus`**——它返回 `{success: result.ok}`，由 dispatcher（line 480-495）按 `success` 判断"失败回退 queued / 成功放手"。状态 `completed/failed` 的实际写入路径可能在 callback worker / monitor-loop / run_events reconciler。本合同的 Step 3 只断言"终态可见"，不断言"由谁写"，对实现路径保持中立——这是优势（端到端不在意中间链路）也是风险（如果终态由 monitor-loop 兜底而非 executor 主动写，PRD 描述的"修复路径"就和现实有偏差）。建议 Reviewer 决定是否要求合同细化为"由 executor 主动调 updateTaskStatus"。
