# Sprint Contract Draft (Round 1)

## Golden Path

[人工 POST /api/brain/tasks 派发 v15 Walking Skeleton noop PR 任务]
→ [Brain consciousness-loop 在下一 tick 拉起 LangGraph harness state machine]
→ [planner → proposer → reviewer → generator → evaluator 五节点依次推进，PostgresSaver 每步留 checkpoint]
→ [evaluator 在 sub-task worktree 跑 DoD 4 条全 PASS（文件存在 / 首行匹配 / PR OPEN / DB status=completed）]
→ [evaluator 通过 callback POST 把 status='completed' + result.pr_url 写回 PostgreSQL tasks 行]
→ [SQL 行 + GitHub PR OPEN + Brain 日志三类证据共同证明真闭环]

---

### Step 1: 人工通过 Brain API 注册 v15 Walking Skeleton 任务

**可观测行为**: PostgreSQL `tasks` 表新增 1 行 `task_type='harness_initiative'`、`payload->>'sprint_dir'='sprints/w8-langgraph-v15'`、`payload->>'journey_type'='dev_pipeline'`，初始 status 为 `pending` 或 `queued`。

**验证命令**:
```bash
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
SELECT count(*) FROM tasks
WHERE task_type='harness_initiative'
  AND payload->>'sprint_dir'='sprints/w8-langgraph-v15'
  AND created_at > NOW() - INTERVAL '60 minutes'"
# 期望：count >= 1
```

**硬阈值**: count ≥ 1，60 分钟时间窗口内写入（防止读到陈旧任务造假通过）。

---

### Step 2: consciousness-loop 在下一 tick 拉起 LangGraph harness state machine

**可观测行为**: Brain 容器日志含 `harness graph started` / `langgraph state=planner` 字样；`langgraph_checkpoints` 表（PostgresSaver 持久化表）写入首条 thread_id 关联本任务的记录。

**验证命令**:
```bash
# 双重证据：日志 + checkpoint 表
LOG_OK=$(docker logs cecelia-brain --since 60m 2>&1 | grep -cE "harness.*(graph started|state=planner)" || echo 0)
[ "$LOG_OK" -ge 1 ] || { echo "no harness start log"; exit 1; }

CKPT=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM langgraph_checkpoints
  WHERE created_at > NOW() - INTERVAL '60 minutes'" | tr -d ' ')
[ "$CKPT" -ge 1 ] || { echo "no checkpoint written"; exit 1; }
```

**硬阈值**: 日志 ≥ 1 行 + checkpoint ≥ 1 条；60 分钟时间窗口。

---

### Step 3: planner / proposer / reviewer / generator / evaluator 五节点依次推进且无 fail-fast

**可观测行为**: 5 个 SKILL 节点各至少出现 1 次 `result=ok`（或等价 `verdict=PROPOSED|APPROVED|GENERATED|PASS`）日志；不出现 `PROBE_FAIL_CONSOLIDATION`、`H7_STDOUT_LOST`、`H8_WORKTREE_MISS`、`H11_KEY_COLLISION`、`H13_DOD_NOT_FOUND` 等已修缺陷的回归字样。

**验证命令**:
```bash
LOGS=$(docker logs cecelia-brain --since 60m 2>&1)

# 5 节点至少各 ok 一次
for node in planner proposer reviewer generator evaluator; do
  COUNT=$(echo "$LOGS" | grep -E "node=${node}.*(result=ok|verdict=(PROPOSED|APPROVED|GENERATED|PASS))" | wc -l)
  [ "$COUNT" -ge 1 ] || { echo "node $node not ok in last 60m"; exit 1; }
done

# 不应出现已修缺陷回归
REGRESS=$(echo "$LOGS" | grep -cE "PROBE_FAIL_CONSOLIDATION|H7_STDOUT_LOST|H8_WORKTREE_MISS|H11_KEY_COLLISION|H13_DOD_NOT_FOUND" || echo 0)
[ "$REGRESS" -eq 0 ] || { echo "regression hit: $REGRESS"; exit 1; }
```

**硬阈值**: 5 节点 ok 全到位 + 0 条已修缺陷回归字样。

---

### Step 4: evaluator 对 generator sub-task 跑 DoD 4 条全 PASS

**可观测行为**: evaluator 节点在 sub-task worktree 内逐条验证 4 条 DoD：
- DoD-1: `docs/learnings/w8-langgraph-v15-e2e.md` 文件存在
- DoD-2: 首行包含 `W8 v15 LangGraph E2E 实证`
- DoD-3: GitHub PR 状态 OPEN
- DoD-4: PostgreSQL `tasks.status='completed'`

每条 DoD 都在 Brain 日志留下 `evaluator dod=N verdict=PASS` 记录。

**验证命令**:
```bash
LOGS=$(docker logs cecelia-brain --since 60m 2>&1)
for n in 1 2 3 4; do
  PASS=$(echo "$LOGS" | grep -cE "evaluator.*dod=${n}.*verdict=PASS" || echo 0)
  [ "$PASS" -ge 1 ] || { echo "DoD $n not PASS"; exit 1; }
done

# 反向：本 task 范围内不可有 verdict=FAIL
FAIL=$(echo "$LOGS" | grep -cE "evaluator.*verdict=FAIL.*sprint=w8-langgraph-v15" || echo 0)
[ "$FAIL" -eq 0 ] || { echo "evaluator FAIL hit: $FAIL"; exit 1; }
```

**硬阈值**: DoD 1/2/3/4 各 ≥ 1 条 PASS；本 sprint 范围内 verdict=FAIL = 0。

---

### Step 5: evaluator callback 写回 status='completed' + result.pr_url

**可观测行为**: evaluator 通过 HTTP callback POST 到 Brain `/api/brain/tasks/{id}/callback`（或等价 endpoint）后，PostgreSQL `tasks` 表对应 sub_task 行 `status` 由 `in_progress` 翻 `completed`；`result` JSONB 字段含 `pr_url`，且 `pr_url` 符合 `https://github.com/.+/pull/[0-9]+` 正则；callback 命中真实 endpoint（不再是 H7 之前丢 stdout 状态——通过 Brain 日志 `callback received` 字样佐证）。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"

# 1) DB 终态：sub_task status=completed + result.pr_url 合规
COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id IS NOT NULL
    AND status='completed'
    AND result->>'pr_url' ~ '^https://github\.com/.+/pull/[0-9]+$'
    AND updated_at > NOW() - INTERVAL '60 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "no sub_task completed with pr_url in last 60m"; exit 1; }

# 2) callback 命中真实 endpoint（H7 修复后才有此日志）
CB=$(docker logs cecelia-brain --since 60m 2>&1 | grep -cE "callback received.*sprint=w8-langgraph-v15|/api/brain/tasks/.+/callback" || echo 0)
[ "$CB" -ge 1 ] || { echo "no real callback hit"; exit 1; }
```

**硬阈值**: COUNT ≥ 1（带正则 + 60min 时间窗）+ callback 真实命中 ≥ 1；不可只有 DB 行没有 callback 日志（防止人工手改 DB 造假）。

---

### Step 6: 三类证据共同闭环（出口）

**可观测行为**: SQL 查询命中 `status='completed'` 行（含 pr_url）+ GitHub PR OPEN 可访问 + Brain 日志全程无未被捕获的 ERROR；整体 run 总耗时 < 30 分钟。

**验证命令**:
```bash
DB="${DB:-postgresql://localhost/cecelia}"

# A) SQL 行
SQL_OK=$(psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id IS NOT NULL
    AND status='completed'
    AND result->>'pr_url' IS NOT NULL
    AND updated_at > NOW() - INTERVAL '60 minutes'" | tr -d ' ')
[ "$SQL_OK" -ge 1 ] || { echo "SQL fail"; exit 1; }

# B) GitHub PR OPEN
PR_URL=$(psql "$DB" -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE parent_task_id IS NOT NULL AND status='completed'
    AND updated_at > NOW() - INTERVAL '60 minutes' LIMIT 1" | tr -d ' ')
PR_STATE=$(gh pr view "$PR_URL" --json state -q .state 2>/dev/null)
[ "$PR_STATE" = "OPEN" ] || { echo "PR not OPEN: $PR_STATE (url=$PR_URL)"; exit 1; }

# C) Brain 日志无 unhandled ERROR（限定本 sprint 范围）
ERR=$(docker logs cecelia-brain --since 60m 2>&1 | grep -E "ERROR|Uncaught|unhandledRejection" | grep -cE "harness|w8-langgraph-v15" || echo 0)
[ "$ERR" -eq 0 ] || { echo "Brain log $ERR ERROR(s) in scope"; exit 1; }

# D) Run 时长 < 30 分钟
DUR=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM (updated_at - created_at))::int FROM tasks
  WHERE parent_task_id IS NOT NULL AND status='completed'
    AND updated_at > NOW() - INTERVAL '60 minutes' LIMIT 1" | tr -d ' ')
[ -n "$DUR" ] && [ "$DUR" -lt 1800 ] || { echo "run too slow: ${DUR}s (limit 1800s)"; exit 1; }
```

**硬阈值**: A + B + C + D 全过；任一不过即整体 FAIL。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
NOTES="docs/learnings/w8-langgraph-v15-e2e.md"

# 注：本 sprint 是验证 sprint，不在脚本内派发任务（任务由 cecelia-run 派发）；
# 脚本只验证最近 60 分钟内 e2e 真实落地的证据。

# === A. ARTIFACT 验证 ===
[ -f "$NOTES" ] || { echo "[FAIL] missing notes md: $NOTES"; exit 1; }
FIRST_LINE=$(head -n 1 "$NOTES")
echo "$FIRST_LINE" | grep -q "W8 v15 LangGraph E2E 实证" \
  || { echo "[FAIL] first line mismatch: $FIRST_LINE"; exit 1; }
grep -q "journey_type" "$NOTES" && grep -q "dev_pipeline" "$NOTES" \
  || { echo "[FAIL] missing journey_type=dev_pipeline metadata"; exit 1; }

# === B. SQL 终态：sub_task status='completed' + result.pr_url 合规 ===
SQL_COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id IS NOT NULL
    AND status='completed'
    AND result->>'pr_url' ~ '^https://github\.com/.+/pull/[0-9]+$'
    AND updated_at > NOW() - INTERVAL '60 minutes'" | tr -d ' ')
[ "$SQL_COUNT" -ge 1 ] \
  || { echo "[FAIL] no completed sub_task with pr_url in last 60m"; exit 1; }

# === C. GitHub PR OPEN ===
PR_URL=$(psql "$DB" -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE parent_task_id IS NOT NULL AND status='completed'
    AND updated_at > NOW() - INTERVAL '60 minutes' LIMIT 1" | tr -d ' ')
PR_STATE=$(gh pr view "$PR_URL" --json state -q .state)
[ "$PR_STATE" = "OPEN" ] \
  || { echo "[FAIL] PR not OPEN: $PR_STATE (url=$PR_URL)"; exit 1; }

# === D. Brain 日志：5 节点 ok + 0 已修缺陷回归 + callback 真命中 ===
LOGS=$(docker logs cecelia-brain --since 60m 2>&1)
for node in planner proposer reviewer generator evaluator; do
  echo "$LOGS" | grep -qE "node=${node}.*(result=ok|verdict=(PROPOSED|APPROVED|GENERATED|PASS))" \
    || { echo "[FAIL] node $node missing ok"; exit 1; }
done
echo "$LOGS" | grep -qE "PROBE_FAIL_CONSOLIDATION|H7_STDOUT_LOST|H8_WORKTREE_MISS|H11_KEY_COLLISION|H13_DOD_NOT_FOUND" \
  && { echo "[FAIL] regression of fixed defect detected"; exit 1; } || true
echo "$LOGS" | grep -qE "callback received|/api/brain/tasks/.+/callback" \
  || { echo "[FAIL] no real callback endpoint hit"; exit 1; }

# === E. Run 时长 < 30 分钟 ===
DUR=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM (updated_at - created_at))::int FROM tasks
  WHERE parent_task_id IS NOT NULL AND status='completed'
    AND updated_at > NOW() - INTERVAL '60 minutes' LIMIT 1" | tr -d ' ')
[ -n "$DUR" ] && [ "$DUR" -lt 1800 ] \
  || { echo "[FAIL] run duration ${DUR}s exceeds 1800s"; exit 1; }

echo "✅ Golden Path 验证通过：v15 LangGraph harness 真端到端 reach status=completed (run=${DUR}s, pr=$PR_URL)"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: 写 Walking Skeleton noop 实证笔记

**范围**: generator 节点产出 `docs/learnings/w8-langgraph-v15-e2e.md`，作为本次 LangGraph harness e2e 真闭环验证的 walking-skeleton 物证。文件首行精确含 `W8 v15 LangGraph E2E 实证`，文件体含 sprint metadata（journey_type=dev_pipeline / KR 对齐说明 / W8 H7-H13 修复链路引用 / 4 项实证字段占位）。**严禁改动 packages/brain、packages/engine、packages/workflows 任何运行时代码或配置**——若任何运行时改动需求出现，本 sprint 直接 fail 并触发 H14+ 新 sprint。
**大小**: S（< 100 行；纯 markdown 文档，零代码）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/walking-skeleton.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/walking-skeleton.test.ts` | 文件可读且非空、首行包含 sprint 标识、metadata 含 journey_type=dev_pipeline、4 项实证字段占位齐全 | WS1 → 4 failures（generator 未写文件前 readFileSync 抛 ENOENT） |
