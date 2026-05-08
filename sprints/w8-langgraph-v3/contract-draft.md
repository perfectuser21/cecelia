# Sprint Contract Draft (Round 2)

> **Initiative**: W8 Acceptance v3 — LangGraph 14 节点端到端验证（post-deploy）
> **Initiative ID**: `harness-acceptance-v3-2026-05-07`
> **Journey Type**: `autonomous`
> **Sprint Dir**: `sprints/w8-langgraph-v3`
> **Acceptance 工作目录**（Brain 派出的子 dev task 落地处）: `sprints/harness-acceptance-v3/`

---

## 常量表（Single Source of Truth）

> **写作规则**：合同后续 Step / Workstream / E2E 脚本 / 测试 在引用以下数字或枚举字面量时，**必须以常量名调用并在注释里标注其值**（如：`# 引用 TASK_TIMEOUT_SEC=2400`），禁止裸写魔术数字。

### 数值与字符串常量

| 常量名 | 值 | 用途 / 出现位置 |
|---|---|---|
| `INITIATIVE_ID` | `harness-acceptance-v3-2026-05-07` | acceptance run 唯一标识；Step 1/4/5/6、WS1/4/5/6 引用 |
| `SPRINT_DIR` | `sprints/w8-langgraph-v3` | 本 sprint 主目录（合同/测试/任务计划） |
| `ACCEPT_DIR` | `sprints/harness-acceptance-v3` | acceptance 派出的子 dev task 工作目录（Brain 建） |
| `TASK_TIMEOUT_SEC` | **2400**（设定值） | WS1 注册 acceptance task 时写入 `payload.timeout_sec` 的固定值 |
| `TASK_TIMEOUT_MIN_SEC` | **1800**（最低阈值） | PRD 规定的下限；DoD/合同的"≥ 1800" 校验由此值给出。**关系**：`TASK_TIMEOUT_SEC=2400 ≥ TASK_TIMEOUT_MIN_SEC=1800`，前者是 WS1 实际写入值，后者是合同最低门槛 |
| `MAX_LLM_RETRY` | **3** | 场景 A：W2 LLM_RETRY 自动重试上限；retry_count > 3 视为自愈失败 |
| `WATCHDOG_BUDGET_S` | **300** | 场景 C：watchdog 从 deadline_at 过期到 `phase='failed'` 的反应预算 |
| `HEAL_BUDGET_S` | **600** | 场景 A：从 docker_sigkill 注入到子任务 final_status=PASS 的总自愈预算 |
| `HEALTH_FRESHNESS_S` | **5400**（即 90 分钟） | Step 6：health endpoint `last_attempt_at` 与 NOW 的最大 gap |
| `EVENTS_FRESH_WIN_60M` | `60 minutes` | Step 2/3：task_events `created_at > NOW() - INTERVAL` 防读旧 v1/v2 行 |
| `EVENTS_FRESH_WIN_90M` | `90 minutes` | Step 4：max_fix_rounds 注入相关事件窗口（含场景 B 较长 final_evaluate 撞次） |
| `EVENTS_FRESH_WIN_120M` | `120 minutes` | E2E 终验扩展窗口（覆盖 5 个工作流串行总耗时） |
| `PREFLIGHT_FRESH_WIN_15M` | `15 minutes` | Step 1：preflight DB 校验（task / initiative_runs 行新鲜度） |
| `INTERRUPT_TIMEOUT_H` | **24** | W5 interrupt 自动 timeout 边界（仅供报告记录主理人 resume 时刻参考） |
| `DEADLINE_NUDGE_INTERVAL` | `1 minute` | 场景 C：`deadline_at = NOW() - INTERVAL '1 minute'` 的偏移量 |
| `KR_DELTA_MIN_PCT` | **1** | KR 进度回写最低增量（百分点） |
| `LIVE_MONITOR_URL_TEMPLATE` | `http://localhost:5174/monitor?task_id=<id>` | LiveMonitor URL 模板（报告必含此格式） |
| `BRAIN_API_BASE` | `http://localhost:5221` | Brain 服务地址 |
| `REPORT_PATH` | `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md` | 最终 acceptance 报告产出路径 |
| `GRAPH_NODES` | `[prep, planner, parsePrd, ganLoop, inferTaskPlan, dbUpsert, pick_sub_task, run_sub_task, evaluate, advance, retry, terminal_fail, final_evaluate, report]`（共 14 项） | Step 2 / WS2 / WS6 渲染节点表的顺序与字面量唯一来源 |

### 事件 / 状态枚举（一次定义全局生效）

| 实体 | 字段 | 取值集合 | 备注 |
|---|---|---|---|
| `task_events` | `event_type` | `{graph_node_update, failure_injection, llm_retry, sub_task_finalized, harness_interrupt_pending}` | 本合同 Step/WS 中所有 grep/SQL filter 必须从此集合取值 |
| `task_events.payload` | `injection`（仅 `event_type='failure_injection'`） | `{docker_sigkill, max_fix_rounds_evaluator_fail, deadline_overdue}` | **三类故障注入的唯一字面量来源**；Step 3/4/5 / WS3/4/5 全部引用此枚举 |
| `task_events.payload` | `final_status`（仅 `event_type='sub_task_finalized'`） | `{PASS, FAIL}` | Step 3 自愈终态判定 |
| `task_events.payload` | `node_name`（仅 `event_type='graph_node_update'`） | = `GRAPH_NODES`（见上 14 项） | Step 2 / WS2 引用 |
| `harness_interrupts` | `status` | `{pending, resolved, resumed}` | Step 4：先 `pending` 后 `resolved` 或 `resumed`（兼容 Brain 实现，二者皆可） |
| `harness_interrupts` | `action` | `{abort, retry, edit}` | Step 4 / WS4：场景 B 严格使用 `abort` |
| `initiative_runs` | `phase` | `{running, failed, succeeded}` | Step 5：场景 C 期望终态 `failed` |
| `initiative_runs` | `failure_reason` | `{watchdog_overdue, abort_after_max_fix_rounds}`（本合同覆盖范围；其他 reason 不在 scope） | Step 4 期望 `abort_after_max_fix_rounds`；Step 5 期望 `watchdog_overdue` |
| `tasks` | `status` | `{queued, in_progress, running, dispatched, completed, failed}` | Step 1/4 引用 |
| `tasks` | `priority` | `{P0, P1, P2, P3}` | WS1：acceptance 用 `P1` |

> **Reviewer 反馈对齐**：所有正则、grep、SQL `IN (...)`、JSON 比较 必须直接以本枚举集合的字面量出现；不得用宽泛模式（如 `(abort|max_fix_rounds)`）替代精确枚举值（`abort_after_max_fix_rounds`）。

---

## Golden Path

[Pre-flight 与派发] → [14 节点全过] → [故障 A: `docker_sigkill` 自愈] → [故障 B: `max_fix_rounds_evaluator_fail` → interrupt → resume(abort)] → [故障 C: `deadline_overdue` → watchdog → fresh thread] → [最终验证 + 报告 + KR 回写]

---

### Step 1: Pre-flight 校验通过 + Acceptance Initiative 已派发

**可观测行为**:
- Brain 容器内 git HEAD 与 origin/main HEAD 一致（部署对得上 main）
- Brain `/api/brain/status` 非 emergency_brake
- 同 `INITIATIVE_ID` 历史 acceptance run 在 `PREFLIGHT_FRESH_WIN_15M` 内首次出现（v3 fresh）
- 一条 `task_type=harness_initiative`、`priority=P1`、`payload.initiative_id=INITIATIVE_ID`、`payload.sprint_dir=ACCEPT_DIR`、`payload.timeout_sec=TASK_TIMEOUT_SEC(2400)` 的 task 已注册并 dispatched，状态 ∈ `tasks.status` 枚举集合

**验证命令**:
```bash
# 引用常量：BRAIN_API_BASE / TASK_TIMEOUT_MIN_SEC=1800 / PREFLIGHT_FRESH_WIN_15M
INITIATIVE_ID='harness-acceptance-v3-2026-05-07'  # = INITIATIVE_ID 常量
ACCEPT_DIR=sprints/harness-acceptance-v3          # = ACCEPT_DIR 常量

# 1) 部署一致性：Brain 容器 git HEAD == origin/main HEAD（防 stale 容器假绿）
BRAIN_HEAD=$(docker exec brain git rev-parse HEAD 2>/dev/null)
MAIN_HEAD=$(git rev-parse origin/main)
[ -n "$BRAIN_HEAD" ] && [ "$BRAIN_HEAD" = "$MAIN_HEAD" ] || { echo "FAIL: Brain HEAD=$BRAIN_HEAD != main=$MAIN_HEAD"; exit 1; }

# 2) Brain 非 emergency_brake（引用 BRAIN_API_BASE）
STATUS=$(curl -fsS http://localhost:5221/api/brain/status | jq -r '.brake_state // .state // "unknown"')
[ "$STATUS" != "emergency_brake" ] || { echo "FAIL: Brain in emergency_brake"; exit 1; }

# 3) acceptance_task_id 文件已写出（脚本 01 的输出契约）
ACCEPTANCE_TASK_ID=$(cat $ACCEPT_DIR/.acceptance-task-id 2>/dev/null | tr -d ' \n')
[ -n "$ACCEPTANCE_TASK_ID" ] || { echo "FAIL: .acceptance-task-id missing"; exit 1; }

# 4) DB 校验：本任务在 PREFLIGHT_FRESH_WIN_15M(15 minutes) 内被 dispatch（防止读旧 task 造假）
#    timeout_sec 校验下限引用 TASK_TIMEOUT_MIN_SEC=1800
#    status 取自 tasks.status 枚举：{queued, in_progress, running, dispatched}
psql "$DB" -t -c "SELECT 1 FROM tasks
  WHERE id = '$ACCEPTANCE_TASK_ID'
    AND task_type = 'harness_initiative'
    AND priority = 'P1'
    AND (payload->>'initiative_id') = '$INITIATIVE_ID'
    AND (payload->>'sprint_dir') = '$ACCEPT_DIR'
    AND COALESCE((payload->>'timeout_sec')::int, 0) >= 1800   -- TASK_TIMEOUT_MIN_SEC
    AND status IN ('in_progress','running','dispatched','queued')  -- tasks.status 枚举
    AND created_at > NOW() - INTERVAL '15 minutes'                 -- PREFLIGHT_FRESH_WIN_15M
  " | grep -q '^\s*1\s*$' \
  || { echo "FAIL: acceptance task not registered with required payload in last 15min"; exit 1; }

# 5) initiative_id 第一次出现：initiative_runs 历史最多 1 行（attempt=1），且 created_at 在 PREFLIGHT_FRESH_WIN_15M 内
psql "$DB" -t -c "SELECT count(*) FROM initiative_runs
  WHERE initiative_id = '$INITIATIVE_ID'
    AND created_at > NOW() - INTERVAL '15 minutes'   -- PREFLIGHT_FRESH_WIN_15M
  " | tr -d ' ' | grep -qE '^[1-9][0-9]*$' \
  || { echo "FAIL: no initiative_runs row created in last 15min"; exit 1; }
```

**硬阈值**:
- Brain HEAD == origin/main HEAD（字符串完全相等，禁止 startswith）
- `tasks.created_at > NOW() - INTERVAL PREFLIGHT_FRESH_WIN_15M(15 min)` 防造假
- `payload.timeout_sec >= TASK_TIMEOUT_MIN_SEC(1800)`（防 watchdog 误杀 acceptance 主任务）
- `initiative_runs.created_at > NOW() - INTERVAL PREFLIGHT_FRESH_WIN_15M`（防读历史 v1/v2 行）

---

### Step 2: 14 节点 graph_node_update 事件齐全

**可观测行为**: `task_events` 中针对该 acceptance run 出现 14 种 distinct `node_name` 的 `graph_node_update` 事件（取自 `GRAPH_NODES` 枚举），且全部在 acceptance 派发后 `EVENTS_FRESH_WIN_60M` 内产生。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')

# 1) 14 个 distinct 节点都至少出现 1 次 graph_node_update（且新鲜：EVENTS_FRESH_WIN_60M=60 minutes）
#    枚举来源：task_events.event_type='graph_node_update' / payload.node_name ∈ GRAPH_NODES
DISTINCT_NODES=$(psql "$DB" -t -c "
  SELECT count(DISTINCT (payload->>'node_name'))
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'graph_node_update'
     AND (payload->>'node_name') IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')  -- GRAPH_NODES 字面量
     AND created_at > NOW() - INTERVAL '60 minutes'   -- EVENTS_FRESH_WIN_60M
  " | tr -d ' ')
[ "$DISTINCT_NODES" = "14" ] || { echo "FAIL: distinct nodes=$DISTINCT_NODES (expected 14)"; exit 1; }

# 2) 报告 JSON 已写出（node × count 表）
test -f sprints/harness-acceptance-v3/reports/14-nodes-report.json || { echo "FAIL: 14-nodes-report.json missing"; exit 1; }
NODE_KEYS=$(jq -r '.nodes | keys | length' sprints/harness-acceptance-v3/reports/14-nodes-report.json)
[ "$NODE_KEYS" = "14" ] || { echo "FAIL: report nodes count=$NODE_KEYS (expected 14)"; exit 1; }
```

**硬阈值**:
- 14 distinct `node_name` 全到位（与 `GRAPH_NODES` 字面量集合 1:1 对齐）
- `created_at > NOW() - INTERVAL EVENTS_FRESH_WIN_60M`（防读 v1/v2 旧 events）
- 报告 JSON 含 `nodes` 字段且 14 个 key

---

### Step 3: 故障 A — `docker_sigkill` 自愈（W6 reject + W2 LLM_RETRY）

**可观测行为**: 在某 LLM_RETRY 节点（任意 `prep/planner/parsePrd/ganLoop/run_sub_task` 等 ∈ `GRAPH_NODES`）执行中 `docker kill <container>`；W6 Promise 立即 reject 并写一条 `task_events` 标记 `injection='docker_sigkill'`（取自 `failure_injection.injection` 枚举）；W2 在 ≤ `MAX_LLM_RETRY(3)` 次 LLM_RETRY 内重试成功，子任务最终态 `final_status='PASS'`；从注入到自愈耗时 < `HEAL_BUDGET_S(600)`；全程无人工 SQL/重启介入。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')

# 1) 注入事件已记录（脚本 03 写入），injection='docker_sigkill' 取自枚举 failure_injection.injection
INJ_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'failure_injection'              -- task_events.event_type 枚举
     AND (payload->>'injection') = 'docker_sigkill'    -- failure_injection.injection 枚举
     AND created_at > NOW() - INTERVAL '60 minutes'    -- EVENTS_FRESH_WIN_60M
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$INJ_AT" ] || { echo "FAIL: docker_sigkill injection event not recorded"; exit 1; }

# 2) 注入之后出现 LLM_RETRY 事件，且 retry_count ∈ [1, MAX_LLM_RETRY=3]
RETRY_COUNT=$(psql "$DB" -t -c "
  SELECT COALESCE(MAX((payload->>'retry_count')::int), 0)
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'llm_retry'                      -- task_events.event_type 枚举
     AND created_at > to_timestamp($INJ_AT)" | tr -d ' ')
[ "$RETRY_COUNT" -ge 1 ] && [ "$RETRY_COUNT" -le 3 ] \
  || { echo "FAIL: retry_count=$RETRY_COUNT (expected 1..MAX_LLM_RETRY=3)"; exit 1; }

# 3) 注入之后子任务最终态 final_status='PASS'（取自 sub_task_finalized.final_status 枚举 {PASS, FAIL}）
SUB_FINAL=$(psql "$DB" -t -c "
  SELECT (payload->>'final_status')
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'sub_task_finalized'             -- task_events.event_type 枚举
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ "$SUB_FINAL" = "PASS" ] || { echo "FAIL: sub_task final_status=$SUB_FINAL (expected PASS)"; exit 1; }

# 4) 注入到自愈的耗时 < HEAL_BUDGET_S=600 秒（防"刚好压在 watchdog deadline 上"假绿）
HEAL_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'sub_task_finalized'
     AND (payload->>'final_status') = 'PASS'
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at ASC LIMIT 1" | tr -d ' ')
[ -n "$HEAL_AT" ] && [ $((HEAL_AT - INJ_AT)) -lt 600 ] \
  || { echo "FAIL: heal duration too long or missing (inj=$INJ_AT heal=$HEAL_AT, budget=HEAL_BUDGET_S=600)"; exit 1; }
```

**硬阈值**:
- `failure_injection.injection='docker_sigkill'` 事件存在且 `EVENTS_FRESH_WIN_60M` 内
- LLM_RETRY 次数 ∈ [1, `MAX_LLM_RETRY=3`]
- 注入后子任务 `final_status='PASS'`
- 注入→自愈 < `HEAL_BUDGET_S=600s`

---

### Step 4: 故障 B — `max_fix_rounds_evaluator_fail` → W5 interrupt → resume(abort) 干净到 END(error)

**可观测行为**: 在 `final_evaluate` 阶段持续 FAIL 直到撞 `max_fix_rounds`，W5 调用 `interrupt()` 在 `harness_interrupts` 写一条 `status='pending'`（取自 `harness_interrupts.status` 枚举）；脚本随后 `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}`（`action='abort'` 取自 `harness_interrupts.action` 枚举）；resume 后 graph 走到 END(error)，acceptance 主任务 `tasks.status='failed'`，`initiative_runs.failure_reason='abort_after_max_fix_rounds'`（取自 `initiative_runs.failure_reason` 枚举），不会持续重试。

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')
INITIATIVE_ID='harness-acceptance-v3-2026-05-07'   # = INITIATIVE_ID 常量

# 1) 撞 max_fix_rounds 注入事件存在（脚本 04 写入）
#    injection='max_fix_rounds_evaluator_fail' 严格取自 failure_injection.injection 枚举
INJ_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'failure_injection'
     AND (payload->>'injection') = 'max_fix_rounds_evaluator_fail'   -- failure_injection.injection 枚举
     AND created_at > NOW() - INTERVAL '90 minutes'                  -- EVENTS_FRESH_WIN_90M
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$INJ_AT" ] || { echo "FAIL: max_fix_rounds_evaluator_fail injection event missing"; exit 1; }

# 2) harness_interrupts 出现一条与 acceptance 关联的记录，pending → resolved/resumed(action=abort)
#    status ∈ {pending, resolved, resumed}；action ∈ {abort, retry, edit}（本场景必须 abort）
INTERRUPT_ROW=$(psql "$DB" -t -c "
  SELECT id || '|' || status || '|' || COALESCE(action,'') || '|' || COALESCE(EXTRACT(EPOCH FROM resolved_at)::bigint::text,'')
    FROM harness_interrupts
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND created_at > to_timestamp($INJ_AT)
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
# 引用枚举常量：status ∈ {resolved, resumed}, action='abort', resolved_at NOT NULL
echo "$INTERRUPT_ROW" | grep -qE '\|(resolved|resumed)\|abort\|[1-9][0-9]*$' \
  || { echo "FAIL: interrupt row not in {resolved|resumed}/action=abort terminal: $INTERRUPT_ROW"; exit 1; }

# 3) Pending 时刻先于 resume 时刻（防伪造：必须真的 pending 过）
#    status='pending' ∈ harness_interrupts.status 枚举
PENDING_FIRST=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM created_at)::bigint
    FROM harness_interrupts
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND status = 'pending'                          -- harness_interrupts.status 枚举
     AND created_at > to_timestamp($INJ_AT)
   LIMIT 1" 2>/dev/null | tr -d ' ')
# 备选事件：harness_interrupt_pending 事件（task_events.event_type 枚举）
PENDING_EVT=$(psql "$DB" -t -c "
  SELECT count(*) FROM task_events
   WHERE task_id = '$ACCEPTANCE_TASK_ID'
     AND event_type = 'harness_interrupt_pending'    -- task_events.event_type 枚举
     AND created_at > to_timestamp($INJ_AT)" | tr -d ' ')
[ -n "$PENDING_FIRST" ] || [ "$PENDING_EVT" -ge 1 ] \
  || { echo "FAIL: no pending stage observed before resume"; exit 1; }

# 4) acceptance task 最终 status='failed' 且关联 initiative_runs.failure_reason='abort_after_max_fix_rounds'
#    严格匹配枚举常量（reviewer 反馈：禁止用 (abort|max_fix_rounds) 宽泛模式替代精确枚举值）
TASK_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACCEPTANCE_TASK_ID'" | tr -d ' ')
[ "$TASK_STATUS" = "failed" ] || { echo "FAIL: acceptance task status=$TASK_STATUS (expected failed ∈ tasks.status)"; exit 1; }
# initiative_runs.failure_reason 严格枚举值
INIT_REASON=$(psql "$DB" -t -c "
  SELECT failure_reason FROM initiative_runs
   WHERE initiative_id='$INITIATIVE_ID'
     AND created_at > to_timestamp($INJ_AT - 600)
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ "$INIT_REASON" = "abort_after_max_fix_rounds" ] \
  || { echo "FAIL: initiative_runs.failure_reason='$INIT_REASON' (expected enum 'abort_after_max_fix_rounds')"; exit 1; }
```

**硬阈值**:
- `failure_injection.injection='max_fix_rounds_evaluator_fail'`（枚举值精确匹配）
- `harness_interrupts.status` 至少先 `pending` 后 `{resolved|resumed}`，`action='abort'`，`resolved_at` 非空
- `tasks.status='failed'` 且 `initiative_runs.failure_reason='abort_after_max_fix_rounds'`（枚举值精确匹配）

---

### Step 5: 故障 C — `deadline_overdue` → watchdog 标失败 → 重派 fresh thread（attempt+1）

**可观测行为**: 通过 `UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL DEADLINE_NUDGE_INTERVAL(1 minute) WHERE initiative_id=INITIATIVE_ID AND attempt=N`；W3 watchdog 在 ≤ `WATCHDOG_BUDGET_S(300)` 内扫到 → 该 attempt 行 `phase='failed'`、`failure_reason='watchdog_overdue'`（均取自 `initiative_runs` 枚举）；同 `INITIATIVE_ID` 重派后产生 `attempt=N+1` 的新行，且新行 `thread_id` 与上一行不同（fresh thread）。

**验证命令**:
```bash
INITIATIVE_ID='harness-acceptance-v3-2026-05-07'   # = INITIATIVE_ID 常量

# 1) 注入事件（脚本 05 写入），含被 update 的 attempt 编号
#    injection='deadline_overdue' 严格取自 failure_injection.injection 枚举
INJ_ROW=$(psql "$DB" -t -c "
  SELECT (payload->>'attempt')::int || '|' || EXTRACT(EPOCH FROM created_at)::bigint
    FROM task_events
   WHERE event_type = 'failure_injection'
     AND (payload->>'injection') = 'deadline_overdue'    -- failure_injection.injection 枚举
     AND (payload->>'initiative_id') = '$INITIATIVE_ID'
     AND created_at > NOW() - INTERVAL '90 minutes'      -- EVENTS_FRESH_WIN_90M
   ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
INJ_ATTEMPT=${INJ_ROW%%|*}
INJ_AT=${INJ_ROW##*|}
[ -n "$INJ_ATTEMPT" ] && [ -n "$INJ_AT" ] || { echo "FAIL: deadline_overdue injection event missing"; exit 1; }

# 2) 被注入的 attempt 行最终 phase='failed' + failure_reason='watchdog_overdue'
#    严格取自 initiative_runs.phase / failure_reason 枚举
psql "$DB" -t -c "
  SELECT 1 FROM initiative_runs
   WHERE initiative_id = '$INITIATIVE_ID'
     AND attempt = $INJ_ATTEMPT
     AND phase = 'failed'                  -- initiative_runs.phase 枚举
     AND failure_reason = 'watchdog_overdue'   -- initiative_runs.failure_reason 枚举
     AND updated_at > to_timestamp($INJ_AT)" | grep -q '^\s*1\s*$' \
  || { echo "FAIL: attempt=$INJ_ATTEMPT not marked phase=failed/failure_reason=watchdog_overdue"; exit 1; }

# 3) watchdog 反应耗时 ≤ WATCHDOG_BUDGET_S=300s
REACT_AT=$(psql "$DB" -t -c "
  SELECT EXTRACT(EPOCH FROM updated_at)::bigint
    FROM initiative_runs
   WHERE initiative_id = '$INITIATIVE_ID' AND attempt = $INJ_ATTEMPT
     AND phase = 'failed' AND failure_reason = 'watchdog_overdue'" | tr -d ' ')
[ -n "$REACT_AT" ] && [ $((REACT_AT - INJ_AT)) -le 300 ] \
  || { echo "FAIL: watchdog reaction too slow (inj=$INJ_AT react=$REACT_AT, budget=WATCHDOG_BUDGET_S=300)"; exit 1; }

# 4) 重派后存在 attempt=N+1 的 initiative_runs 行，且 thread_id 不同
NEXT_ATTEMPT=$((INJ_ATTEMPT + 1))
THREADS=$(psql "$DB" -t -c "
  SELECT string_agg(DISTINCT thread_id::text, ',' ORDER BY thread_id::text)
    FROM initiative_runs
   WHERE initiative_id = '$INITIATIVE_ID'
     AND attempt IN ($INJ_ATTEMPT, $NEXT_ATTEMPT)
     AND created_at > to_timestamp($INJ_AT - 60)" | tr -d ' ')
echo "$THREADS" | tr ',' '\n' | sort -u | wc -l | grep -q '^\s*2\s*$' \
  || { echo "FAIL: expected 2 distinct thread_ids across attempts $INJ_ATTEMPT,$NEXT_ATTEMPT, got: $THREADS"; exit 1; }
```

**硬阈值**:
- `failure_injection.injection='deadline_overdue'`（枚举值精确匹配）且 `payload.attempt` 非空
- watchdog 反应 ≤ `WATCHDOG_BUDGET_S=300s`
- 重派后 `attempt=N+1` 行存在且 `thread_id` 与 N 不同

---

### Step 6: 最终验证 — health endpoint live + 子 dev task PR merged + KR 进度回写 + 报告产出

**可观测行为**:
- `GET /api/brain/harness/health` 返回 200 且 body 含 `langgraph_version`、`last_attempt_at`，且 `last_attempt_at` 与 NOW 的 gap ≤ `HEALTH_FRESHNESS_S(5400 秒，即 90 分钟)`
- acceptance initiative 派出的子 dev task 至少 1 个 PR 已 merged（`tasks.result.pr_url` 非空 + GitHub API 返回 `merged=true`）
- KR 进度增量 ≥ `KR_DELTA_MIN_PCT(1)` 百分点（`/api/brain/okr/current` 拉前后两次差值，或 `kr_progress_history` 表新行）
- `REPORT_PATH` 文件存在，含 3 段故障注入时间线 + 14 节点 events 表 + LiveMonitor URL（按 `LIVE_MONITOR_URL_TEMPLATE`）

**验证命令**:
```bash
ACCEPTANCE_TASK_ID=$(cat sprints/harness-acceptance-v3/.acceptance-task-id | tr -d ' \n')
REPORT=docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md   # = REPORT_PATH

# 1) health endpoint live 且 last_attempt_at 新鲜（HEALTH_FRESHNESS_S=5400 秒）
HEALTH=$(curl -fsS http://localhost:5221/api/brain/harness/health)   # = BRAIN_API_BASE
LAV=$(echo "$HEALTH" | jq -r '.langgraph_version // empty')
LAT=$(echo "$HEALTH" | jq -r '.last_attempt_at // empty')
[ -n "$LAV" ] && [ -n "$LAT" ] || { echo "FAIL: health body missing langgraph_version/last_attempt_at: $HEALTH"; exit 1; }
LAT_EPOCH=$(date -d "$LAT" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
[ $((NOW_EPOCH - LAT_EPOCH)) -lt 5400 ] \
  || { echo "FAIL: last_attempt_at stale ($LAT, gap > HEALTH_FRESHNESS_S=5400)"; exit 1; }

# 2) 子 dev task PR merged（GitHub API 真查，防伪造）
PR_URL=$(psql "$DB" -t -c "
  SELECT (result->>'pr_url')
    FROM tasks
   WHERE parent_task_id = '$ACCEPTANCE_TASK_ID'
     AND status = 'completed'                       -- tasks.status 枚举
     AND (result->>'pr_url') IS NOT NULL
     AND (result->>'pr_url') <> ''
   ORDER BY updated_at DESC LIMIT 1" | tr -d ' ')
[ -n "$PR_URL" ] || { echo "FAIL: no merged child task with pr_url"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+')
MERGED=$(gh api "repos/{owner}/{repo}/pulls/$PR_NUM" --jq '.merged' 2>/dev/null)
[ "$MERGED" = "true" ] || { echo "FAIL: PR #$PR_NUM not merged on GitHub (got: $MERGED)"; exit 1; }

# 3) KR 进度增量 ≥ KR_DELTA_MIN_PCT=1（新 history 行，window 约束防伪造）
PROG_DELTA=$(psql "$DB" -t -c "
  WITH recent AS (
    SELECT progress_pct
      FROM kr_progress_history
     WHERE kr_key LIKE '%harness%' OR kr_key LIKE '%langgraph%'
     ORDER BY recorded_at DESC LIMIT 2
  )
  SELECT MAX(progress_pct) - MIN(progress_pct) FROM recent" | tr -d ' ')
awk -v d="$PROG_DELTA" 'BEGIN{exit !(d+0 >= 1)}' \
  || { echo "FAIL: KR progress delta=$PROG_DELTA (expected >= KR_DELTA_MIN_PCT=1)"; exit 1; }

# 4) 报告文件存在 + 必含章节
test -f "$REPORT" || { echo "FAIL: report missing: $REPORT"; exit 1; }
for SEC in "## 故障注入 A" "## 故障注入 B" "## 故障注入 C" "## 14 节点事件表" "LiveMonitor"; do
  grep -qF "$SEC" "$REPORT" || { echo "FAIL: report missing section: $SEC"; exit 1; }
done

# 5) 报告含 3 段时间线（注入时刻/反应时刻/自愈终态），用 grep 计数
TIMELINE_COUNT=$(grep -cE '^- \*\*(注入时刻|反应时刻|自愈终态)\*\*' "$REPORT" || true)
[ "$TIMELINE_COUNT" -ge 9 ] || { echo "FAIL: timeline lines=$TIMELINE_COUNT (expected >=9 = 3*3)"; exit 1; }

# 6) LiveMonitor URL 含规定 task_id 模板（LIVE_MONITOR_URL_TEMPLATE）
grep -qE "localhost:5174/monitor\?task_id=[0-9a-f-]{8,}" "$REPORT" \
  || { echo "FAIL: LiveMonitor URL pattern not found"; exit 1; }
```

**硬阈值**:
- health endpoint 200 + body 含 `langgraph_version`、`last_attempt_at`（gap ≤ `HEALTH_FRESHNESS_S=5400s`）
- 子 dev task PR 在 GitHub API `merged=true`（不是只看 DB）
- KR 进度增量 ≥ `KR_DELTA_MIN_PCT=1`
- 报告含 3 段故障时间线、14 节点表、LiveMonitor URL（`LIVE_MONITOR_URL_TEMPLATE` 模式）

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

# ---- 常量声明（与合同顶部常量表一致）----
: "${DB:=postgresql://localhost/cecelia}"
SPRINT_DIR=sprints/w8-langgraph-v3            # = SPRINT_DIR
ACCEPT_DIR=sprints/harness-acceptance-v3       # = ACCEPT_DIR
INITIATIVE_ID='harness-acceptance-v3-2026-05-07'   # = INITIATIVE_ID
REPORT=docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md  # = REPORT_PATH

# ---- 顺序触发 6 个工作流脚本（每个内部含验证，失败即 exit 非 0）----
bash $ACCEPT_DIR/scripts/01-preflight-and-dispatch.sh
bash $ACCEPT_DIR/scripts/02-verify-14-nodes.sh
bash $ACCEPT_DIR/scripts/03-inject-docker-sigkill.sh
bash $ACCEPT_DIR/scripts/04-inject-max-fix-rounds.sh
bash $ACCEPT_DIR/scripts/05-inject-deadline-overdue.sh
bash $ACCEPT_DIR/scripts/06-final-report.sh

ACCEPTANCE_TASK_ID=$(cat $ACCEPT_DIR/.acceptance-task-id | tr -d ' \n')

# ---- 终验证：6 个 Step 的 Step-N 验证命令依次重跑（窗口扩展为 EVENTS_FRESH_WIN_120M）----

# Step 1
[ "$(docker exec brain git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || exit 1
curl -fsS http://localhost:5221/api/brain/status | jq -e '(.brake_state // .state) != "emergency_brake"' >/dev/null

# Step 2 — 引用 GRAPH_NODES 字面量、EVENTS_FRESH_WIN_120M=120 minutes
DISTINCT=$(psql "$DB" -t -c "
  SELECT count(DISTINCT (payload->>'node_name'))
    FROM task_events
   WHERE task_id='$ACCEPTANCE_TASK_ID'
     AND event_type='graph_node_update'
     AND (payload->>'node_name') IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')  -- GRAPH_NODES
     AND created_at > NOW() - INTERVAL '120 minutes'   -- EVENTS_FRESH_WIN_120M
  " | tr -d ' ')
[ "$DISTINCT" = "14" ] || exit 1

# Step 3 — failure_injection.injection='docker_sigkill' / final_status='PASS'
psql "$DB" -t -c "SELECT 1 FROM task_events
  WHERE task_id='$ACCEPTANCE_TASK_ID' AND event_type='failure_injection'
    AND (payload->>'injection')='docker_sigkill'
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1
psql "$DB" -t -c "SELECT 1 FROM task_events
  WHERE task_id='$ACCEPTANCE_TASK_ID' AND event_type='sub_task_finalized'
    AND (payload->>'final_status')='PASS'
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1

# Step 4 — harness_interrupts.status ∈ {resolved, resumed} / action='abort'
psql "$DB" -t -c "SELECT 1 FROM harness_interrupts
  WHERE task_id='$ACCEPTANCE_TASK_ID'
    AND status IN ('resolved','resumed')             -- harness_interrupts.status 枚举
    AND action='abort'                                -- harness_interrupts.action 枚举
    AND resolved_at IS NOT NULL
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1
# initiative_runs.failure_reason='abort_after_max_fix_rounds' 严格枚举值
psql "$DB" -t -c "SELECT 1 FROM initiative_runs
  WHERE initiative_id='$INITIATIVE_ID'
    AND failure_reason='abort_after_max_fix_rounds'  -- initiative_runs.failure_reason 枚举
    AND created_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1

# Step 5 — initiative_runs.phase='failed' / failure_reason='watchdog_overdue'
psql "$DB" -t -c "SELECT 1 FROM initiative_runs
  WHERE initiative_id='$INITIATIVE_ID'
    AND phase='failed'                                -- initiative_runs.phase 枚举
    AND failure_reason='watchdog_overdue'             -- initiative_runs.failure_reason 枚举
    AND updated_at > NOW() - INTERVAL '120 minutes' LIMIT 1" | grep -q '^\s*1\s*$' || exit 1
NUM_THREADS=$(psql "$DB" -t -c "SELECT count(DISTINCT thread_id) FROM initiative_runs
  WHERE initiative_id='$INITIATIVE_ID'
    AND created_at > NOW() - INTERVAL '120 minutes'" | tr -d ' ')
[ "$NUM_THREADS" -ge 2 ] || exit 1

# Step 6 — health endpoint + report 文件 + LIVE_MONITOR_URL_TEMPLATE 校验
curl -fsS http://localhost:5221/api/brain/harness/health | jq -e '.langgraph_version != null and .last_attempt_at != null' >/dev/null
test -f "$REPORT"
grep -qF "## 14 节点事件表" "$REPORT"
grep -qE "localhost:5174/monitor\?task_id=[0-9a-f-]{8,}" "$REPORT"   # LIVE_MONITOR_URL_TEMPLATE

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
- DB 校验 `INITIATIVE_ID` 在 `PREFLIGHT_FRESH_WIN_15M` 内首次出现
- `POST /api/brain/tasks` 注册 acceptance task（含 `priority='P1'`、`payload.timeout_sec=TASK_TIMEOUT_SEC=2400`，自然 ≥ `TASK_TIMEOUT_MIN_SEC=1800`、`payload.thin_feature.endpoint='GET /api/brain/harness/health'`、`payload.thin_feature.fields=['langgraph_version','last_attempt_at']`、`payload.e2e_test_path='tests/e2e/harness-acceptance-smoke.spec.ts'`）
- `POST /api/brain/harness/dispatch`（或 Brain 当前实际 dispatch endpoint；脚本先 `GET /api/brain/openapi.json` 探测可用路径，落空则失败 fast）
- 写出 `sprints/harness-acceptance-v3/.acceptance-task-id` 文件

**大小**: M（约 150 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws1/preflight-and-dispatch.test.ts`

---

### Workstream 2: 14 节点 graph_node_update 事件轮询与报告

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/02-verify-14-nodes.sh` + `sprints/harness-acceptance-v3/lib/14-nodes-report.mjs`，包含：
- 读 `.acceptance-task-id`，每 10s 轮询 `task_events` 表，最多 60 分钟（`TASK_TIMEOUT_SEC=2400` 与主任务对齐 + buffer）
- 命中 14 distinct `node_name`（取自 `GRAPH_NODES` 字面量）时退出，否则超时 exit 1
- 输出 `sprints/harness-acceptance-v3/reports/14-nodes-report.json`（schema：`{nodes: {prep: {count: N, first_at, last_at}, ...}, total_events, sampled_at}`）

**大小**: M（约 130 行：脚本 30 + 报告生成器 100）
**依赖**: Workstream 1（需读 `.acceptance-task-id`）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws2/verify-14-nodes.test.ts`

---

### Workstream 3: 故障注入 A — `docker_sigkill` 自愈

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh`，包含：
- 探测当前 acceptance run 关联的运行中 docker container（通过 `docker ps --filter "label=cecelia.task_id=<acceptance_task_id>"` 或子任务 container 命名约定）
- 选 1 个进行 `docker kill --signal=KILL`
- 写一条 `task_events` 记录 `event_type='failure_injection'`、`payload.injection='docker_sigkill'`（取自 `failure_injection.injection` 枚举）、`payload.container_id=<id>`
- 轮询 ≤ `HEAL_BUDGET_S=600s`（场景预算），期望出现 `event_type='llm_retry'` 事件 + 子任务 `final_status='PASS'`
- 命中即 exit 0；超时 exit 1；`retry_count > MAX_LLM_RETRY=3` 视为失败

**大小**: M（约 150 行）
**依赖**: Workstream 2（在 14 节点全部到位之前不应注入，避免事件混淆）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws3/inject-docker-sigkill.test.ts`

---

### Workstream 4: 故障注入 B — `max_fix_rounds_evaluator_fail` → interrupt → resume(abort)

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh` + `sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs`，包含：
- 通过 Brain 提供的 evaluator override hook（`POST /api/brain/harness/evaluator-override` body `{task_id, mode:'always_fail', reason:'acceptance_v3_inject_B'}`；若 endpoint 不存在则用 DB 直写 `harness_evaluator_overrides` 表，需在脚本头部 fallback 切换）
- 写 `task_events` 注入事件，`payload.injection='max_fix_rounds_evaluator_fail'`（取自 `failure_injection.injection` 枚举）
- 轮询 `harness_interrupts` 直到出现 `status='pending'` 行（取自 `harness_interrupts.status` 枚举）（≤10 分钟）
- `POST /api/brain/harness-interrupts/:id/resume {action:"abort"}`（取自 `harness_interrupts.action` 枚举）
- 验证 acceptance task 进入 `tasks.status='failed'` + `initiative_runs.failure_reason='abort_after_max_fix_rounds'`
- 清理 evaluator override

**大小**: L（约 220 行）
**依赖**: Workstream 3

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws4/inject-max-fix-rounds.test.ts`

---

### Workstream 5: 故障注入 C — `deadline_overdue` → watchdog → fresh thread

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/05-inject-deadline-overdue.sh`，包含：
- 读当前 attempt N（`SELECT MAX(attempt) FROM initiative_runs WHERE initiative_id=INITIATIVE_ID`）
- `UPDATE initiative_runs SET deadline_at = NOW() - INTERVAL '1 minute' WHERE initiative_id=INITIATIVE_ID AND attempt=N`（必须用事务 + WHERE 限定，禁止 unbounded UPDATE；常量 `DEADLINE_NUDGE_INTERVAL='1 minute'`）
- 写 `task_events` 注入事件，`payload.injection='deadline_overdue'`（枚举值）、`payload.attempt=N`
- 轮询 ≤ `WATCHDOG_BUDGET_S=300` + buffer（脚本内置 `360s` 上限），等待 `phase='failed'`、`failure_reason='watchdog_overdue'`（均取自 `initiative_runs` 枚举）
- 重派 dispatch 同 `INITIATIVE_ID`
- 验证 `attempt=N+1` 行 + thread_id 不同
- 结束时还原 deadline_at（`UPDATE initiative_runs SET deadline_at = NULL WHERE attempt=N`，避免后续脚本读到污染状态）

**大小**: M（约 180 行）
**依赖**: Workstream 4（场景 C 必须在 B 之后跑，因为 B 已让原 task `failed`，C 利用 fresh attempt）

> **注**：场景 B 已经把 acceptance task 推到 failed 终态，因此 C 注入的 attempt 应来自重派后的 fresh 行；如果 Brain 当前实现是"手动重派"才会产 attempt=N+1，则脚本 05 内部先做一次重派建出 attempt=2，再注入。

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws5/inject-deadline-overdue.test.ts`

---

### Workstream 6: 最终验证 + 报告生成 + KR 回写

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/06-final-report.sh` + `sprints/harness-acceptance-v3/lib/render-report.mjs`，包含：
- 校验 `/api/brain/harness/health` 200 + 字段 + 新鲜度 ≤ `HEALTH_FRESHNESS_S=5400s`
- 校验子 dev task PR `merged=true`（`gh api repos/<owner>/<repo>/pulls/<num>`）
- 计算 KR 进度增量（前后两次 `/api/brain/okr/current` 拉取 + 写 `kr_progress_history` 增量行）
- 调用 `PATCH /api/brain/okr/kr/:kr_id` 回写 ≥ `KR_DELTA_MIN_PCT=1` 进度（如已 ≥ 则 no-op，幂等）
- 渲染 `REPORT_PATH=docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v3.md`，章节固定：
  - `## Pre-flight 与派发`
  - `## 14 节点事件表`（从 `reports/14-nodes-report.json` 读 + 渲染 markdown 表，按 `GRAPH_NODES` 顺序）
  - `## 故障注入 A` / `## 故障注入 B` / `## 故障注入 C`，每段含 `- **注入时刻**:` / `- **反应时刻**:` / `- **自愈终态**:` 三行
  - `## 最终验证`（含 LiveMonitor URL：按 `LIVE_MONITOR_URL_TEMPLATE=http://localhost:5174/monitor?task_id=<acceptance_task_id>`）

**大小**: L（约 250 行：脚本 80 + render-report.mjs 170）
**依赖**: Workstream 5

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v3/tests/ws6/final-report.test.ts`

---

## Test Contract

> **test_is_red 加固说明**：本表为每个 `it` 块附「断言形式」一例，CI 在 commit-1 后可直接 grep 测试文件验证锁定。总计 BEHAVIOR `it` 块: **27**（WS1=4 / WS2=3 / WS3=4 / WS4=5 / WS5=6 / WS6=5）。Red 阶段全部 FAIL（lib 模块均不存在）。

| Workstream | Test File | BEHAVIOR `it` 覆盖 + 断言形式 | 预期红证据 |
|---|---|---|---|
| **WS1** (4) | `tests/ws1/preflight-and-dispatch.test.ts` | (1) `it('verifyDeployHead() 在 Brain HEAD ≠ origin/main 时抛错', expect(verifyDeployHead({brainHead, mainHead})).rejects.toThrow(/HEAD mismatch\|stale Brain\|brain.*main/i))`<br>(2) `it('verifyDeployHead() 相等时返回 HEAD 字符串', expect(await verifyDeployHead({brainHead:H, mainHead:H})).toBe(H))`<br>(3) `it('assertNotEmergencyBrake() 当 status=emergency_brake 抛错', expect(assertNotEmergencyBrake({brake_state:"emergency_brake"})).rejects.toThrow(/emergency_brake/i))`<br>(4) `it('registerAndDispatchAcceptance() payload 含 timeout_sec>=TASK_TIMEOUT_MIN_SEC(1800) 与 INITIATIVE_ID', expect(body.payload.timeout_sec).toBeGreaterThanOrEqual(1800) && expect(body.payload.initiative_id).toBe("harness-acceptance-v3-2026-05-07"))` | `lib/preflight.mjs` 不存在 → import 抛错 → 4 个 `it` 全 FAIL |
| **WS2** (3) | `tests/ws2/verify-14-nodes.test.ts` | (1) `it('renderNodeReport() 14 节点齐全 → nodes 字段恰好 14 个 key', expect(Object.keys(report.nodes)).toHaveLength(14))`<br>(2) `it('renderNodeReport() 缺失节点 → 对应 key 标 count: 0', expect(report.nodes[name].count).toBe(0))`<br>(3) `it('pollAndReport() 超过 deadline 返回 timeout error', expect(result.ok).toBe(false) && expect(result.reason).toMatch(/timeout/i))` | `lib/14-nodes-report.mjs` 不存在 → 3 个 `it` 全 FAIL |
| **WS3** (4) | `tests/ws3/inject-docker-sigkill.test.ts` | (1) `it('pickKillTarget() 输入空数组时抛错', expect(()=>pickKillTarget([])).toThrow(/no.*container\|empty\|no target/i))`<br>(2) `it('pickKillTarget() 拒绝基础设施容器（白名单 only）', expect(target.id).toBe("c3"))`<br>(3) `it('recordInjectionEvent() 写入 payload schema 严格匹配', expect(JSON.stringify(last.params)).toContain("docker_sigkill"))`<br>(4) `it('pollHealing() retry_count > MAX_LLM_RETRY(3) → reason="retry_exhausted"', expect(r.reason).toBe("retry_exhausted"))` | `lib/inject-docker-sigkill.mjs` 不存在 → 4 个 `it` 全 FAIL |
| **WS4** (5) | `tests/ws4/inject-max-fix-rounds.test.ts` | (1) `it('applyOverride() API 200 时不触 DB fallback', expect(fakePsql).not.toHaveBeenCalled())`<br>(2) `it('applyOverride() API 404 时回落 DB 直写 harness_evaluator_overrides', expect(dbSqls.some(s=>/INSERT\\s+INTO\\s+harness_evaluator_overrides/i.test(s))).toBe(true))`<br>(3) `it('removeOverride() 幂等', expect(removeOverride(...)).resolves.toBeDefined())`<br>(4) `it('resumeWithAbort() body 严格 {action:"abort"}', expect(captured.body).toEqual({action:"abort"}))`<br>(5) `it('pollInterrupt() 超过 deadline 返回 timeout', expect(r.reason).toBe("timeout"))` | `lib/evaluator-fail-injector.mjs` 不存在 → 5 个 `it` 全 FAIL |
| **WS5** (6) | `tests/ws5/inject-deadline-overdue.test.ts` | (1) `it('nudgeDeadline() 拒绝 attempt 缺失', expect(nudgeDeadline({initiativeId:...})).rejects.toThrow(/attempt/i))`<br>(2) `it('nudgeDeadline() 拒绝 wildcard "%"', expect(nudgeDeadline({initiativeId:"%",attempt:1})).rejects.toThrow(/wildcard\|invalid/i))`<br>(3) `it('restoreDeadline() 即使 SQL 抛错也不向上传播', expect(restoreDeadline({...,psql:throwingPsql})).resolves.toBeDefined())`<br>(4) `it('pollWatchdog() 命中 phase=failed/failure_reason=watchdog_overdue → ok=true', expect(r.ok).toBe(true))`<br>(5) `it('redispatchAndAssertFreshThread() attempt=prev+1 且 thread_id 不同时 OK', expect(redispatch).resolves.toBeDefined())`<br>(6) `it('redispatchAndAssertFreshThread() thread_id 相同时 throw', expect(redispatch).rejects.toThrow(/thread.*same\|fresh.*thread/i))` | `lib/inject-deadline-overdue.mjs` 不存在 → 6 个 `it` 全 FAIL |
| **WS6** (5) | `tests/ws6/final-report.test.ts` | (1) `it('renderReport() 输出含 6 段章节、≥9 timeline 行、LIVE_MONITOR_URL_TEMPLATE', expect(md).toContain("## 故障注入 A") && expect(tlMatches.length).toBeGreaterThanOrEqual(9) && expect(md).toMatch(/localhost:5174\\/monitor\\?task_id=t-acc-1/))`<br>(2) `it('verifyHealthEndpoint() 缺 langgraph_version 抛错', expect(verifyHealthEndpoint).rejects.toThrow(/langgraph_version/i))`<br>(3) `it('verifyHealthEndpoint() last_attempt_at 早于 HEALTH_FRESHNESS_S(5400s) 抛错', expect(verifyHealthEndpoint).rejects.toThrow(/stale\|too old\|last_attempt_at/i))`<br>(4) `it('verifyChildPrMerged() merged=false 时抛错', expect(verifyChildPrMerged).rejects.toThrow(/not merged\|merged=false/i))`<br>(5) `it('bumpKrProgress() 已 ≥ KR_DELTA_MIN_PCT 时 no-op，否则 PATCH', expect(r1.patched).toBe(false) && expect(r2.patched).toBe(true))` | `lib/render-report.mjs` 不存在 → 5 个 `it` 全 FAIL |

**断言锁定校验（CI grep 友好）**：commit-1 之后 CI 可对每个 `tests/ws*/` 文件 grep `it\\('|it\\("` 计数应为 27；任一 `it` 块的核心断言被擅自修改将触发"测试漂移"告警。

---

## Generator 实现纪律

- **CONTRACT IS LAW**: 合同里有的全实现，合同外一字不加。
- **常量纪律**: 实现脚本/库时所有数值/枚举字面量必须以本合同顶部「常量表」与「枚举表」中的常量名引用（注释里标注其值），禁止裸写魔术数字；如发现合同未涵盖的新常量需求，发回 Reviewer 补充而非自行 inline。
- **TDD 两次 commit**:
  1. commit-1: 仅复制本目录 `tests/ws{N}/*.test.ts`（一字不改）+ 空 `lib/*.mjs`（导出 stub 抛 `Error('not implemented')`）→ Red 证据。
  2. commit-2: 实现 `lib/*.mjs` 与 `scripts/*.sh` → Green。
- **CI 强校验**: commit-1 后测试文件再被改动 → CI exit 1。
- **不修 packages/brain / packages/engine / apps/dashboard 任何代码**（PRD 范围限定）；如确实发现 Brain bug，单独开 task 而非夹带。
