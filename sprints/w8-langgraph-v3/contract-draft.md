# Sprint Contract Draft (Round 1)

> **Initiative**: W8 Acceptance v3 — LangGraph 14 节点端到端验证（post-deploy）
> **Initiative ID**: `harness-acceptance-v3-2026-05-07`
> **Journey Type**: `autonomous`
> **Sprint Dir**: `sprints/w8-langgraph-v3`
> **Acceptance 工作目录**（Brain 派出的子 dev task 落地处）: `sprints/harness-acceptance-v3/`

## Golden Path

[Pre-flight 与派发] → [14 节点全过] → [故障 A: Docker SIGKILL 自愈] → [故障 B: max_fix_rounds → interrupt → resume(abort)] → [故障 C: deadline 逾期 → watchdog → fresh thread] → [最终验证 + 报告 + KR 回写]

---

### Step 1: Pre-flight 校验通过 + Acceptance Initiative 已派发

**可观测行为**:
- Brain 容器内 git HEAD 与 origin/main HEAD 一致（部署对得上 main）
- Brain `/api/brain/status` 非 emergency_brake
- 同 `initiative_id` 历史 acceptance run 未占位（v3 fresh）
- 一条 `task_type=harness_initiative`、`priority=P1`、`payload.initiative_id=harness-acceptance-v3-2026-05-07`、`payload.sprint_dir=sprints/harness-acceptance-v3` 的 task 已注册并 dispatched，状态从 `queued` 进入 `in_progress`，且 `timeout_sec >= 1800`

**验证命令**:
```bash
# 1) 部署一致性：Brain 容器 git HEAD == origin/main HEAD（防 stale 容器假绿）
BRAIN_HEAD=$(docker exec brain git rev-parse HEAD 2>/dev/null)
MAIN_HEAD=$(git rev-parse origin/main)
[ -n "$BRAIN_HEAD" ] && [ "$BRAIN_HEAD" = "$MAIN_HEAD" ] || { echo "FAIL: Brain HEAD=$BRAIN_HEAD != main=$MAIN_HEAD"; exit 1; }

# 2) Brain 非 emergency_brake
STATUS=$(curl -fsS localhost:5221/api/brain/status | jq -r '.brake_state // .state // "unknown"')
[ "$STATUS" != "emergency_brake" ] || { echo "FAIL: Brain in emergency_brake"; exit 1; }

# 3) acceptance_task_id 文件已写出（脚本 01 的输出契约）
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id 2>/dev/null | tr -d ' \n')
[ -n "$ACCEPTANCE_TASK_ID" ] || { echo "FAIL: .acceptance-task-id missing"; exit 1; }

# 4) DB 校验：本任务在 5 分钟内被 dispatch（防止读旧 task 造假）
psql "$DB" -t -c "SELECT 1 FROM tasks
  WHERE id = '$ACCEPTANCE_TASK_ID'
    AND task_type = 'harness_initiative'
    AND priority = 'P1'
    AND (payload->>'initiative_id') = 'harness-acceptance-v3-2026-05-07'
    AND (payload->>'sprint_dir') = 'sprints/harness-acceptance-v3'
    AND COALESCE((payload->>'timeout_sec')::int, 0) >= 1800
    AND status IN ('in_progress','running','dispatched','queued')
    AND created_at > NOW() - INTERVAL '15 minutes'" | grep -q '^\s*1\s*$' \
  || { echo "FAIL: acceptance task not registered with required payload in last 15min"; exit 1; }

# 5) initiative_id 第一次出现：initiative_runs 历史最多 1 行（attempt=1），且 created_at 在 15 分钟内
psql "$DB" -t -c "SELECT count(*) FROM initiative_runs
  WHERE initiative_id = 'harness-acceptance-v3-2026-05-07'
    AND created_at > NOW() - INTERVAL '15 minutes'" | tr -d ' ' | grep -qE '^[1-9][0-9]*$' \
  || { echo "FAIL: no initiative_runs row created in last 15min"; exit 1; }
```

**硬阈值**:
- Brain HEAD == origin/main HEAD（字符串完全相等，禁止 startswith）
- `tasks` 行 `created_at > NOW() - INTERVAL '15 minutes'` 防造假
- `payload.timeout_sec >= 1800`（防 watchdog 误杀 acceptance 主任务）
- `initiative_runs` 行 `created_at > NOW() - INTERVAL '15 minutes'`（防读历史 v1/v2 行）

---

### Step 2: 14 节点 graph_node_update 事件齐全

**可观测行为**: `task_events` 中针对该 acceptance run 出现 14 种 distinct `node_name` 的 `graph_node_update` 事件（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report），且全部在 acceptance 派发后 60 分钟内产生。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')

# 1) 14 个 distinct 节点都至少出现 1 次 graph_node_update（且新鲜：60 分钟内）
DISTINCT_NODES=$(psql "$DB" -t -c "
  SELECT count(DISTINCT (payload->>'node_name'))
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'graph_node_update'
     AND (payload->>'node_name') IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')
     AND created_at > NOW() - INTERVAL '60 minutes'" | tr -d ' ')
[ "$DISTINCT_NODES" = "14" ] || { echo "FAIL: distinct nodes=$DISTINCT_NODES (expected 14)"; exit 1; }

# 2) 报告 JSON 已写出（node × count 表）
test -f sprints/harness-acceptance-v3/reports/14-nodes-report.json || { echo "FAIL: 14-nodes-report.json missing"; exit 1; }
NODE_KEYS=$(jq -r '.nodes | keys | length' sprints/harness-acceptance-v3/reports/14-nodes-report.json)
[ "$NODE_KEYS" = "14" ] || { echo "FAIL: report nodes count=$NODE_KEYS (expected 14)"; exit 1; }
```

**硬阈值**:
- 14 distinct node_name 全到位
- `created_at > NOW() - INTERVAL '60 minutes'`（防读 v1/v2 旧 events）
- 报告 JSON 含 `nodes` 字段且 14 个 key

---

### Step 3: 故障 A — Docker SIGKILL 后自愈（W6 reject + W2 LLM_RETRY）

**可观测行为**: 在某 LLM_RETRY 节点（任意 prep/planner/parsePrd/ganLoop/run_sub_task 等）执行中 `docker kill <container>`；W6 Promise 立即 reject 写一条 `task_events` 标记 `injection=docker_sigkill`；W2 在 ≤3 次 LLM_RETRY 内重试成功，子任务最终态 PASS；全程无人工 SQL/重启介入。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')

# 1) 注入事件已记录（脚本 03 写入），injection=docker_sigkill 且新鲜
INJ_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'failure_injection'
     AND (payload->>'injection') = 'docker_sigkill'
     AND created_at > NOW() - INTERVAL '60 minutes'
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$INJ_AT" ] || { echo "FAIL: docker_sigkill injection event not recorded"; exit 1; }

# 2) 注入之后出现 LLM_RETRY 事件，且 retry_count ≥ 1 且 ≤ 3
RETRY_COUNT=$(psql "$DB" -t -c "
  SELECT COALESCE(MAX((payload->>'retry_count')::int), 0)
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'llm_retry'
     AND created_at > to_timestamp($INJ_AT)" | tr -d ' ')
[ "$RETRY_COUNT" -ge 1 ] && [ "$RETRY_COUNT" -le 3 ] \
  || { echo "FAIL: retry_count=$RETRY_COUNT (expected 1..3)"; exit 1; }

# 3) 注入之后子任务最终态 PASS（取注入后最新一次 sub_task 终态）
SUB_FINAL=$(psql "$DB" -t -c "
  SELECT (payload->>'final_status')
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'sub_task_finalized'
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ "$SUB_FINAL" = "PASS" ] || { echo "FAIL: sub_task final_status=$SUB_FINAL (expected PASS)"; exit 1; }

# 4) 注入到自愈的耗时 < 600 秒（防"刚好压在 watchdog deadline 上"假绿）
HEAL_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'sub_task_finalized'
     AND (payload->>'final_status') = 'PASS'
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at ASC LIMIT 1" | tr -d ' ')
[ -n "$HEAL_AT" ] && [ $((HEAL_AT - INJ_AT)) -lt 600 ] \
  || { echo "FAIL: heal duration too long or missing (inj=$INJ_AT heal=$HEAL_AT)"; exit 1; }
```

**硬阈值**:
- `failure_injection` 事件存在且 60 分钟内
- LLM_RETRY 次数在 [1, 3]
- 注入后子任务终态 PASS
- 注入→自愈 < 600s

---

### Step 4: 故障 B — max_fix_rounds → W5 interrupt → resume(abort) 干净到 END(error)

**可观测行为**: 在 `final_evaluate` 阶段持续 FAIL 直到撞 `max_fix_rounds`，W5 调用 `interrupt()` 在 `harness_interrupts` 写一条 pending；脚本随后 `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}`；resume 后 graph 走到 END(error)，acceptance 主任务 status=`failed`，`failure_reason='abort_after_max_fix_rounds'`（或 Brain 当前实现的等价值），不会持续重试。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')

# 1) 撞 max_fix_rounds 注入事件存在（脚本 04 写入）
INJ_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'failure_injection'
     AND (payload->>'injection') = 'max_fix_rounds_evaluator_fail'
     AND created_at > NOW() - INTERVAL '90 minutes'
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$INJ_AT" ] || { echo "FAIL: max_fix_rounds injection event missing"; exit 1; }

# 2) harness_interrupts 出现一条与 acceptance 关联的记录，pending → resumed(action=abort)
INTERRUPT_ROW=$(psql "$DB" -t -c "
  SELECT id || '|' || status || '|' || COALESCE(action,'') || '|' || COALESCE(EXTRACT(EPOCH FROM resolved_at)::bigint::text,'')
    FROM harness_interrupts
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
echo "$INTERRUPT_ROW" | grep -qE '\|(resolved|resumed)\|abort\|[1-9][0-9]*$' \
  || { echo "FAIL: interrupt row not in resolved/abort state: $INTERRUPT_ROW"; exit 1; }

# 3) Pending 时刻先于 resume 时刻（防伪造：必须真的 pending 过）
PENDING_FIRST=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM harness_interrupts
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND status IN ('pending','open','waiting')
     AND created_at > to_timestamp($INJ_AT)
   LIMIT 1" 2>/dev/null | tr -d ' ')
# 备选：如果一条记录跨状态变更，pending 状态可能由 events 表追踪；放宽到必须先有 status=pending 的事件
PENDING_EVT=$(psql "$DB" -t -c "
  SELECT count(*) FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'harness_interrupt_pending'
     AND created_at > to_timestamp($INJ_AT)" | tr -d ' ')
[ -n "$PENDING_FIRST" ] || [ "$PENDING_EVT" -ge 1 ] \
  || { echo "FAIL: no pending stage observed before resume"; exit 1; }

# 4) acceptance task 最终 status=failed 且 failure_reason 反映 abort
TASK_TERMINAL=$(psql "$DB" -t -c "
  SELECT status || '|' || COALESCE(failure_reason,'')
    FROM tasks
   WHERE id = '$ACCEPTANCE_TASK_ID'" | tr -d ' ')
echo "$TASK_TERMINAL" | grep -qE '^failed\|.*(abort|max_fix_rounds).*' \
  || { echo "FAIL: acceptance task terminal=$TASK_TERMINAL (expected failed|*abort|max_fix_rounds*)"; exit 1; }
```

**硬阈值**:
- `failure_injection` 事件含 `injection='max_fix_rounds_evaluator_fail'`
- `harness_interrupts` 至少先 pending 后 resolved/resumed，`action='abort'`，`resolved_at` 非空
- acceptance task 最终 `status='failed'` 且 `failure_reason` 含 `abort` 或 `max_fix_rounds`

---

### Step 5: 故障 C — deadline 逾期 → watchdog 标失败 → 重派 fresh thread（attempt+1）

**可观测行为**: 通过 `UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id='harness-acceptance-v3-2026-05-07' AND attempt=N`；W3 watchdog 在 ≤5 分钟内扫到 → 该 attempt 行 `phase='failed', failure_reason='watchdog_overdue'`；同 `initiative_id` 重派后产生 `attempt=N+1` 的新行，且新行 `thread_id` 与上一行不同（fresh thread）。

**验证命令**:
```bash
INIT_ID='harness-acceptance-v3-2026-05-07'

# 1) 注入事件（脚本 05 写入），含被 update 的 attempt 编号
INJ_ROW=$(psql "$DB" -t -c "
  SELECT (payload->>'attempt')::int || '|' || EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE event_type = 'failure_injection'
     AND (payload->>'injection') = 'deadline_overdue'
     AND (payload->>'initiative_id') = '$INIT_ID'
     AND created_at > NOW() - INTERVAL '90 minutes'
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
INJ_ATTEMPT=${INJ_ROW%%|*}
INJ_AT=${INJ_ROW##*|}
[ -n "$INJ_ATTEMPT" ] && [ -n "$INJ_AT" ] || { echo "FAIL: deadline_overdue injection event missing"; exit 1; }

# 2) 被注入的 attempt 行最终 phase=failed + failure_reason=watchdog_overdue
psql "$DB" -t -c "
  SELECT 1 FROM initiative_runs
   WHERE initiative_id = '$INIT_ID'
     AND attempt = $INJ_ATTEMPT
     AND phase = 'failed'
     AND failure_reason = 'watchdog_overdue'
     AND updated_at > to_timestamp($INJ_AT)" | grep -q '^\s*1\s*$' \
  || { echo "FAIL: attempt=$INJ_ATTEMPT not marked watchdog_overdue"; exit 1; }

# 3) watchdog 反应耗时 ≤ 300s
REACT_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM updated_at)::bigint
    FROM initiative_runs
   WHERE initiative_id = '$INIT_ID' AND attempt = $INJ_ATTEMPT
     AND phase = 'failed' AND failure_reason = 'watchdog_overdue'" | tr -d ' ')
[ -n "$REACT_AT" ] && [ $((REACT_AT - INJ_AT)) -le 300 ] \
  || { echo "FAIL: watchdog reaction too slow (inj=$INJ_AT react=$REACT_AT)"; exit 1; }

# 4) 重派后存在 attempt=N+1 的 initiative_runs 行，且 thread_id 不同
NEXT_ATTEMPT=$((INJ_ATTEMPT + 1))
THREADS=$(psql "$DB" -t -c "
  SELECT string_agg(DISTINCT thread_id::text, ',' ORDER BY thread_id::text)
    FROM initiative_runs
   WHERE initiative_id = '$INIT_ID'
     AND attempt IN ($INJ_ATTEMPT, $NEXT_ATTEMPT)
     AND created_at > to_timestamp($INJ_AT - 60)" | tr -d ' ')
echo "$THREADS" | tr ',' '\n' | sort -u | wc -l | grep -q '^\s*2\s*$' \
  || { echo "FAIL: expected 2 distinct thread_ids across attempts $INJ_ATTEMPT,$NEXT_ATTEMPT, got: $THREADS"; exit 1; }
```

**硬阈值**:
- `failure_injection` 事件含 `injection='deadline_overdue'` 且 `payload.attempt`
- watchdog 反应 ≤300s
- 重派后 `attempt=N+1` 行存在且 `thread_id` 与 N 不同

---

### Step 6: 最终验证 — health endpoint live + 子 dev task PR merged + KR 进度回写 + 报告产出

**可观测行为**:
- `GET /api/brain/harness/health` 返回 200 且 body 含 `langgraph_version`、`last_attempt_at`（且 `last_attempt_at` 在过去 90 分钟内）
- acceptance initiative 派出的子 dev task 至少 1 个 PR 已 merged（`tasks.result.pr_url` 非空 + GitHub API 返回 `merged=true`）
- KR 进度增量 ≥ 1%（`/api/brain/okr/current` 拉前后两次差值，或 `kr_progress_history` 表新行）
- `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md` 存在，含 3 段故障注入时间线 + 14 节点 events 表 + LiveMonitor URL

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')
REPORT=docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md

# 1) health endpoint live 且 last_attempt_at 新鲜（≤ 90 分钟）
HEALTH=$(curl -fsS localhost:5221/api/brain/harness/health)
LAV=$(echo "$HEALTH" | jq -r '.langgraph_version // empty')
LAT=$(echo "$HEALTH" | jq -r '.last_attempt_at // empty')
[ -n "$LAV" ] && [ -n "$LAT" ] || { echo "FAIL: health body missing langgraph_version/last_attempt_at: $HEALTH"; exit 1; }
LAT_EPOCH=$(date -d "$LAT" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
[ $((NOW_EPOCH - LAT_EPOCH)) -lt 5400 ] || { echo "FAIL: last_attempt_at stale ($LAT)"; exit 1; }

# 2) 子 dev task PR merged（GitHub API 真查，防伪造）
PR_URL=$(psql "$DB" -t -c "
  SELECT (result->>'pr_url')
    FROM tasks
   WHERE parent_task_id = '$ACCEPTANCE_TASK_ID'
     AND status = 'completed'
     AND (result->>'pr_url') IS NOT NULL
     AND (result->>'pr_url') <> ''
   ORDER BY updated_at DESC LIMIT 1" | tr -d ' ')
[ -n "$PR_URL" ] || { echo "FAIL: no merged child task with pr_url"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+')
MERGED=$(gh api "repos/{owner}/{repo}/pulls/$PR_NUM" --jq '.merged' 2>/dev/null)
[ "$MERGED" = "true" ] || { echo "FAIL: PR #$PR_NUM not merged on GitHub (got: $MERGED)"; exit 1; }

# 3) KR 进度 +1%（新 history 行，window 约束防伪造）
PROG_DELTA=$(psql "$DB" -t -c "
  WITH recent AS (
    SELECT progress_pct
      FROM kr_progress_history
     WHERE kr_key LIKE '%harness%' OR kr_key LIKE '%langgraph%'
     ORDER BY recorded_at DESC LIMIT 2
  )
  SELECT MAX(progress_pct) - MIN(progress_pct) FROM recent" | tr -d ' ')
awk -v d="$PROG_DELTA" 'BEGIN{exit !(d+0 >= 1)}' \
  || { echo "FAIL: KR progress delta=$PROG_DELTA (expected >=1)"; exit 1; }

# 4) 报告文件存在 + 必含章节
test -f "$REPORT" || { echo "FAIL: report missing: $REPORT"; exit 1; }
for SEC in "## 故障注入 A" "## 故障注入 B" "## 故障注入 C" "## 14 节点事件表" "LiveMonitor"; do
  grep -qF "$SEC" "$REPORT" || { echo "FAIL: report missing section: $SEC"; exit 1; }
done

# 5) 报告含 3 段时间线（注入时刻/反应时刻/自愈终态），用 grep 计数
TIMELINE_COUNT=$(grep -cE '^- \*\*(注入时刻|反应时刻|自愈终态)\*\*' "$REPORT" || true)
[ "$TIMELINE_COUNT" -ge 9 ] || { echo "FAIL: timeline lines=$TIMELINE_COUNT (expected >=9 = 3*3)"; exit 1; }
```

**硬阈值**:
- health endpoint 200 + body 含 `langgraph_version`、`last_attempt_at`（≤90 分钟新鲜）
- 子 dev task PR 在 GitHub API `merged=true`（不是只看 DB）
- KR 进度增量 ≥1
- 报告含 3 段故障时间线、14 节点表、LiveMonitor URL

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

: "${DB:=postgresql://localhost/cecelia}"
SPRINT_DIR=sprints/w8-langgraph-v3
ACCEPT_DIR=sprints/harness-acceptance-v3
INIT_ID='harness-acceptance-v3-2026-05-07'

# ---- 顺序触发 6 个工作流脚本（每个内部含验证，失败即 exit 非 0）----
bash $ACCEPT_DIR/scripts/01-preflight-and-dispatch.sh
bash $ACCEPT_DIR/scripts/02-verify-14-nodes.sh
bash $ACCEPT_DIR/scripts/03-inject-docker-sigkill.sh
bash $ACCEPT_DIR/scripts/04-inject-max-fix-rounds.sh
bash $ACCEPT_DIR/scripts/05-inject-deadline-overdue.sh
bash $ACCEPT_DIR/scripts/06-final-report.sh

ACCEPTANCE_TASK_ID=$(cat $ACCEPT_DIR/.acceptance-task-id | tr -d ' \n')

# ---- 终验证：6 个 Step 的 Step-N 验证命令依次重跑 ----

# Step 1
[ "$(docker exec brain git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || exit 1
curl -fsS localhost:5221/api/brain/status | jq -e '(.brake_state // .state) != "emergency_brake"' >/dev/null

# Step 2
DISTINCT=$(psql "$DB" -t -c "
  SELECT count(DISTINCT (payload->>'node_name'))
    FROM task_events
   WHERE task_id='$ACCEPTANCE_TASK_ID'
     AND event_type='graph_node_update'
     AND (payload->>'node_name') IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')
     AND created_at > NOW() - INTERVAL '120 minutes'" | tr -d ' ')
[ "$DISTINCT" = "14" ] || exit 1

# Step 3
psql "$DB" -t -c "SELECT 1 FROM task_events
  WHERE task_id='$ACCEPTANCE_TASK_ID' AND event_type='failure_injection'
    AND (payload->>'injection')='docker_sigkill'
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1
psql "$DB" -t -c "SELECT 1 FROM task_events
  WHERE task_id='$ACCEPTANCE_TASK_ID' AND event_type='sub_task_finalized'
    AND (payload->>'final_status')='PASS'
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1

# Step 4
psql "$DB" -t -c "SELECT 1 FROM harness_interrupts
  WHERE task_id='$ACCEPTANCE_TASK_ID' AND status IN ('resolved','resumed')
    AND action='abort' AND resolved_at IS NOT NULL
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1

# Step 5
psql "$DB" -t -c "SELECT 1 FROM initiative_runs
  WHERE initiative_id='$INIT_ID' AND phase='failed' AND failure_reason='watchdog_overdue'
    AND updated_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1
NUM_THREADS=$(psql "$DB" -t -c "SELECT count(DISTINCT thread_id) FROM initiative_runs
  WHERE initiative_id='$INIT_ID'
    AND created_at > NOW() - INTERVAL '120 minutes'" | tr -d ' ')
[ "$NUM_THREADS" -ge 2 ] || exit 1

# Step 6
curl -fsS localhost:5221/api/brain/harness/health | jq -e '.langgraph_version != null and .last_attempt_at != null' >/dev/null
test -f docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md
grep -qF "## 14 节点事件表" docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md
grep -qF "LiveMonitor" docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md

echo "✅ Golden Path E2E 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 6

### Workstream 1: Pre-flight 校验 + Acceptance Initiative 派发脚本

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/01-preflight-and-dispatch.sh`，包含：
- Brain 容器 git HEAD 与 origin/main 比对
- `/api/brain/status` 非 emergency_brake 校验
- 残留 vitest 进程清理（`pkill -f 'vitest run'`，最多 5 个，超过则 abort 并打印列表，避免误杀）
- DB 校验 `initiative_id='harness-acceptance-v3-2026-05-07'` 历史不存在
- `POST /api/brain/tasks` 注册 acceptance task（含 `priority=P1`、`payload.timeout_sec=2400`、`payload.thin_feature.endpoint='GET /api/brain/harness/health'`、`payload.thin_feature.fields=['langgraph_version','last_attempt_at']`、`payload.e2e_test_path='tests/e2e/harness-acceptance-smoke.spec.ts'`）
- `POST /api/brain/harness/dispatch`（或 Brain 当前实际 dispatch endpoint；脚本先 `GET /api/brain/openapi.json` 探测可用路径，落空则失败 fast）
- 写出 `sprints/harness-acceptance-v3/.acceptance-task-id` 文件

**大小**: M（约 150 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws1/preflight-and-dispatch.test.ts`

---

### Workstream 2: 14 节点 graph_node_update 事件轮询与报告

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh` + `sprints/harness-acceptance-v3/lib/14-nodes-report.mjs`，包含：
- 读 `.acceptance-task-id`，每 10s 轮询 `task_events` 表，最多 60 分钟（2400s 超时与主任务 timeout_sec 对齐 + buffer）
- 命中 14 distinct node_name 时退出，否则超时 exit 1
- 输出 `sprints/harness-acceptance-v3/reports/14-nodes-report.json`（schema：`{nodes: {prep: {count: N, first_at, last_at}, ...}, total_events, sampled_at}`）

**大小**: M（约 130 行：脚本 30 + 报告生成器 100）
**依赖**: Workstream 1（需读 `.acceptance-task-id`）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws2/verify-14-nodes.test.ts`

---

### Workstream 3: 故障注入 A — Docker SIGKILL 自愈

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh`，包含：
- 探测当前 acceptance run 关联的运行中 docker container（通过 `docker ps --filter "label=cecelia.task_id=<acceptance_task_id>"` 或子任务 container 命名约定）
- 选 1 个进行 `docker kill --signal=KILL`
- 写一条 `task_events` 记录 `event_type='failure_injection'`、`payload.injection='docker_sigkill'`、`payload.container_id=<id>`
- 轮询 ≤10 分钟，期望出现 LLM_RETRY 事件 + 子任务 final_status=PASS
- 命中即 exit 0；超时 exit 1；retry_count > 3 视为失败

**大小**: M（约 150 行）
**依赖**: Workstream 2（在 14 节点全部到位之前不应注入，避免事件混淆）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws3/inject-docker-sigkill.test.ts`

---

### Workstream 4: 故障注入 B — max_fix_rounds → interrupt → resume(abort)

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh` + `sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs`，包含：
- 通过 Brain 提供的 evaluator override hook（`POST /api/brain/harness/evaluator-override` body `{task_id, mode:'always_fail', reason:'acceptance_v3_inject_B'}`；若 endpoint 不存在则用 DB 直写 `harness_evaluator_overrides` 表，需在脚本头部 fallback 切换）
- 写 `task_events` 注入事件
- 轮询 `harness_interrupts` 直到出现 pending 行（≤10 分钟）
- `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}`
- 验证 acceptance task 进入 `failed` 终态且 `failure_reason` 含 `abort` 或 `max_fix_rounds`
- 清理 evaluator override

**大小**: L（约 220 行）
**依赖**: Workstream 3

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws4/inject-max-fix-rounds.test.ts`

---

### Workstream 5: 故障注入 C — Deadline 逾期 → watchdog → fresh thread

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh`，包含：
- 读当前 attempt N（`SELECT MAX(attempt) FROM initiative_runs WHERE initiative_id=...`）
- `UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id=... AND attempt=N`（必须用事务 + WHERE 限定，禁止 unbounded UPDATE）
- 写 `task_events` 注入事件，`payload.attempt=N`
- 轮询 ≤6 分钟，等待 `phase='failed', failure_reason='watchdog_overdue'`
- 重派 dispatch 同 `initiative_id`
- 验证 `attempt=N+1` 行 + thread_id 不同
- 结束时还原 deadline_at（`UPDATE initiative_runs SET deadline_at = NULL WHERE attempt=N`，避免后续脚本读到污染状态）

**大小**: M（约 180 行）
**依赖**: Workstream 4（场景 C 必须在 B 之后跑，因为 B 已让原 task `failed`，C 利用 fresh attempt）

> **注**：场景 B 已经把 acceptance task 推到 failed 终态，因此 C 注入的 attempt 应来自重派后的 fresh 行；如果 Brain 当前实现是"手动重派"才会产 attempt=N+1，则脚本 05 内部先做一次重派建出 attempt=2，再注入。

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws5/inject-deadline-overdue.test.ts`

---

### Workstream 6: 最终验证 + 报告生成 + KR 回写

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/06-final-report.sh` + `sprints/harness-acceptance-v3/lib/render-report.mjs`，包含：
- 校验 `/api/brain/harness/health` 200 + 字段 + 新鲜度
- 校验子 dev task PR `merged=true`（`gh api repos/<owner>/<repo>/pulls/<num>`）
- 计算 KR 进度增量（前后两次 `/api/brain/okr/current` 拉取 + 写 `kr_progress_history` 增量行）
- 调用 `PATCH /api/brain/okr/kr/:kr_id` 回写 +1% 进度（如已 ≥1% 则 no-op，幂等）
- 渲染 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md`，章节固定：
  - `## Pre-flight 与派发`
  - `## 14 节点事件表`（从 `reports/14-nodes-report.json` 读 + 渲染 markdown 表）
  - `## 故障注入 A` / `## 故障注入 B` / `## 故障注入 C`，每段含 `- **注入时刻**:` / `- **反应时刻**:` / `- **自愈终态**:` 三行
  - `## 最终验证`（含 LiveMonitor URL：`http://localhost:5174/monitor?task_id=<acceptance_task_id>`）

**大小**: L（约 250 行：脚本 80 + render-report.mjs 170）
**依赖**: Workstream 5

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws6/final-report.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/preflight-and-dispatch.test.ts` | preflight 检测 stale Brain 抛错 / dispatch 后写出 `.acceptance-task-id` 文件 / 注册的 task payload 含 `timeout_sec>=1800` | 模块 `lib/preflight.mjs` 不存在 → import 抛错 → 4 个 `it` 全 FAIL |
| WS2 | `tests/ws2/verify-14-nodes.test.ts` | 报告含 14 个 node key / 任一缺失节点时返回非 0 exit / 超时机制（mock clock） | `lib/14-nodes-report.mjs` 不存在 → 3 个 `it` 全 FAIL |
| WS3 | `tests/ws3/inject-docker-sigkill.test.ts` | 注入事件 payload 字段完整 / retry_count>3 时返回失败 / 自愈耗时计算正确 | `lib/inject-docker-sigkill.mjs` 不存在 → 3 个 `it` 全 FAIL |
| WS4 | `tests/ws4/inject-max-fix-rounds.test.ts` | evaluator override fallback 顺序正确 / resume body 含 `action:"abort"` / interrupt 超时（24h）边界处理 | `lib/evaluator-fail-injector.mjs` 不存在 → 3 个 `it` 全 FAIL |
| WS5 | `tests/ws5/inject-deadline-overdue.test.ts` | UPDATE 必须含 WHERE attempt=N / 还原 deadline_at 在异常路径也执行（finally） / fresh thread_id 检查正确 | `lib/inject-deadline-overdue.mjs` 不存在 → 3 个 `it` 全 FAIL |
| WS6 | `tests/ws6/final-report.test.ts` | 报告 6 段章节齐全 / KR 回写幂等 / GitHub PR merged 校验调用了真实 API | `lib/render-report.mjs` 不存在 → 4 个 `it` 全 FAIL |

总计 BEHAVIOR `it` 块: 20。Red 阶段全部 FAIL（lib 模块均不存在）。

---

## Generator 实现纪律

- **CONTRACT IS LAW**: 合同里有的全实现，合同外一字不加。
- **TDD 两次 commit**:
  1. commit-1: 仅复制本目录 `tests/ws{N}/*.test.ts`（一字不改）+ 空 `lib/*.mjs`（导出 stub 抛 `Error('not implemented')`）→ Red 证据。
  2. commit-2: 实现 `lib/*.mjs` 与 `scripts/*.sh` → Green。
- **CI 强校验**: commit-1 后测试文件再被改动 → CI exit 1。
- **不修 packages/brain / packages/engine / apps/dashboard 任何代码**（PRD 范围限定）；如确实发现 Brain bug，单独开 task 而非夹带。
