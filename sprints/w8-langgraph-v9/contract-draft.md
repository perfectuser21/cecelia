# Sprint Contract Draft (Round 1) — W8 v9 LangGraph 修正全套 final acceptance

> 本 sprint 是 **验收性**，不修改 packages/brain / entrypoint.sh / graph 任何代码。
> 目标：用现有 main 分支 Brain（含 4 个 hotfix）真派一次 walking_skeleton harness_initiative，证明 spawn-callback-resume 闭环全程无人干预跑通，并落 evidence + 报告。

---

## Golden Path

```
[主理人 POST /api/brain/tasks (harness_initiative + walking_skeleton payload)]
        │
        ▼
[Brain dispatcher tick → runHarnessInitiativeRouter → LangGraph harness-initiative full graph 启动]
        │
        ▼
[A 阶段 Planning 6 节点: prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert]
        │ (task_events 写 6 条 graph_node_update; tasks 表写 ≥1 sub_task)
        ▼
[B 阶段 sub_task fanout: pick_sub_task → run_sub_task (spawn-and-interrupt) → interrupt() yield]
        │ (容器 harness-task-ws<N>-r0-<short> 跑 claude CLI → exit=0 → entrypoint.sh POST callback)
        ▼
[callback router 查 thread_lookup → Command(resume) 唤回 graph → evaluate / advance]
        │ (sub_task 行 status=completed verdict=DONE pr_url 入库; PR merge 到 main)
        ▼
[C 阶段 Final E2E: final_evaluate (跑 e2e_acceptance) → report]
        │
        ▼
[出口: tasks.status=completed + custom_props.final_e2e_verdict=PASS + initiative_runs.phase=completed_success]
        │
        ▼
[evidence: acceptance-evidence.md + 最终报告 docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md + learnings]
```

---

### Step 1: 派发 walking_skeleton harness_initiative 任务

**可观测行为**：主理人 POST `localhost:5221/api/brain/tasks` 后，Brain 返回新建任务的 task_id；下一个 dispatcher tick 内（≤ 60s），该任务的 status 从 `queued` 转为 `in_progress`，并在 `task_events` 写入 `graph_node_update` 类型事件，证明 LangGraph harness-initiative 全图已被路由启动。

**前置产物**：`sprints/w8-langgraph-v9/acceptance-task-payload.json` 存在，且 JSON 解析后含字段：`task_type=harness_initiative`、`payload.walking_skeleton.thin_feature`（非空字符串）、`payload.walking_skeleton.e2e_acceptance.command`（非空字符串）、`payload.walking_skeleton.e2e_acceptance.timeout_sec`（数字 ≤ 600）。

**验证命令**：

```bash
# 0. payload 文件存在并语法合法
test -f sprints/w8-langgraph-v9/acceptance-task-payload.json
jq -e '.task_type == "harness_initiative"
       and (.payload.walking_skeleton.thin_feature | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.command | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.timeout_sec | type == "number" and . <= 600)' \
   sprints/w8-langgraph-v9/acceptance-task-payload.json

# 1. POST 派任务 → 提取 task_id 写到 .acceptance-task-id（供后续 step 引用）
TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  --data-binary @sprints/w8-langgraph-v9/acceptance-task-payload.json | jq -r '.id // .task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]
echo "$TASK_ID" > /tmp/w8v9-task-id

# 2. 60s 内 status 转 in_progress（dispatcher tick 拉到）
DEADLINE=$(($(date +%s)+90))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(curl -fsS "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r '.status')
  [ "$STATUS" = "in_progress" ] && break
  sleep 5
done
[ "$STATUS" = "in_progress" ]

# 3. 90s 内 task_events 出现至少 1 条 graph_node_update（证明 graph 启动）
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM task_events
  WHERE task_id = '$TASK_ID'
    AND event_type = 'graph_node_update'
    AND created_at > NOW() - interval '5 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'
```

**硬阈值**：
- payload 文件存在且 4 项必填 schema 字段全通过
- POST 响应含 task_id（非空、非 `"null"`）
- ≤ 90s 内 status 转 in_progress
- ≤ 5min 时间窗口内 task_events 至少 1 条 `graph_node_update`

---

### Step 2: A 阶段 Planning 6 节点收敛 + sub_task 入库

**可观测行为**：本 task 经过 LangGraph harness-initiative 的 Planning 主干 6 节点（`prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert`）；`task_events` 累计至少 6 条不同 `node` 维度的 `graph_node_update` 事件；`tasks` 表 `parent_task_id = $TASK_ID` 的 sub_task 行至少 1 条，且其 `payload` 含 `contract_dod_path` 字段。

**验证命令**：

```bash
TASK_ID=$(cat /tmp/w8v9-task-id)

# 1. 30 分钟内出现 6 个节点的 graph_node_update（容忍 GAN 多轮 → 节点重复，按 distinct node）
DEADLINE=$(($(date +%s)+1800))
while [ $(date +%s) -lt $DEADLINE ]; do
  COUNT=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "
    SELECT count(DISTINCT (data->>'node'))
    FROM task_events
    WHERE task_id = '$TASK_ID'
      AND event_type = 'graph_node_update'
      AND data->>'node' IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert')
      AND created_at > NOW() - interval '60 minutes'
  " | tr -d ' ')
  [ "$COUNT" -ge 6 ] && break
  sleep 30
done
[ "$COUNT" -ge 6 ]

# 2. dbUpsert 完成后至少 1 个 sub_task 入库，且 payload.contract_dod_path 非空
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id = '$TASK_ID'
    AND payload ? 'contract_dod_path'
    AND (payload->>'contract_dod_path') <> ''
    AND created_at > NOW() - interval '60 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'
```

**硬阈值**：
- ≤ 30min 内 distinct node 计数达到 6（覆盖 prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert）
- 60min 时间窗内 sub_task 行 ≥ 1，且 payload.contract_dod_path 字符串非空

---

### Step 3: B 阶段 sub_task spawn-callback-resume 闭环

**可观测行为**：`pick_sub_task` 选首个 sub_task 后，`run_sub_task` 节点用 spawn-and-interrupt 模式：docker run 起 `harness-task-ws*-r*-<short>` 容器并立即 return，下一节点 `interrupt()` 让 graph yield，state 持久化到 PG checkpointer；容器内 claude CLI 输出 `{"verdict":"DONE","pr_url":"..."}` exit=0；entrypoint.sh 用注入的 `HARNESS_CALLBACK_URL` POST 到 `/api/brain/sub-task-callback`；callback router 查 `walking_skeleton_thread_lookup` / `harness_thread_lookup` 命中 thread_id；`Command(resume)` 唤回 graph，跑完 `evaluate / advance`，sub_task 行 status=completed verdict=DONE 且 pr_url 非空，PR 真合并到 main。

**验证命令**：

```bash
TASK_ID=$(cat /tmp/w8v9-task-id)

# 1. 至少 1 条 interrupt_pending + 至少 1 条 interrupt_resumed（证明 spawn-and-interrupt 闭环跑通）
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT
    SUM(CASE WHEN event_type = 'interrupt_pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN event_type = 'interrupt_resumed' THEN 1 ELSE 0 END) AS resumed
  FROM task_events
  WHERE (task_id = '$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id = '$TASK_ID'))
    AND created_at > NOW() - interval '120 minutes'
" -A -F'|' | head -1 | awk -F'|' '$1+0 >= 1 && $2+0 >= 1 { exit 0 } { exit 1 }'

# 2. thread_lookup 表命中（证明 callback router 不是凭 hex HOSTNAME 撞运气）
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM walking_skeleton_thread_lookup
  WHERE thread_id LIKE 'harness-initiative:%'
    AND created_at > NOW() - interval '120 minutes'
  UNION ALL
  SELECT count(*) FROM harness_thread_lookup
  WHERE thread_id LIKE 'harness-initiative:%'
    AND created_at > NOW() - interval '120 minutes'
" | awk '{s+=$1} END { if(s+0>=1) exit 0; else exit 1 }'

# 3. 至少 1 个 sub_task verdict=DONE 且 pr_url 非空
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id = '$TASK_ID'
    AND status = 'completed'
    AND COALESCE(result->>'verdict', custom_props->>'verdict') = 'DONE'
    AND COALESCE(result->>'pr_url', custom_props->>'pr_url') ~ '^https://github\\.com/.+/pull/[0-9]+$'
    AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'

# 4. 该 PR 真合并到 main（不是 closed/draft；CI green 隐含在 merge 成功里）
PR_URL=$(psql "${DB:-postgresql://localhost/cecelia}" -t -A -c "
  SELECT COALESCE(result->>'pr_url', custom_props->>'pr_url') FROM tasks
  WHERE parent_task_id = '$TASK_ID'
    AND status = 'completed'
    AND COALESCE(result->>'verdict', custom_props->>'verdict') = 'DONE'
  LIMIT 1
" | tr -d ' ')
[ -n "$PR_URL" ]
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
gh pr view "$PR_NUM" --json state,mergedAt,baseRefName \
  | jq -e '.state == "MERGED" and .mergedAt != null and .baseRefName == "main"'

# 5. Brain log 在 task 时间窗口内不含致命模式（spot-check fail-fast 信号）
journalctl -u brain --since "2 hours ago" 2>/dev/null \
  | grep -E "await_callback timeout|lookup miss 404|OOM_killed.*reject.*no handler" \
  | wc -l | awk '$1+0 == 0 { exit 0 } { exit 1 }' || \
  echo "WARN: journalctl 不可用，需 evidence 文档手动贴 brain.log 截"
```

**硬阈值**：
- ≤ 120min 时间窗内 interrupt_pending ≥ 1 且 interrupt_resumed ≥ 1
- thread_lookup 表（任一）命中 ≥ 1
- sub_task verdict=DONE + pr_url 匹配 GitHub PR URL 正则
- gh pr view 显示 state=MERGED + baseRefName=main + mergedAt 非空
- Brain log 三个致命模式 0 命中（journalctl 不可用时 evidence 手动证）

---

### Step 4: C 阶段 Final E2E + report 节点 + acceptance evidence 落盘

**可观测行为**：所有 sub_task 完成后，`final_evaluate` 节点跑 walking_skeleton 的 e2e_acceptance（一条 curl/test 命令），verdict=PASS 写入 task `custom_props.final_e2e_verdict`；`report` 节点写 `tasks.result` 和 `initiative_runs.completed_at`；`tasks` 表本任务 status=completed；`initiative_runs` 表 phase=completed_success。`sprints/w8-langgraph-v9/acceptance-evidence.md` 落盘，含本 sprint 实际跑出的 task_id、sub_task task_id 列表、sub_task PR URL、SQL 截图、关键 brain log 行号。

**验证命令**：

```bash
TASK_ID=$(cat /tmp/w8v9-task-id)

# 1. tasks 表本任务 status=completed + final_e2e_verdict=PASS（180min 内）
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM tasks
  WHERE id = '$TASK_ID'
    AND status = 'completed'
    AND custom_props->>'final_e2e_verdict' = 'PASS'
    AND updated_at > NOW() - interval '180 minutes'
" | tr -d ' ' | awk '$1+0 == 1 { exit 0 } { exit 1 }'

# 2. initiative_runs phase=completed_success + completed_at 非空
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM initiative_runs
  WHERE task_id = '$TASK_ID'
    AND phase = 'completed_success'
    AND completed_at IS NOT NULL
    AND completed_at > NOW() - interval '180 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'

# 3. evidence 文档落盘 + 含真实 task_id 引用（防造假）
test -f sprints/w8-langgraph-v9/acceptance-evidence.md
grep -q "$TASK_ID" sprints/w8-langgraph-v9/acceptance-evidence.md
# evidence 必须含 PR URL 且非占位
grep -E "https://github\.com/.+/pull/[0-9]+" sprints/w8-langgraph-v9/acceptance-evidence.md > /dev/null
# evidence 必须显式声明 4 个 hotfix（PR #2845/2846/2847/2850）已生效，且不含 "TBD/TODO/PLACEHOLDER" 字样
grep -E "#2845|#2846|#2847|#2850" sprints/w8-langgraph-v9/acceptance-evidence.md > /dev/null
! grep -E "TBD|TODO|PLACEHOLDER|XXXX|<填写>" sprints/w8-langgraph-v9/acceptance-evidence.md
```

**硬阈值**：
- tasks 行 status=completed AND final_e2e_verdict=PASS（180min 时间窗）
- initiative_runs phase=completed_success AND completed_at 非空
- evidence 文档存在 + 含真实 task_id + 含真实 PR URL + 含 4 个 hotfix PR 编号 + 不含占位符

---

### Step 5: 最终 acceptance 报告 + learnings 落盘

**可观测行为**：`docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md` 落盘，含：本次 task_id / 14→7 节点 graph_node_update 截 SQL / sub_task PR 链接 / KR 进度变化（设计完成态→可观测验证态）/ failure_reason 全空证据。`docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md` 落盘，含至少 1 条**非平凡** learning（即不是"跑通了"这种废话）。

**验证命令**：

```bash
# 1. 报告文档存在并含必填段落
REPORT=docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md
test -f "$REPORT"
grep -q "task_id" "$REPORT"
grep -E "graph_node_update" "$REPORT" > /dev/null
grep -E "https://github\.com/.+/pull/[0-9]+" "$REPORT" > /dev/null
grep -E "KR|key_result|管家闭环" "$REPORT" > /dev/null
# 报告必须显式断言 failure_reason 全空（否则验收不通过）
grep -E "failure_reason.*(NULL|空|none|null)" "$REPORT" > /dev/null

# 2. learnings 文档存在且不少于 60 字（防一句话敷衍）
LEARN=docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md
test -f "$LEARN"
[ "$(wc -c < "$LEARN")" -ge 60 ]
# learnings 不能只复述 PRD 已知信息：必须含至少一个 PRD 文本里没有的具体细节（节点名/容器名/特定行为/数字）
! diff <(sort -u "$LEARN") <(sort -u sprints/w8-langgraph-v9/sprint-prd.md) | grep -q "^>"  # 不能完全是 PRD 子集
```

**硬阈值**：
- 报告文件存在 + 5 段必填内容（task_id / graph_node_update / PR URL / KR 字段 / failure_reason 全空断言）
- learnings 文件存在 + ≥ 60 字节 + 含 PRD 之外的细节

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v9"

# ==== Step 1: 派发 ====
test -f "$SPRINT_DIR/acceptance-task-payload.json"
jq -e '.task_type == "harness_initiative"
       and (.payload.walking_skeleton.thin_feature | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.command | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.timeout_sec | type == "number" and . <= 600)' \
   "$SPRINT_DIR/acceptance-task-payload.json"

TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  --data-binary @"$SPRINT_DIR/acceptance-task-payload.json" | jq -r '.id // .task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]
echo "[Step1] dispatched task_id=$TASK_ID"

# ==== Step 1 收尾: status 转 in_progress + 至少 1 graph_node_update（90s 内）====
DEADLINE=$(($(date +%s)+90))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(curl -fsS "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r '.status')
  [ "$STATUS" = "in_progress" ] && break
  sleep 5
done
[ "$STATUS" = "in_progress" ]

NODE_EVENTS=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE task_id='$TASK_ID' AND event_type='graph_node_update' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$NODE_EVENTS" -ge 1 ]
echo "[Step1] status=in_progress, graph_node_update=$NODE_EVENTS"

# ==== Step 2: A 阶段 6 节点 + sub_task ====
DEADLINE=$(($(date +%s)+1800))
while [ $(date +%s) -lt $DEADLINE ]; do
  DISTINCT_NODES=$(psql "$DB" -t -c "
    SELECT count(DISTINCT (data->>'node'))
    FROM task_events
    WHERE task_id='$TASK_ID' AND event_type='graph_node_update'
      AND data->>'node' IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert')
      AND created_at > NOW() - interval '60 minutes'" | tr -d ' ')
  [ "$DISTINCT_NODES" -ge 6 ] && break
  sleep 30
done
[ "$DISTINCT_NODES" -ge 6 ]

SUBTASK_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE parent_task_id='$TASK_ID' AND payload ? 'contract_dod_path' AND (payload->>'contract_dod_path') <> '' AND created_at > NOW() - interval '60 minutes'" | tr -d ' ')
[ "$SUBTASK_COUNT" -ge 1 ]
echo "[Step2] distinct planning nodes=$DISTINCT_NODES, sub_task count=$SUBTASK_COUNT"

# ==== Step 3: B 阶段 spawn-callback-resume + PR merge ====
DEADLINE=$(($(date +%s)+7200))
while [ $(date +%s) -lt $DEADLINE ]; do
  PENDING=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE (task_id='$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='$TASK_ID')) AND event_type='interrupt_pending' AND created_at > NOW() - interval '120 minutes'" | tr -d ' ')
  RESUMED=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE (task_id='$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='$TASK_ID')) AND event_type='interrupt_resumed' AND created_at > NOW() - interval '120 minutes'" | tr -d ' ')
  [ "$PENDING" -ge 1 ] && [ "$RESUMED" -ge 1 ] && break
  sleep 60
done
[ "$PENDING" -ge 1 ] && [ "$RESUMED" -ge 1 ]

THREAD_HITS=$(psql "$DB" -t -c "SELECT (SELECT count(*) FROM walking_skeleton_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes') + (SELECT count(*) FROM harness_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes')" | tr -d ' ')
[ "$THREAD_HITS" -ge 1 ]

PR_ROW=$(psql "$DB" -t -A -c "SELECT COALESCE(result->>'pr_url', custom_props->>'pr_url') FROM tasks WHERE parent_task_id='$TASK_ID' AND status='completed' AND COALESCE(result->>'verdict', custom_props->>'verdict')='DONE' LIMIT 1" | tr -d ' ')
[ -n "$PR_ROW" ]
PR_NUM=$(echo "$PR_ROW" | grep -oE '[0-9]+$')
gh pr view "$PR_NUM" --json state,mergedAt,baseRefName \
  | jq -e '.state == "MERGED" and .mergedAt != null and .baseRefName == "main"'
echo "[Step3] interrupt_pending=$PENDING, interrupt_resumed=$RESUMED, thread_hits=$THREAD_HITS, PR=$PR_ROW MERGED"

# ==== Step 4: Final E2E + evidence ====
FINAL_PASS=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id='$TASK_ID' AND status='completed' AND custom_props->>'final_e2e_verdict'='PASS' AND updated_at > NOW() - interval '180 minutes'" | tr -d ' ')
[ "$FINAL_PASS" = "1" ]

INIT_OK=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_runs WHERE task_id='$TASK_ID' AND phase='completed_success' AND completed_at IS NOT NULL AND completed_at > NOW() - interval '180 minutes'" | tr -d ' ')
[ "$INIT_OK" -ge 1 ]

test -f "$SPRINT_DIR/acceptance-evidence.md"
grep -q "$TASK_ID" "$SPRINT_DIR/acceptance-evidence.md"
grep -E "https://github\.com/.+/pull/[0-9]+" "$SPRINT_DIR/acceptance-evidence.md" > /dev/null
grep -E "#2845|#2846|#2847|#2850" "$SPRINT_DIR/acceptance-evidence.md" > /dev/null
! grep -E "TBD|TODO|PLACEHOLDER|XXXX|<填写>" "$SPRINT_DIR/acceptance-evidence.md"
echo "[Step4] final_pass=$FINAL_PASS, initiative_runs_ok=$INIT_OK, evidence ✓"

# ==== Step 5: 最终报告 + learnings ====
REPORT=docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md
test -f "$REPORT"
grep -q "task_id" "$REPORT"
grep -E "graph_node_update" "$REPORT" > /dev/null
grep -E "https://github\.com/.+/pull/[0-9]+" "$REPORT" > /dev/null
grep -E "KR|key_result|管家闭环" "$REPORT" > /dev/null
grep -E "failure_reason.*(NULL|空|none|null)" "$REPORT" > /dev/null

LEARN=docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md
test -f "$LEARN"
[ "$(wc -c < "$LEARN")" -ge 60 ]

echo "✅ W8 v9 Golden Path 全程验证通过 — task_id=$TASK_ID PR=$PR_ROW"
```

**通过标准**：脚本 `exit 0`。

---

## Workstreams

workstream_count: 3

### Workstream 1: 派发 walking_skeleton + 验证 dispatcher 起 graph

**范围**：写 `acceptance-task-payload.json`（schema 合法的 walking_skeleton payload，含 1 个 thin_feature + 1 条 e2e_acceptance 命令），POST 到 Brain 拿 task_id，验证 90s 内 status 转 in_progress 且 task_events 至少 1 条 graph_node_update。

**大小**：S（payload < 60 行 JSON + 1 个验证脚本）

**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/payload-and-dispatch.test.ts`

---

### Workstream 2: 跑通全图 + 收 evidence

**范围**：等待 LangGraph harness-initiative full graph 跑完（A→B→C 阶段），实时收集 task_events / sub_task / interrupt_pending+interrupt_resumed / thread_lookup 命中 / sub_task PR merge 证据；将所有证据写入 `acceptance-evidence.md`，含 task_id、SQL 截、PR URL、4 个 hotfix PR 编号、Brain log 关键行号。

**大小**：M（一段时间 polling + evidence 文档约 200 行）

**依赖**：Workstream 1 完成（task_id 已派发且 in_progress）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/run-and-evidence.test.ts`

---

### Workstream 3: 最终 acceptance 报告 + learnings

**范围**：写 `docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md`（含 task_id / graph_node_update SQL 截 / sub_task PR 链接 / KR 进度变化 / failure_reason 全空断言）+ `docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md`（≥ 60 字节、至少 1 条 PRD 之外的具体 learning）。回写 Brain task 状态（PATCH /api/brain/tasks/{task_id}）。

**大小**：S（两份 markdown < 300 行）

**依赖**：Workstream 2 完成（evidence 已落盘）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report-and-learnings.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/payload-and-dispatch.test.ts` | payload schema 通过 / POST 返回 task_id / 90s 内 in_progress / 至少 1 graph_node_update | 4 failures（payload 文件不存在 / .acceptance-task-id 不存在 / status 非 in_progress / 节点事件 0） |
| WS2 | `tests/ws2/run-and-evidence.test.ts` | 6 个 distinct planning node / sub_task ≥1 / interrupt_pending+resumed 各 ≥1 / thread_lookup 命中 / PR merged / evidence 文档完整 | 6 failures（distinct nodes < 6 / sub_task 0 / interrupt 0 / lookup 0 / PR 未 merge / evidence 缺关键字段） |
| WS3 | `tests/ws3/report-and-learnings.test.ts` | 报告 5 段必填 / learnings ≥60 字节且非 PRD 子集 / Brain task 状态回写 PATCH | 3 failures（报告不存在 / learnings 不存在 / task 未回写 completed） |
