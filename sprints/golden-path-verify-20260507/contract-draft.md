# Sprint Contract Draft (Round 1) — 验证 PR #2816 harness_initiative status 自动回写

> **被验证对象**：`packages/brain/src/executor.js` 的 `runHarnessInitiativeRouter` 分支。
> **本 Sprint 不修改实现**，只观察其在真实 Brain runtime 中的可见行为。
> **journey_type**：autonomous

---

## Golden Path

[Brain 派发 harness_initiative task] → [executor 进入 harness_initiative 分支 / 调度 LangGraph 子图执行完毕] → [executor 回写 tasks.status ∈ {completed, failed}] → [dispatcher 不再重复拉起该 task_id]

---

### Step 1: harness_initiative 任务被 Brain 派发并标 in_progress

**可观测行为**：DB `tasks` 表中存在一行 `task_type = 'harness_initiative'` 且 `status = 'in_progress'`、`started_at IS NOT NULL` 的任务（由 dispatcher 在 `triggerCeceliaRun` 之前 mark），紧接着 executor 进入 `runHarnessInitiativeRouter`。

**验证命令**：
```bash
# 入口断言：本 Initiative 自身的 task_id（PRD 指定）已被标 in_progress 且确实是 harness_initiative
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"
psql "$DB" -tA -c "SELECT task_type || '|' || status || '|' || (started_at IS NOT NULL) FROM tasks WHERE id='$TARGET_TASK_ID'" \
  | grep -E "^harness_initiative\|(in_progress|completed|failed)\|t$" \
  || { echo "FAIL: 目标 task 不存在 / 类型不对 / started_at 为空"; exit 1; }
echo "PASS Step1: target task is harness_initiative with started_at set"
```

**硬阈值**：行存在；`task_type = harness_initiative`；`started_at IS NOT NULL`；`status` ∈ {`in_progress`, `completed`, `failed`}（任一终态或仍在跑都允许，关键是不为 `queued`）。

---

### Step 2: executor 进入 harness_initiative 分支并调用 LangGraph 子图

**可观测行为**：`runHarnessInitiativeRouter` 被触发，`compiled.stream(...)` 至少被调用一次；执行期间 `task_events` 表中产生针对该 `task_id` 的 `graph_node_update` 事件（W4 streamMode='updates' 记录到 task_events），证明子图实际跑过而非空转。

**验证命令**：
```bash
# 子图实际执行的痕迹：task_events 表至少 1 行 graph_node_update（time-window 防造假）
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"
COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM task_events
   WHERE task_id='$TARGET_TASK_ID'
     AND event_type='graph_node_update'
     AND created_at > NOW() - interval '24 hours'
")
[ "$COUNT" -ge 1 ] || { echo "FAIL: 24h 内无 graph_node_update 事件，子图未实际执行（count=$COUNT）"; exit 1; }
echo "PASS Step2: graph_node_update events count=$COUNT"
```

**硬阈值**：24 小时窗口内 `task_events.event_type = 'graph_node_update'` 且 `task_id = $TARGET_TASK_ID` 的记录数 ≥ 1。

---

### Step 3: executor 在子图返回后回写 tasks.status 为终态（核心断言）

**可观测行为**：当 `compiled.stream / invoke` 返回后，executor 根据 `final.error` 调用 `updateTaskStatus(task.id, 'completed' | 'failed')`；任意阶段抛异常时外层 catch 调用 `updateTaskStatus(task.id, 'failed')`。最终 DB 行 `status` ∈ {`completed`, `failed`}，且 `updated_at >= started_at`。

**验证命令**：
```bash
# 主断言：终态化 + 时间单调
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

# 等待最多 2 小时让 pipeline 跑完（CI 单跑场景；运维手测可缩短）
DEADLINE=$(($(date +%s) + 7200))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(psql "$DB" -tA -c "SELECT status FROM tasks WHERE id='$TARGET_TASK_ID'")
  case "$STATUS" in
    completed|failed) break ;;
  esac
  sleep 30
done

# 终态断言
ROW=$(psql "$DB" -tA -F"|" -c "
  SELECT status,
         (updated_at IS NOT NULL) AS has_updated,
         (started_at IS NOT NULL) AS has_started,
         (updated_at >= started_at) AS time_monotonic
    FROM tasks WHERE id='$TARGET_TASK_ID'
")
echo "row: $ROW"
STATUS=$(echo "$ROW" | cut -d"|" -f1)
TIME_OK=$(echo "$ROW" | cut -d"|" -f4)

[ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] \
  || { echo "FAIL: status='$STATUS'，未终态化（仍卡 in_progress 或被 revert 为 queued）"; exit 1; }
[ "$TIME_OK" = "t" ] \
  || { echo "FAIL: updated_at < started_at，回写时间不单调"; exit 1; }
echo "PASS Step3: status=$STATUS, updated_at>=started_at"
```

**硬阈值**：
- `tasks.status` ∈ {`completed`, `failed`}（**严格不为** `in_progress` / `queued`）
- `updated_at IS NOT NULL` 且 `updated_at >= started_at`
- 整段轮询不超过 2 小时（CI 上限，正常 harness pipeline ≪ 2h）

---

### Step 4: dispatcher 不再重复拉起该 task_id

**可观测行为**：tick_decisions / dispatch 日志中针对该 `task_id` 的 `'dispatch'` 动作总数 ≤ 1（**严格 ≤ 1**，本 Sprint 不解决并发去重，但单实例不应被反复 dispatch）。也即不存在"executor 已完成但 dispatcher 看到 status 未变 → 再次拉起"的回路。

**验证命令**：
```bash
# 防回路断言：tick_decisions 表中针对该 task_id 的 dispatch 决策 ≤ 1（在该任务整个生命周期内）
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

# 取该 task 的 started_at 起算（避免捕获完全无关的历史 ID 碰撞）
STARTED_AT=$(psql "$DB" -tA -c "SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') FROM tasks WHERE id='$TARGET_TASK_ID'")
[ -n "$STARTED_AT" ] || { echo "FAIL: 无 started_at"; exit 1; }

DISPATCH_COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM tick_decisions
   WHERE created_at >= '$STARTED_AT'::timestamp - interval '1 minute'
     AND (
       (decision->>'action' = 'dispatch' AND decision->>'task_id' = '$TARGET_TASK_ID')
       OR (decision->>'task_id' = '$TARGET_TASK_ID' AND decision->>'action' IN ('dispatch','executor_failed'))
     )
")
echo "dispatch_count_for_task=$DISPATCH_COUNT"
[ "$DISPATCH_COUNT" -le 1 ] \
  || { echo "FAIL: dispatcher 重复拉起 task_id=$TARGET_TASK_ID（$DISPATCH_COUNT 次），证明 status 未及时回写形成回路"; exit 1; }
echo "PASS Step4: dispatch_count=$DISPATCH_COUNT (≤1)"
```

**硬阈值**：`tick_decisions` 中针对该 `task_id` 的 dispatch 类决策记录数 ≤ 1。

---

### Step 5: 单元测试守护（PR #2816 自带断言不退化）

**可观测行为**：复跑 PR #2816 自带的 `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`，4 项静态断言全 PASS。守护单元层不退化。

**验证命令**：
```bash
# 复跑单元守护（须有 4 个 it()，且全部 PASS）
cd /workspace/packages/brain
TEST_FILE="src/__tests__/executor-harness-initiative-status-writeback.test.js"
[ -f "$TEST_FILE" ] || { echo "FAIL: PR #2816 单元守护文件缺失：$TEST_FILE"; exit 1; }

# 断言文件中至少 4 个 it() 块（防止"删测试 = 全绿")
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST_FILE")
[ "$IT_COUNT" -ge 4 ] || { echo "FAIL: 单元守护 it() 数量=$IT_COUNT，期望 >=4"; exit 1; }

# 跑测试
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/ws-unit.log
grep -E "Tests\s+(.*)\s+passed" /tmp/ws-unit.log | grep -v "0 passed" \
  || { echo "FAIL: 单元守护未 PASS"; exit 1; }
grep -E "FAIL|✗|failed" /tmp/ws-unit.log | grep -v "0 failed" \
  && { echo "FAIL: 单元守护出现失败"; exit 1; }
echo "PASS Step5: 单元守护 ${IT_COUNT} it() 全 PASS"
```

**硬阈值**：测试文件存在；`it(` 数量 ≥ 4；vitest 报告 0 failed。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**：
```bash
#!/usr/bin/env bash
set -euo pipefail

DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

echo "=== Golden Path E2E 验证：PR #2816 status 回写 ==="
echo "DB=$DB"
echo "TARGET_TASK_ID=$TARGET_TASK_ID"
echo ""

# Step 1 — 入口存在性
psql "$DB" -tA -c "SELECT task_type || '|' || status || '|' || (started_at IS NOT NULL) FROM tasks WHERE id='$TARGET_TASK_ID'" \
  | grep -E "^harness_initiative\|(in_progress|completed|failed)\|t$" \
  || { echo "❌ Step1 FAIL"; exit 1; }
echo "✅ Step1: 入口断言通过"

# Step 2 — 子图实际执行痕迹
COUNT=$(psql "$DB" -tA -c "SELECT count(*) FROM task_events WHERE task_id='$TARGET_TASK_ID' AND event_type='graph_node_update' AND created_at > NOW() - interval '24 hours'")
[ "$COUNT" -ge 1 ] || { echo "❌ Step2 FAIL (graph_node_update count=$COUNT)"; exit 1; }
echo "✅ Step2: graph_node_update events=$COUNT"

# Step 3 — 终态化（轮询最多 2h）
DEADLINE=$(($(date +%s) + 7200))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(psql "$DB" -tA -c "SELECT status FROM tasks WHERE id='$TARGET_TASK_ID'")
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep 30
done
ROW=$(psql "$DB" -tA -F"|" -c "SELECT status, (updated_at >= started_at) FROM tasks WHERE id='$TARGET_TASK_ID'")
STATUS=$(echo "$ROW" | cut -d"|" -f1)
TIME_OK=$(echo "$ROW" | cut -d"|" -f2)
{ [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; } && [ "$TIME_OK" = "t" ] \
  || { echo "❌ Step3 FAIL (status=$STATUS, time_ok=$TIME_OK)"; exit 1; }
echo "✅ Step3: status=$STATUS, updated_at>=started_at"

# Step 4 — 不重复拉起
STARTED_AT=$(psql "$DB" -tA -c "SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') FROM tasks WHERE id='$TARGET_TASK_ID'")
DISPATCH_COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM tick_decisions
   WHERE created_at >= '$STARTED_AT'::timestamp - interval '1 minute'
     AND decision->>'task_id' = '$TARGET_TASK_ID'
     AND decision->>'action' IN ('dispatch','executor_failed')
")
[ "$DISPATCH_COUNT" -le 1 ] \
  || { echo "❌ Step4 FAIL (dispatch_count=$DISPATCH_COUNT > 1，回路重现)"; exit 1; }
echo "✅ Step4: dispatch_count=$DISPATCH_COUNT (≤1)"

# Step 5 — 单元守护
cd /workspace/packages/brain
TEST_FILE="src/__tests__/executor-harness-initiative-status-writeback.test.js"
[ -f "$TEST_FILE" ] || { echo "❌ Step5 FAIL: $TEST_FILE 缺失"; exit 1; }
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST_FILE")
[ "$IT_COUNT" -ge 4 ] || { echo "❌ Step5 FAIL: it count=$IT_COUNT < 4"; exit 1; }
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/ws-unit.log
grep -E "Tests\s+\d+ passed" /tmp/ws-unit.log >/dev/null \
  || { echo "❌ Step5 FAIL: 单元守护未 PASS"; exit 1; }
! grep -E "✗|FAIL " /tmp/ws-unit.log >/dev/null \
  || { echo "❌ Step5 FAIL: 单元守护出现失败"; exit 1; }
echo "✅ Step5: 单元守护 $IT_COUNT it() 全 PASS"

echo ""
echo "🎯 Golden Path 验证全部通过"
```

**通过标准**：脚本 exit 0，且 stdout 含 5 个 `✅` 行。

---

## Workstreams

workstream_count: 2

### Workstream 1: 端到端 status 终态化观测器（Step 1–3）

**范围**：
- 写一个 bash 脚本 `sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh`，执行 Step 1+2+3 的 SQL 断言（入口存在、graph_node_update ≥1、终态化 + 时间单调），出错 exit 非 0；这是 evaluator 在 main（含 PR #2816）跑的端到端观测器。
- 写 vitest 测试 `sprints/golden-path-verify-20260507/tests/ws1/status-writeback.test.ts`，用 `readFileSync` 静态读 `packages/brain/src/executor.js` 源码，对**外层 caller**（`if (task.task_type === 'harness_initiative')` 块）做形状断言：
  1. 成功路径含 `updateTaskStatus(task.id, 'completed')`；
  2. FAIL 路径含 `updateTaskStatus(task.id, 'failed', ...)`；
  3. 异常路径 catch 块也含 `updateTaskStatus(task.id, 'failed')`；
  4. 所有 return 写 `success: true`（不再是 `success: result.ok` / `success: !final.error`），防止 dispatcher 把已处理任务回退 `queued`；
  5. 锚定 PRD 目标 `task_id = 84075973-99a4-4a0d-9a29-4f0cd8b642f5` 字面引用，防偷换。
- 不修改 `packages/brain/src/executor.js`。

**注**：fix 实际位置在 outer caller（main 上 `executor.js` line ~2964–2992 的 `if (task.task_type === 'harness_initiative')` 块），**不是** `runHarnessInitiativeRouter` 函数体内 — 函数体只 stream 子图、写 task_events，状态回写由外层 caller 担责。

**大小**：M（脚本 + 1 个测试文件，预计 100–200 行）

**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/status-writeback.test.ts`

---

### Workstream 2: dispatcher 防回路 + 单元守护（Step 4–5）

**范围**：
- 写一个 bash 脚本 `sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh`，执行 Step 4（dispatch_count ≤ 1）+ Step 5（PR #2816 单元守护 4 项 PASS）。
- 写 vitest 测试 `sprints/golden-path-verify-20260507/tests/ws2/no-regression.test.ts`，断言 PR #2816 单元文件存在、`it()` 数量 ≥ 4、文件名匹配 PRD（防止被偷偷删/改名）。
- 不修改 `packages/brain/src/executor.js`、不修改 PR #2816 自带测试。

**大小**：S（< 100 行）

**依赖**：Workstream 1 完成后（Step 4 的 SQL 依赖 Step 3 跑完确定 started_at 边界）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/no-regression.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/status-writeback.test.ts` | 外层 caller 含 `updateTaskStatus(task.id,'completed')`、`updateTaskStatus(task.id,'failed')`（含 catch 块）；所有 return 写 `success: true`；锚定 PRD 目标 task_id | 当前分支 base 未含 PR #2816 fix → 源码块中找不到 `updateTaskStatus` → toMatch FAIL |
| WS2 | `tests/ws2/no-regression.test.ts` | PR #2816 守护文件存在；含 ≥4 个 `it(`；脚本含 `tick_decisions` + dispatch_count ≤ 1 + 守护文件路径 + IT_COUNT ≥ 4 | 当前分支无 PR #2816 守护文件、Generator 尚未产出 scripts/ → fs.existsSync = false → expect FAIL |

---

## 反作弊与硬阈值说明（GAN 重点）

- 所有 `count(*)` 查询都加了时间窗口（`task_events`: 24h；`tick_decisions`: 自 `started_at` 起算 -1min 容差），防止"手动 INSERT 一行造假通过"。
- Step 3 不只断言 `status ∈ {completed, failed}`，**还断言 `updated_at >= started_at`**，防止"用 INSERT 一行 completed 的旧记录骗过"。
- Step 4 的 `tick_decisions` 查询用 `decision->>'task_id'` 精确匹配，并以 `started_at` 为下界，避免抓到无关历史记录。
- Step 5 强制 `it(` 计数 ≥ 4，防止"删掉 3 个 it 让最后 1 个绿成全绿"。
- `psql` 全部用 `-tA`（tuples-only + unaligned）拿干净值；`grep -E ... || exit 1` 链式失败立即退出。
- `curl` 调用（如有）须加 `-f`（HTTP 5xx 才返回非 0）——本合同主要走 psql，不依赖 curl。
