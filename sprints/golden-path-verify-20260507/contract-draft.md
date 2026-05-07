# Sprint Contract Draft (Round 2) — 验证 PR #2816 harness_initiative status 自动回写

> **被验证对象**：`packages/brain/src/executor.js` 的 `if (task.task_type === 'harness_initiative')` 外层 caller 块（PR #2816 fix commit = `c9300a89b`）。
> **本 Sprint 不修改实现**，只观察其在真实 Brain runtime 中的可见行为。
> **journey_type**：autonomous

## 本轮（Round 2）相对 Round 1 的变更（针对 Reviewer 5 条反馈）

1. **新增 Step 0 系统级 pre-flight**（`pg_isready` + Brain `/health`），区分系统级失败（`exit 2`）与业务断言失败（`exit 1`）——回应反馈 #2。
2. **Step 2 时间窗收紧**：从固定 `interval '24 hours'` 改为 `>= started_at - interval '1 minute'`，避免 E2E 重跑时捕获上一轮残留 graph_node_update 给假 PASS——回应反馈 #5。
3. **Step 3 静默看门狗**：2h 轮询过程中若 `task_events` 最近一次写入 > 30 分钟前，直接 `exit 1` with `reason=pipeline_stuck`，不再傻等到 7200s——回应反馈 #1。
4. **每步加 LAST_STEP trap**：E2E 脚本任意一步异常退出时打印 `LAST_STEP=...` 给 evaluator——回应反馈 #3。
5. **WS1 测试新增 anti-revert 断言**：用 `git merge-base --is-ancestor c9300a89b HEAD` 确认 PR #2816 fix commit 在 HEAD 祖先链上；用 `git blame` 锁定外层 caller 块中 `updateTaskStatus(task.id, 'completed'|'failed')` 行的 blame commit 等于 `c9300a89b`（Reviewer R1 笔误写 `66ff2791b`，那是 round-1 contract commit；技术正确的 anchor 是 `c9300a89b`，本测试同时加固两者：c9300a89b 必须可达，且 fix 行 blame ≥ c9300a89b 时间序）——回应反馈 #4。

---

## Golden Path

[Brain 派发 harness_initiative task] → [executor 进入 harness_initiative 分支 / 调度 LangGraph 子图执行完毕] → [executor 回写 tasks.status ∈ {completed, failed}] → [dispatcher 不再重复拉起该 task_id]

---

### Step 0: 系统级 pre-flight（DB 与 Brain runtime 可达）

**可观测行为**：PostgreSQL 接受连接；Brain HTTP `/api/brain/health` 返回 2xx。任一失败立即 `exit 2`（系统级），与业务断言（`exit 1`）严格区分。

**验证命令**：
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 系统级断言：DB 可达
pg_isready -d "$DB" >/dev/null 2>&1 \
  || { echo "FAIL[exit=2 system]: pg_isready 失败，DB 不可达：$DB"; exit 2; }

# 系统级断言：Brain runtime 可达（-f 让 5xx 返回非 0）
curl -fsS "$BRAIN_URL/api/brain/health" >/dev/null 2>&1 \
  || { echo "FAIL[exit=2 system]: Brain /health 不可达：$BRAIN_URL"; exit 2; }

echo "PASS Step0: pg_isready + Brain /health"
```

**硬阈值**：`pg_isready` exit=0 且 `curl -fsS /api/brain/health` exit=0；否则全脚本 `exit 2`，不进 Step1。

---

### Step 1: harness_initiative 任务被 Brain 派发并标 in_progress

**可观测行为**：DB `tasks` 表中存在一行 `task_type = 'harness_initiative'` 且 `status` 不为 `queued`（dispatcher 已 mark 过 `in_progress`，或 executor 已写终态），`started_at IS NOT NULL`。

**验证命令**：
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"
psql "$DB" -tA -c "SELECT task_type || '|' || status || '|' || (started_at IS NOT NULL) FROM tasks WHERE id='$TARGET_TASK_ID'" \
  | grep -E "^harness_initiative\|(in_progress|completed|failed)\|t$" \
  || { echo "FAIL[exit=1 business]: 目标 task 不存在 / 类型不对 / started_at 为空 / 仍 queued"; exit 1; }
echo "PASS Step1: target task is harness_initiative with started_at set"
```

**硬阈值**：行存在；`task_type = harness_initiative`；`started_at IS NOT NULL`；`status` ∈ {`in_progress`, `completed`, `failed`}（不为 `queued`）。

---

### Step 2: executor 进入 harness_initiative 分支并调用 LangGraph 子图

**可观测行为**：`runHarnessInitiativeRouter` 被触发，`compiled.stream(...)` 至少跑一次；`task_events` 表中针对该 `task_id` 产生 `graph_node_update` 事件（W4 streamMode='updates' 落库）。

**验证命令**（时间窗对齐 `started_at`，杜绝抓到上一轮残留事件）：
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

# Round 2 收紧时间窗：从 started_at - 1min 起算（不再 24h）
COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM task_events
   WHERE task_id='$TARGET_TASK_ID'
     AND event_type='graph_node_update'
     AND created_at >= (
       SELECT started_at - interval '1 minute' FROM tasks WHERE id='$TARGET_TASK_ID'
     )
")
[ "$COUNT" -ge 1 ] \
  || { echo "FAIL[exit=1 business]: 当前 started_at 之后无 graph_node_update 事件，子图未实际执行（count=$COUNT）"; exit 1; }
echo "PASS Step2: graph_node_update events count=$COUNT (since started_at -1min)"
```

**硬阈值**：`task_events.event_type = 'graph_node_update'` 且 `task_id = $TARGET_TASK_ID` 且 `created_at >= tasks.started_at - 1min` 的记录数 ≥ 1。

---

### Step 3: executor 在子图返回后回写 tasks.status 为终态（核心断言）

**可观测行为**：`compiled.stream / invoke` 返回后，executor 根据 `final.error` 调用 `updateTaskStatus(task.id, 'completed' | 'failed')`；任意阶段抛异常时外层 catch 调用 `updateTaskStatus(task.id, 'failed')`。终态 ∈ {`completed`, `failed`} 且 `updated_at >= started_at`。

**验证命令**（带 30 分钟静默看门狗，避免静默卡 2 小时）：
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

DEADLINE=$(($(date +%s) + 7200))   # 2h 总上限
SILENT_LIMIT_S=1800                # 30 min 静默看门狗

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(psql "$DB" -tA -c "SELECT status FROM tasks WHERE id='$TARGET_TASK_ID'")
  case "$STATUS" in
    completed|failed) break ;;
  esac

  # 静默看门狗：最近一次 task_events 写入若 > 30min 前，pipeline 卡死
  LAST_EVT_AGE=$(psql "$DB" -tA -c "
    SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::int, 999999)
      FROM task_events WHERE task_id='$TARGET_TASK_ID'
  ")
  if [ "$LAST_EVT_AGE" -gt "$SILENT_LIMIT_S" ]; then
    echo "FAIL[exit=1 business] reason=pipeline_stuck: task_events 最后写入 ${LAST_EVT_AGE}s 前（>30min），pipeline 静默卡死"
    exit 1
  fi
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
  || { echo "FAIL[exit=1 business]: status='$STATUS'，未终态化（仍卡 in_progress 或被 revert 为 queued）"; exit 1; }
[ "$TIME_OK" = "t" ] \
  || { echo "FAIL[exit=1 business]: updated_at < started_at，回写时间不单调"; exit 1; }
echo "PASS Step3: status=$STATUS, updated_at>=started_at"
```

**硬阈值**：
- `tasks.status` ∈ {`completed`, `failed`}（**严格不为** `in_progress` / `queued`）
- `updated_at IS NOT NULL` 且 `updated_at >= started_at`
- 任一时刻 `task_events` 最后写入 > 30 min 前 → `pipeline_stuck` `exit 1`
- 总轮询不超过 2 小时

---

### Step 4: dispatcher 不再重复拉起该 task_id

**可观测行为**：`tick_decisions` 表中针对该 `task_id` 的 dispatch 类决策记录数 ≤ 1（自 `started_at` 起算 -1min 容差），不存在 "executor 已完成但 dispatcher 看到 status 未变 → 再次拉起" 的回路。

**验证命令**：
```bash
DB="${DB_URL:-postgresql://localhost/cecelia}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

STARTED_AT=$(psql "$DB" -tA -c "SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') FROM tasks WHERE id='$TARGET_TASK_ID'")
[ -n "$STARTED_AT" ] || { echo "FAIL[exit=1 business]: 无 started_at"; exit 1; }

DISPATCH_COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM tick_decisions
   WHERE created_at >= '$STARTED_AT'::timestamp - interval '1 minute'
     AND decision->>'task_id' = '$TARGET_TASK_ID'
     AND decision->>'action' IN ('dispatch','executor_failed')
")
echo "dispatch_count_for_task=$DISPATCH_COUNT"
[ "$DISPATCH_COUNT" -le 1 ] \
  || { echo "FAIL[exit=1 business]: dispatcher 重复拉起 task_id=$TARGET_TASK_ID（$DISPATCH_COUNT 次），证明 status 未及时回写形成回路"; exit 1; }
echo "PASS Step4: dispatch_count=$DISPATCH_COUNT (≤1)"
```

**硬阈值**：`tick_decisions` 中针对该 `task_id` 自 `started_at - 1min` 起算的 dispatch 类决策记录数 ≤ 1。

---

### Step 5: 单元测试守护（PR #2816 自带断言不退化 + anti-revert）

**可观测行为**：(a) PR #2816 自带 `executor-harness-initiative-status-writeback.test.js` 4 项断言全 PASS；(b) `git merge-base --is-ancestor c9300a89b HEAD` 通过，证明 fix commit 在 HEAD 祖先链；(c) 外层 caller 块中 `updateTaskStatus(task.id, ...)` 行的 git blame commit 等于 `c9300a89b`（fix 行未被后续 commit 覆盖）。

**验证命令**：
```bash
# 5a 复跑 PR #2816 单元守护
cd /workspace/packages/brain
TEST_FILE="src/__tests__/executor-harness-initiative-status-writeback.test.js"
[ -f "$TEST_FILE" ] || { echo "FAIL[exit=1 business]: PR #2816 单元守护文件缺失：$TEST_FILE"; exit 1; }
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST_FILE")
[ "$IT_COUNT" -ge 4 ] || { echo "FAIL[exit=1 business]: 单元守护 it() 数量=$IT_COUNT，期望 >=4"; exit 1; }
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/ws-unit.log
grep -E "Tests\s+\d+ passed" /tmp/ws-unit.log >/dev/null \
  || { echo "FAIL[exit=1 business]: 单元守护未 PASS"; exit 1; }
! grep -E "✗|FAIL " /tmp/ws-unit.log >/dev/null \
  || { echo "FAIL[exit=1 business]: 单元守护出现失败"; exit 1; }
echo "PASS Step5a: 单元守护 ${IT_COUNT} it() 全 PASS"

# 5b anti-revert：c9300a89b 必须在 HEAD 祖先链
cd /workspace
git merge-base --is-ancestor c9300a89b HEAD \
  || { echo "FAIL[exit=1 business]: PR #2816 fix commit c9300a89b 不在 HEAD 祖先链 — 可能已 revert"; exit 1; }
echo "PASS Step5b: c9300a89b is ancestor of HEAD"

# 5c blame 校验：fix 行未被后续 commit 覆盖
EXEC="/workspace/packages/brain/src/executor.js"
HARNESS_LINE=$(grep -nE "task\.task_type === 'harness_initiative'" "$EXEC" | head -1 | cut -d: -f1)
[ -n "$HARNESS_LINE" ] || { echo "FAIL[exit=1 business]: 找不到 harness_initiative 外层 caller"; exit 1; }
END_LINE=$((HARNESS_LINE + 200))   # 外层 caller 块约 ≤200 行

BLAME_HITS=$(git blame -l -L "${HARNESS_LINE},${END_LINE}" "$EXEC" \
  | grep -E "updateTaskStatus\s*\(\s*task\.id\s*,\s*['\"](completed|failed)['\"]" \
  | awk '{print $1}' | sort -u)
echo "blame_commits_for_updateTaskStatus_lines:"
echo "$BLAME_HITS"

# 至少 1 行 blame 命中 c9300a89b（PR #2816 fix commit）
echo "$BLAME_HITS" | grep -E "^c9300a89b" >/dev/null \
  || { echo "FAIL[exit=1 business]: 外层 caller 中 updateTaskStatus(task.id, completed|failed) 行 blame 不含 c9300a89b，fix 已被覆盖/revert"; exit 1; }
echo "PASS Step5c: blame anchored on c9300a89b (PR #2816)"
```

**硬阈值**：
- 5a：`it(` 数量 ≥ 4；vitest 0 failed
- 5b：`git merge-base --is-ancestor c9300a89b HEAD` exit=0
- 5c：外层 caller 块中至少 1 行 blame commit ≥ `c9300a89b`（命中 `c9300a89b` 前缀即可）

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**：
```bash
#!/usr/bin/env bash
set -euo pipefail

DB="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TARGET_TASK_ID="84075973-99a4-4a0d-9a29-4f0cd8b642f5"

# === Round 2 新增 trap：异常退出时打印当前阶段，evaluator 报告里直接看到卡哪一步 ===
LAST_STEP="init"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "[FATAL] LAST_STEP=$LAST_STEP exit_code=$rc"; fi' EXIT

echo "=== Golden Path E2E 验证：PR #2816 status 回写 (Round 2) ==="
echo "DB=$DB"
echo "BRAIN_URL=$BRAIN_URL"
echo "TARGET_TASK_ID=$TARGET_TASK_ID"
echo ""

# Step 0 — 系统级 pre-flight（exit 2）
LAST_STEP="step0_preflight"
pg_isready -d "$DB" >/dev/null 2>&1 \
  || { echo "❌ Step0 SYSTEM FAIL: pg_isready"; exit 2; }
curl -fsS "$BRAIN_URL/api/brain/health" >/dev/null 2>&1 \
  || { echo "❌ Step0 SYSTEM FAIL: Brain /health"; exit 2; }
echo "✅ Step0: pg_isready + /health OK"

# Step 1 — 入口存在性（exit 1）
LAST_STEP="step1_entry"
psql "$DB" -tA -c "SELECT task_type || '|' || status || '|' || (started_at IS NOT NULL) FROM tasks WHERE id='$TARGET_TASK_ID'" \
  | grep -E "^harness_initiative\|(in_progress|completed|failed)\|t$" \
  || { echo "❌ Step1 FAIL"; exit 1; }
echo "✅ Step1: 入口断言通过"

# Step 2 — 子图实际执行痕迹（时间窗对齐 started_at）
LAST_STEP="step2_subgraph_events"
COUNT=$(psql "$DB" -tA -c "
  SELECT count(*) FROM task_events
   WHERE task_id='$TARGET_TASK_ID'
     AND event_type='graph_node_update'
     AND created_at >= (SELECT started_at - interval '1 minute' FROM tasks WHERE id='$TARGET_TASK_ID')
")
[ "$COUNT" -ge 1 ] || { echo "❌ Step2 FAIL (graph_node_update count=$COUNT since started_at)"; exit 1; }
echo "✅ Step2: graph_node_update events=$COUNT (since started_at)"

# Step 3 — 终态化（轮询最多 2h，30min 静默看门狗）
LAST_STEP="step3_terminal_status"
DEADLINE=$(($(date +%s) + 7200))
SILENT_LIMIT_S=1800
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(psql "$DB" -tA -c "SELECT status FROM tasks WHERE id='$TARGET_TASK_ID'")
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  LAST_EVT_AGE=$(psql "$DB" -tA -c "
    SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::int, 999999)
      FROM task_events WHERE task_id='$TARGET_TASK_ID'
  ")
  if [ "$LAST_EVT_AGE" -gt "$SILENT_LIMIT_S" ]; then
    echo "❌ Step3 FAIL reason=pipeline_stuck (last event ${LAST_EVT_AGE}s ago > 30min)"
    exit 1
  fi
  sleep 30
done
ROW=$(psql "$DB" -tA -F"|" -c "SELECT status, (updated_at >= started_at) FROM tasks WHERE id='$TARGET_TASK_ID'")
STATUS=$(echo "$ROW" | cut -d"|" -f1)
TIME_OK=$(echo "$ROW" | cut -d"|" -f2)
{ [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; } && [ "$TIME_OK" = "t" ] \
  || { echo "❌ Step3 FAIL (status=$STATUS, time_ok=$TIME_OK)"; exit 1; }
echo "✅ Step3: status=$STATUS, updated_at>=started_at"

# Step 4 — 不重复拉起
LAST_STEP="step4_no_redispatch"
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

# Step 5a — 单元守护
LAST_STEP="step5a_unit_guard"
cd /workspace/packages/brain
TEST_FILE="src/__tests__/executor-harness-initiative-status-writeback.test.js"
[ -f "$TEST_FILE" ] || { echo "❌ Step5a FAIL: $TEST_FILE 缺失"; exit 1; }
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST_FILE")
[ "$IT_COUNT" -ge 4 ] || { echo "❌ Step5a FAIL: it count=$IT_COUNT < 4"; exit 1; }
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/ws-unit.log
grep -E "Tests\s+\d+ passed" /tmp/ws-unit.log >/dev/null \
  || { echo "❌ Step5a FAIL: 单元守护未 PASS"; exit 1; }
! grep -E "✗|FAIL " /tmp/ws-unit.log >/dev/null \
  || { echo "❌ Step5a FAIL: 单元守护出现失败"; exit 1; }
echo "✅ Step5a: 单元守护 $IT_COUNT it() 全 PASS"

# Step 5b — anti-revert
LAST_STEP="step5b_ancestor_check"
cd /workspace
git merge-base --is-ancestor c9300a89b HEAD \
  || { echo "❌ Step5b FAIL: c9300a89b 不在 HEAD 祖先链"; exit 1; }
echo "✅ Step5b: c9300a89b is ancestor of HEAD"

# Step 5c — blame anchor
LAST_STEP="step5c_blame_anchor"
EXEC="/workspace/packages/brain/src/executor.js"
HARNESS_LINE=$(grep -nE "task\.task_type === 'harness_initiative'" "$EXEC" | head -1 | cut -d: -f1)
[ -n "$HARNESS_LINE" ] || { echo "❌ Step5c FAIL: 找不到外层 caller"; exit 1; }
END_LINE=$((HARNESS_LINE + 200))
BLAME_HITS=$(git blame -l -L "${HARNESS_LINE},${END_LINE}" "$EXEC" \
  | grep -E "updateTaskStatus\s*\(\s*task\.id\s*,\s*['\"](completed|failed)['\"]" \
  | awk '{print $1}' | sort -u)
echo "$BLAME_HITS" | grep -E "^c9300a89b" >/dev/null \
  || { echo "❌ Step5c FAIL: blame 不含 c9300a89b"; exit 1; }
echo "✅ Step5c: blame anchored on c9300a89b"

LAST_STEP="done"
echo ""
echo "🎯 Golden Path Round 2 验证全部通过"
```

**通过标准**：脚本 exit 0，stdout 含 `✅ Step0` … `✅ Step5c` 共 7 个 `✅` 行；任何失败时 `[FATAL] LAST_STEP=...` 行可读出卡点。

---

## Workstreams

workstream_count: 2

### Workstream 1: 端到端 status 终态化观测器（Step 0–3 + 5b/5c anti-revert）

**范围**：
- 写 bash 脚本 `sprints/golden-path-verify-20260507/scripts/verify-status-terminal.sh`，执行 Step 0（pre-flight）+ Step 1+2+3 + Step 5b/5c（anti-revert ancestor + blame）。出错按 exit=2（系统级）/ exit=1（业务）严格区分。脚本顶层含 `LAST_STEP` trap。
- 写 vitest 测试 `sprints/golden-path-verify-20260507/tests/ws1/status-writeback.test.ts`：
  1. 用 `readFileSync` 静态读 `packages/brain/src/executor.js` 外层 caller 块，断言含 `updateTaskStatus(task.id, 'completed')` / `updateTaskStatus(task.id, 'failed')`（含 catch 块）；
  2. 所有 return 写 `success: true`（不再 `success: result.ok` / `success: !final.error`）；
  3. **Round 2 新增**：调用 `git merge-base --is-ancestor c9300a89b HEAD` 断言 fix commit 在祖先链；
  4. **Round 2 新增**：`git blame -l -L` 锁定外层 caller 块中所有 `updateTaskStatus(task.id, 'completed'|'failed')` 行的 blame commit 集合，断言至少一行 blame commit ≥ `c9300a89b`（用 `git merge-base --is-ancestor <blame> c9300a89b` 检查"该 blame commit 自己是 c9300a89b 的祖先" ⇒ 反向；正向写：`git merge-base --is-ancestor c9300a89b <blame_commit>` 即 c9300a89b ≤ blame；最简就是直接 prefix 等于 `c9300a89b`，因为 PR #2816 是 squash-merge，blame 应该精确指向 c9300a89b）；
  5. PRD 目标 `task_id = 84075973-99a4-4a0d-9a29-4f0cd8b642f5` 字面引用，防 PRD 漂移。
- 不修改 `packages/brain/src/executor.js`。

**注**：fix 实际位置在 outer caller（main 上 `executor.js` line ~2964–2992 的 `if (task.task_type === 'harness_initiative')` 块），**不是** `runHarnessInitiativeRouter` 函数体内 — 函数体只 stream 子图、写 task_events，状态回写由外层 caller 担责。

**大小**：M（脚本 + 1 个测试文件，预计 200–300 行）

**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/status-writeback.test.ts`

---

### Workstream 2: dispatcher 防回路 + 单元守护（Step 4 + 5a）

**范围**：
- 写 bash 脚本 `sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh`，执行 Step 0（pre-flight）+ Step 4（dispatch_count ≤ 1）+ Step 5a（PR #2816 单元守护 4 项 PASS）。脚本顶层含 `LAST_STEP` trap。
- 写 vitest 测试 `sprints/golden-path-verify-20260507/tests/ws2/no-regression.test.ts`，断言 PR #2816 单元文件存在、`it()` 数量 ≥ 4、文件名匹配 PRD（防偷偷删/改名），并断言脚本含 `pg_isready` + `/api/brain/health` + `tick_decisions` + dispatch_count ≤ 1 + `IT_COUNT ≥ 4` 关键字组合。
- 不修改 `packages/brain/src/executor.js`、不修改 PR #2816 自带测试。

**大小**：S（≤ 150 行）

**依赖**：Workstream 1 完成后（Step 4 的 SQL 依赖 Step 3 跑完确定 started_at 边界）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/no-regression.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/status-writeback.test.ts` | (a) 外层 caller 含 `updateTaskStatus(task.id,'completed')` / `'failed'`（含 catch 块）；(b) 所有 return 写 `success: true`；(c) `c9300a89b` 在 HEAD 祖先链；(d) 外层 caller 块 `updateTaskStatus` 行 blame ≥ `c9300a89b`；(e) PRD 目标 task_id 字面引用 | base 未含 PR #2816 fix → 源码块中找不到 `updateTaskStatus` → toMatch FAIL；OR 即使源码 OK，git blame anchor 不命中 → expect FAIL |
| WS2 | `tests/ws2/no-regression.test.ts` | PR #2816 守护文件存在；含 ≥4 个 `it(`；脚本含 `pg_isready` + `/api/brain/health` + `tick_decisions` + dispatch_count ≤ 1 + `executor-harness-initiative-status-writeback.test.js` + `IT_COUNT ≥ 4` | Generator 尚未产出 `scripts/check-no-redispatch-and-units.sh` → fs.existsSync = false → expect FAIL |

---

## 反作弊与硬阈值说明（GAN 重点 / Round 2 强化）

- **系统级 vs 业务级 exit code 严格分离**：`exit 2` 仅给 DB 不可达 / Brain `/health` 不可达；`exit 1` 给所有业务断言失败。Evaluator 看到 `exit 2` 会把 Sprint 标 infra-error 而非 spec-fail，避免错误记账。
- **30 min 静默看门狗** 防止"pipeline 卡死时静默吃满 2h"——直接 `pipeline_stuck` 终止。
- **Step 2 时间窗对齐 `started_at`**：从 `interval '24 hours'` 收紧到 `>= started_at - interval '1 minute'`，杜绝抓上一轮残留 graph_node_update 给假 PASS。
- **`tick_decisions` 查询**：`decision->>'task_id'` 精确匹配 + `started_at - 1min` 起算，避免 ID 碰撞 / 历史污染。
- **anti-revert 三层**：(a) 源码 `readFileSync` 形状断言；(b) `git merge-base --is-ancestor c9300a89b HEAD`；(c) `git blame` 锁定 fix 行 blame commit。三层全过才算 fix 仍在。
- **`it(` 计数 ≥ 4**：防止"删 it 让全绿"。
- **`LAST_STEP` trap**：每步前赋值，trap 在 EXIT 上打印；evaluator 报告中直接读出卡点（pipeline_stuck / preflight_db / preflight_brain / step3_terminal_status …）。
- `psql` 全用 `-tA`；`grep -E ... || exit N` 链式失败立即退出；`curl -fsS` 让 5xx/超时返回非 0。
