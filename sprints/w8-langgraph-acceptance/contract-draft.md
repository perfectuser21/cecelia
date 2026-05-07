# Sprint Contract Draft (Round 2)

> Round 1 → Reviewer REVISION，本轮处理 3 项反馈：
> (1) Step 2 加 `langgraph_checkpoints` fallback 防 stream 写表失败导致 distinct < 14；
> (2) Step 4 在断言 `phase=done` 前先校验 `failure_reason != 'watchdog_overdue'` 并打印 `deadline_at - completed_at` 差值；
> (3) Test Contract 表加"未实现时具体断言"列、新增"红证据校验命令"段、统一交付测试文件路径。

---

## 唯一交付测试文件路径（统一）

为消除 Reviewer 指出的"PRD 写 `tests/integration/harness-health.test.ts`、合同 Workstream 表写 `tests/ws2/harness-health-integration.test.ts`"歧义，本合同显式规定：

| 角色 | 路径 | 何时存在 | 谁写入 |
|---|---|---|---|
| **唯一最终交付测试** | `tests/integration/harness-health.test.ts` | 合并到 main | Generator（commit 2）从 `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` 复制内容 |
| **GAN 红证据 scaffold** | `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` | 仅在 sprint 分支 | Proposer（本轮）；commit 1 阶段保留为审计 |
| **GAN 红证据 scaffold（WS1）** | `sprints/w8-langgraph-acceptance/tests/ws1/harness-health-endpoint.test.ts` | 仅在 sprint 分支 | Proposer（本轮） |

**规则**：所有 PRD / 合同 / DoD / task-plan 指代"集成测试文件"时，唯一路径 = `tests/integration/harness-health.test.ts`。Sprint dir 下的 `tests/ws{N}/*.test.ts` 仅用于 GAN 红证据校验（vitest 跑见下文），不进 main。

## Initiative
- **initiative_id**: `w8-langgraph-acceptance-20260507`
- **task_type**: `harness_initiative`
- **journey_type**: `autonomous`
- **journey_type_reason**: 仅改 packages/brain/，Brain 单进程内 LangGraph 自驱的"管家闭环"端到端验收。

---

## Golden Path

[入口] 派发 `harness_initiative` 任务 → [Step 1] Brain dispatch 入队 + executor 启动 LangGraph stream → [Step 2] 14 节点全程 emit `graph_node_update` 事件 → [Step 3] 阶段 B 产出 health-endpoint PR 并 merge → [Step 4] 阶段 C final_evaluate + report 写终态 → [出口] `GET /api/brain/harness/health` 在 staging 返回 200，`initiative_runs.phase='done'`。

---

### Step 1: Brain dispatch 接收并启动 LangGraph

**可观测行为**: Initiative 任务从 `queued` 转入 `in_progress`，executor 计算出 `thread_id=harness-initiative:w8-langgraph-acceptance-20260507:1`（W1 版本化）并把它写入 `initiative_runs.thread_id`，`initiative_runs.phase` 落到 `A_planning` 或更后阶段（不再是 NULL）。

**验证命令**:
```bash
# 假设 INITIATIVE_ID 已 export
INITIATIVE_ID="w8-langgraph-acceptance-20260507"
psql "$DB" -At -c "
  SELECT thread_id, phase
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '30 minutes'
   ORDER BY created_at DESC
   LIMIT 1
" | tee /tmp/w8-step1.out
# 期望：thread_id 形如 harness-initiative:w8-langgraph-acceptance-20260507:1，phase IN ('A_planning','B_task_loop','C_final','done')
grep -E "^harness-initiative:w8-langgraph-acceptance-20260507:[0-9]+\|" /tmp/w8-step1.out
```

**硬阈值**:
- `thread_id` 匹配正则 `^harness-initiative:w8-langgraph-acceptance-20260507:[0-9]+$`
- `phase` 不为 NULL，且属于 `{A_planning,B_task_loop,C_final,done}`
- 行必须 30 分钟内创建（防 SELECT 拿到陈旧记录造假）

---

### Step 2: 14 节点 LangGraph 全程 stream 事件

**可观测行为**: stream mode（W4）逐节点 emit `graph_node_update` 写入 `task_events` 表；每个节点至少一次出现，命名严格匹配 14 节点列表。

**验证命令**:
```bash
INITIATIVE_ID="w8-langgraph-acceptance-20260507"

# 主路径：task_events 表（W4 stream emitter 写入）
psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
" | tee /tmp/w8-step2-distinct.out
DISTINCT_PRIMARY=$(cat /tmp/w8-step2-distinct.out | tr -d ' ')

# Fallback 路径：langgraph_checkpoints 表（PostgresSaver 每个节点结束写一次 checkpoint，按 thread_id 过滤）
# 处理反馈(1)：若 stream emitter 写 task_events 失败导致 < 14，仍可由 PostgresSaver 兜底证明 14 节点真实跑过
THREAD_ID=$(psql "$DB" -At -c "
  SELECT thread_id FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC LIMIT 1
")
DISTINCT_FALLBACK=0
if [ -n "$THREAD_ID" ]; then
  # langgraph_checkpoints metadata->>'source' 携带刚跑完的 nodeName（LangGraph PostgresSaver 1.x 行为）
  DISTINCT_FALLBACK=$(psql "$DB" -At -c "
    SELECT count(DISTINCT COALESCE(
             metadata->>'source',
             metadata->'writes'->-1->>0,
             checkpoint->'channel_values'->>'__node__'
           ))
      FROM langgraph_checkpoints
     WHERE thread_id='${THREAD_ID}'
       AND created_at > NOW() - interval '60 minutes'
  " | tr -d ' ')
fi
echo "PRIMARY=$DISTINCT_PRIMARY FALLBACK=$DISTINCT_FALLBACK"

# 至少一条路径满足 ≥ 14
if [ "$DISTINCT_PRIMARY" -lt 14 ] && [ "$DISTINCT_FALLBACK" -lt 14 ]; then
  echo "FAIL: primary=$DISTINCT_PRIMARY fallback=$DISTINCT_FALLBACK 双路均 < 14"
  exit 1
fi

# 进一步：验证 14 个节点名集合完全覆盖（先查主路径，主路径不全则查 fallback）
NODES_SET=$(psql "$DB" -At -c "
  SELECT string_agg(DISTINCT payload->>'nodeName', ',' ORDER BY payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
")
echo "$NODES_SET" | tee /tmp/w8-step2-set.out

MISSING=""
for NODE in prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance final_evaluate report; do
  if ! echo "$NODES_SET" | grep -qw "$NODE"; then
    MISSING="$MISSING $NODE"
  fi
done

if [ -n "$MISSING" ] && [ -n "$THREAD_ID" ]; then
  # 主路径缺失，去 fallback 表再确认一次
  FALLBACK_SET=$(psql "$DB" -At -c "
    SELECT string_agg(DISTINCT COALESCE(
             metadata->>'source',
             metadata->'writes'->-1->>0,
             checkpoint->'channel_values'->>'__node__'
           ), ',' ORDER BY 1)
      FROM langgraph_checkpoints
     WHERE thread_id='${THREAD_ID}'
  ")
  echo "FALLBACK_SET=$FALLBACK_SET"
  for NODE in $MISSING; do
    echo "$FALLBACK_SET" | grep -qw "$NODE" || { echo "FAIL: node '$NODE' 主路径与 fallback 均缺失"; exit 1; }
  done
fi
```

**硬阈值**:
- 主路径 `task_events.count(DISTINCT payload->>'nodeName') >= 14` **或** Fallback `langgraph_checkpoints` 里去重后的 `nodeName` 数 ≥ 14（窗口 60 分钟内）
- 12 个必现节点（prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）至少在两路其一存在
- 时间窗口 `created_at > NOW() - interval '60 minutes'` 防造假

---

### Step 3: 阶段 B 产出 health-endpoint PR 并 merge 到 main

**可观测行为**: 至少一个 PR 包含路径 `packages/brain/src/routes/harness.js` 且其 diff 含 `health` handler，PR state=MERGED，merge 提交进入 main HEAD 历史。

**验证命令**:
```bash
INITIATIVE_ID="w8-langgraph-acceptance-20260507"

# 1) 通过 dev_records 找出本 initiative 关联的 PR
PR_URL=$(psql "$DB" -At -c "
  SELECT pr_url
    FROM dev_records
   WHERE pr_url IS NOT NULL
     AND created_at > NOW() - interval '60 minutes'
     AND (task_id IN (
       SELECT id FROM tasks
        WHERE payload->>'parent_initiative_id'='${INITIATIVE_ID}'
     ) OR pr_url LIKE '%harness%' )
   ORDER BY created_at DESC
   LIMIT 1
")
[ -n "$PR_URL" ] || { echo "FAIL: no PR for initiative ${INITIATIVE_ID}"; exit 1; }

# 2) 校验 PR 已 merge
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
STATE=$(gh pr view "$PR_NUM" --json state -q .state)
[ "$STATE" = "MERGED" ] || { echo "FAIL: PR #$PR_NUM state=$STATE != MERGED"; exit 1; }

# 3) 校验 PR diff 触及目标文件
gh pr diff "$PR_NUM" --name-only | grep -qE '^packages/brain/src/routes/harness\.js$' \
  || { echo "FAIL: PR #$PR_NUM 未触及 packages/brain/src/routes/harness.js"; exit 1; }

# 4) 校验 main HEAD 含 health handler 字符串
git fetch origin main >/dev/null
git show origin/main:packages/brain/src/routes/harness.js | grep -qE "router\.get\(\s*['\"]/health['\"]" \
  || { echo "FAIL: main 上 harness.js 不含 GET /health handler"; exit 1; }
```

**硬阈值**:
- `dev_records.pr_url IS NOT NULL` 且 60 分钟内创建
- `gh pr view --json state` 返回 `MERGED`
- PR diff name-only 含 `packages/brain/src/routes/harness.js`
- `origin/main` 当前 HEAD 上 harness.js 含正则 `router\.get\(\s*['"]/health['"]`

---

### Step 4: final_evaluate + report 写终态

**可观测行为**: `final_evaluate` 节点跑完 e2e_acceptance scenarios 后，`report` 节点把 `initiative_runs` 行写入 `phase='done'`、`completed_at IS NOT NULL`、`failure_reason IS NULL`；同时 task_events 中 `report` 节点 emit。

**验证命令**:
```bash
INITIATIVE_ID="w8-langgraph-acceptance-20260507"

# 反馈(2)：先打印 deadline_at - completed_at 差值并校验非 watchdog_overdue 失败
psql "$DB" -At -F$'\t' -c "
  SELECT phase,
         COALESCE(failure_reason, ''),
         deadline_at,
         completed_at,
         EXTRACT(EPOCH FROM (deadline_at - completed_at))::int AS deadline_minus_completed_sec
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC
   LIMIT 1
" | tee /tmp/w8-step4-diag.out

IFS=$'\t' read -r PHASE FAILURE_REASON DEADLINE_AT COMPLETED_AT DIFF_SEC < /tmp/w8-step4-diag.out
echo "==> phase=$PHASE failure_reason='$FAILURE_REASON' deadline_at=$DEADLINE_AT completed_at=$COMPLETED_AT diff_sec=$DIFF_SEC"

# 先行校验：failure_reason 必须不是 watchdog_overdue（W3 watchdog 兜底打的标，应在 deadline 内完成）
if [ "$FAILURE_REASON" = "watchdog_overdue" ]; then
  echo "FAIL: failure_reason=watchdog_overdue (deadline_at=$DEADLINE_AT < NOW()，W3 兜底超时)"
  echo "      deadline_at - completed_at = ${DIFF_SEC}s（负值 = 完成时已逾期）"
  exit 1
fi

# 然后才断言 phase=done / completed_at / failure_reason 空
psql "$DB" -At -F$'\t' -c "
  SELECT phase,
         (completed_at IS NOT NULL)::int AS completed,
         (failure_reason IS NULL)::int AS no_failure
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC
   LIMIT 1
" | tee /tmp/w8-step4.out

read -r PHASE2 COMPLETED NOFAIL < /tmp/w8-step4.out
[ "$PHASE2" = "done" ] || { echo "FAIL: phase=$PHASE2 != done"; exit 1; }
[ "$COMPLETED" = "1" ] || { echo "FAIL: completed_at IS NULL"; exit 1; }
[ "$NOFAIL" = "1" ] || { echo "FAIL: failure_reason 非空"; exit 1; }

# 信息打印：确认在 deadline 之前完成（diff_sec 正值）
if [ -n "$DIFF_SEC" ] && [ "$DIFF_SEC" -lt 0 ] 2>/dev/null; then
  echo "FAIL: completed_at > deadline_at（diff=${DIFF_SEC}s，超时但 phase=done 矛盾）"
  exit 1
fi

# report 节点必须 emit
psql "$DB" -At -c "
  SELECT count(*) FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND payload->>'nodeName'='report'
     AND created_at > NOW() - interval '60 minutes'
" | tee /tmp/w8-step4-report.out
[ "$(cat /tmp/w8-step4-report.out | tr -d ' ')" -ge 1 ] || { echo "FAIL: report 节点未 emit"; exit 1; }
```

**硬阈值**:
- 先校验 `failure_reason != 'watchdog_overdue'`（W3 watchdog 兜底超时不能蒙混过关）
- 打印 `deadline_at - completed_at` 差值（秒），负值即超时，断言为正
- `initiative_runs.phase = 'done'`
- `completed_at IS NOT NULL`
- `failure_reason IS NULL`
- `task_events` 中 `nodeName='report'` 至少 1 行（窗口 60 分钟）

---

### Step 5（出口）: staging health 端点存活

**可观测行为**: staging Brain（端口 5222）上 `GET /api/brain/harness/health` 返回 HTTP 200，body JSON 含 `langgraph_version`（非空字符串）+ `last_attempt_at`（ISO 8601 字符串或 null）+ `nodes`（含 14 节点字符串数组）。

**验证命令**:
```bash
# staging 端口 5222；scripts/harness-e2e-up.sh 已起环境且重启 Brain 拉新 PR
RESP=$(curl -fsS http://localhost:5222/api/brain/harness/health) \
  || { echo "FAIL: HTTP non-200"; exit 1; }

echo "$RESP" | jq -e '
  (.langgraph_version | type=="string" and length>0)
  and (.last_attempt_at == null or (.last_attempt_at | type=="string" and test("^\\d{4}-\\d{2}-\\d{2}T")))
  and (.nodes | type=="array" and length>=14)
  and ((.nodes | index("prep")) != null)
  and ((.nodes | index("planner")) != null)
  and ((.nodes | index("parsePrd")) != null)
  and ((.nodes | index("ganLoop")) != null)
  and ((.nodes | index("inferTaskPlan")) != null)
  and ((.nodes | index("dbUpsert")) != null)
  and ((.nodes | index("pick_sub_task")) != null)
  and ((.nodes | index("run_sub_task")) != null)
  and ((.nodes | index("evaluate")) != null)
  and ((.nodes | index("advance")) != null)
  and ((.nodes | index("retry")) != null)
  and ((.nodes | index("terminal_fail")) != null)
  and ((.nodes | index("final_evaluate")) != null)
  and ((.nodes | index("report")) != null)
' >/dev/null || { echo "FAIL: body shape mismatch: $RESP"; exit 1; }
```

**硬阈值**:
- HTTP 200（`curl -fsS` 5xx 立即失败）
- `langgraph_version` 是非空字符串（防 `""` / `null` 假绿）
- `last_attempt_at` 是 ISO 8601 或 null（防 epoch 整数等错误格式）
- `nodes` 数组长度 ≥ 14 且 14 个具体节点名全部覆盖

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`

**完整验证脚本**:
```bash
#!/usr/bin/env bash
set -euo pipefail

INITIATIVE_ID="w8-langgraph-acceptance-20260507"
DB="${DB:-postgresql://localhost/cecelia}"
STAGING_BRAIN="${STAGING_BRAIN:-http://localhost:5222}"

echo "==> Step 1: initiative_runs.thread_id 已写入"
THREAD_ID=$(psql "$DB" -At -c "
  SELECT thread_id FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC LIMIT 1
")
echo "$THREAD_ID" | grep -qE "^harness-initiative:${INITIATIVE_ID}:[0-9]+$" \
  || { echo "FAIL Step 1: thread_id=$THREAD_ID"; exit 1; }

echo "==> Step 2: 14 distinct nodeName（task_events 主路径 + langgraph_checkpoints fallback）"
DISTINCT_PRIMARY=$(psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
")
DISTINCT_FALLBACK=0
if [ -n "$THREAD_ID" ]; then
  DISTINCT_FALLBACK=$(psql "$DB" -At -c "
    SELECT count(DISTINCT COALESCE(
             metadata->>'source',
             metadata->'writes'->-1->>0,
             checkpoint->'channel_values'->>'__node__'
           ))
      FROM langgraph_checkpoints
     WHERE thread_id='${THREAD_ID}'
       AND created_at > NOW() - interval '60 minutes'
  ")
fi
echo "    primary=$DISTINCT_PRIMARY fallback=$DISTINCT_FALLBACK"
if [ "$DISTINCT_PRIMARY" -lt 14 ] && [ "$DISTINCT_FALLBACK" -lt 14 ]; then
  echo "FAIL Step 2: 主路径与 fallback 双路均 < 14"
  exit 1
fi
for NODE in prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance final_evaluate report; do
  EXISTS_PRIMARY=$(psql "$DB" -At -c "
    SELECT count(*) FROM task_events
     WHERE event_type='graph_node_update'
       AND payload->>'initiativeId'='${INITIATIVE_ID}'
       AND payload->>'nodeName'='$NODE'
       AND created_at > NOW() - interval '60 minutes'
  ")
  if [ "$EXISTS_PRIMARY" -lt 1 ]; then
    EXISTS_FALLBACK=$(psql "$DB" -At -c "
      SELECT count(*) FROM langgraph_checkpoints
       WHERE thread_id='${THREAD_ID}'
         AND COALESCE(
               metadata->>'source',
               metadata->'writes'->-1->>0,
               checkpoint->'channel_values'->>'__node__'
             )='$NODE'
    ")
    [ "$EXISTS_FALLBACK" -ge 1 ] || { echo "FAIL Step 2: node '$NODE' 主路径与 fallback 均缺失"; exit 1; }
  fi
done

echo "==> Step 3: PR merged + main 上含 health handler"
PR_URL=$(psql "$DB" -At -c "
  SELECT pr_url FROM dev_records
   WHERE pr_url IS NOT NULL
     AND created_at > NOW() - interval '60 minutes'
     AND task_id IN (SELECT id FROM tasks WHERE payload->>'parent_initiative_id'='${INITIATIVE_ID}')
   ORDER BY created_at DESC LIMIT 1
")
[ -n "$PR_URL" ] || { echo "FAIL Step 3: no PR"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
STATE=$(gh pr view "$PR_NUM" --json state -q .state)
[ "$STATE" = "MERGED" ] || { echo "FAIL Step 3: PR state=$STATE"; exit 1; }
gh pr diff "$PR_NUM" --name-only | grep -qE '^packages/brain/src/routes/harness\.js$' \
  || { echo "FAIL Step 3: PR diff 未触及目标文件"; exit 1; }
git fetch origin main >/dev/null
git show origin/main:packages/brain/src/routes/harness.js | grep -qE "router\.get\(\s*['\"]/health['\"]" \
  || { echo "FAIL Step 3: main 上无 /health"; exit 1; }

echo "==> Step 4: 先校验 failure_reason != watchdog_overdue + deadline_at - completed_at 差值"
IFS=$'\t' read -r PHASE FAILURE_REASON DEADLINE_AT COMPLETED_AT DIFF_SEC <<< "$(psql "$DB" -At -F$'\t' -c "
  SELECT phase,
         COALESCE(failure_reason, ''),
         deadline_at,
         completed_at,
         EXTRACT(EPOCH FROM (deadline_at - completed_at))::int
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC LIMIT 1
")"
echo "    phase=$PHASE failure_reason='$FAILURE_REASON' deadline_at=$DEADLINE_AT completed_at=$COMPLETED_AT diff_sec=$DIFF_SEC"
[ "$FAILURE_REASON" = "watchdog_overdue" ] \
  && { echo "FAIL Step 4: failure_reason=watchdog_overdue（W3 兜底超时；diff=${DIFF_SEC}s）"; exit 1; }
[ -n "$DIFF_SEC" ] && [ "$DIFF_SEC" -lt 0 ] 2>/dev/null \
  && { echo "FAIL Step 4: completed_at > deadline_at（diff=${DIFF_SEC}s）"; exit 1; }

echo "==> Step 4: phase=done + completed_at + no failure"
read -r PHASE2 COMPLETED NOFAIL <<< "$(psql "$DB" -At -F' ' -c "
  SELECT phase,
         (completed_at IS NOT NULL)::int,
         (failure_reason IS NULL)::int
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC LIMIT 1
")"
[ "$PHASE2" = "done" ] && [ "$COMPLETED" = "1" ] && [ "$NOFAIL" = "1" ] \
  || { echo "FAIL Step 4: phase=$PHASE2 completed=$COMPLETED nofail=$NOFAIL"; exit 1; }

echo "==> Step 5: staging health 端点 + body shape"
RESP=$(curl -fsS "${STAGING_BRAIN}/api/brain/harness/health") \
  || { echo "FAIL Step 5: HTTP non-200"; exit 1; }
echo "$RESP" | jq -e '
  (.langgraph_version | type=="string" and length>0)
  and (.last_attempt_at == null or (.last_attempt_at | type=="string" and test("^\\d{4}-\\d{2}-\\d{2}T")))
  and (.nodes | type=="array" and length>=14)
  and ((.nodes | index("prep")) != null)
  and ((.nodes | index("planner")) != null)
  and ((.nodes | index("parsePrd")) != null)
  and ((.nodes | index("ganLoop")) != null)
  and ((.nodes | index("inferTaskPlan")) != null)
  and ((.nodes | index("dbUpsert")) != null)
  and ((.nodes | index("pick_sub_task")) != null)
  and ((.nodes | index("run_sub_task")) != null)
  and ((.nodes | index("evaluate")) != null)
  and ((.nodes | index("advance")) != null)
  and ((.nodes | index("retry")) != null)
  and ((.nodes | index("terminal_fail")) != null)
  and ((.nodes | index("final_evaluate")) != null)
  and ((.nodes | index("report")) != null)
' >/dev/null || { echo "FAIL Step 5: body=$RESP"; exit 1; }

echo "OK Golden Path 全部通过"
```

**通过标准**: 脚本 exit 0；任一 Step 失败立刻 exit 1 并打印诊断行。

---

## Workstreams

workstream_count: 2

### Workstream 1: health endpoint 实现

**范围**: 在 `packages/brain/src/routes/harness.js` 追加 `router.get('/health', ...)` handler，返回 `{ langgraph_version, last_attempt_at, nodes }`。`langgraph_version` 取自 `@langchain/langgraph/package.json` 的 `version` 字段；`last_attempt_at` 取 `SELECT MAX(updated_at) FROM initiative_runs`（无记录返回 null）；`nodes` 是固定 14 节点字符串数组（与 `compileHarnessFullGraph` addNode 顺序一致）。

**大小**: S（< 80 行新增）

**依赖**: 无

**BEHAVIOR 覆盖测试文件（sprint 内 GAN 红证据）**: `sprints/w8-langgraph-acceptance/tests/ws1/harness-health-endpoint.test.ts`

**唯一最终交付物**: `packages/brain/src/routes/harness.js`（修改）

---

### Workstream 2: health endpoint 集成测试

**范围**: 新建 **`tests/integration/harness-health.test.ts`**（vitest，唯一交付路径，与 PRD 一致）：启 Brain（直接 `import` server 或起子进程，或挂 `harnessRoutes` 到独立 Express），向 `/api/brain/harness/health` 发请求，断言 status=200 + body shape（langgraph_version 非空 / last_attempt_at null|ISO / nodes 长度=14 且含 14 节点名）。Generator 在 commit 2 阶段从 `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` 复制内容到唯一交付路径。

**大小**: S（< 120 行）

**依赖**: Workstream 1 完成（实现先行；测试用 vitest run 真实命中端点）

**BEHAVIOR 覆盖测试文件（sprint 内 GAN 红证据）**: `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts`

**唯一最终交付路径**: `tests/integration/harness-health.test.ts`

---

## Test Contract

| Workstream | Test File（sprint 内 GAN 红证据） | 唯一最终交付路径 | BEHAVIOR 覆盖 | 未实现时具体断言（红证据） | 预期红失败数 |
|---|---|---|---|---|---|
| WS1 | `sprints/w8-langgraph-acceptance/tests/ws1/harness-health-endpoint.test.ts` | `packages/brain/src/routes/harness.js` 内追加 router.get('/health') | handler 返回 status 200；body.langgraph_version 是非空字符串；body.last_attempt_at = null 或 ISO 8601；body.nodes 长度=14 且全部 14 节点名覆盖；Content-Type=application/json | `expect(res.status).toBe(200)` 红（router 无 /health → 404）；`expect(typeof res.body.langgraph_version).toBe('string')` 红（handler 不存在 → undefined）；`expect(res.body.nodes).toHaveLength(14)` 红；`expect(harnessRoutes).toBeDefined()` 红若文件未导出；`expect(res.headers['content-type']).toMatch(/application\/json/)` 红 | 5 failures |
| WS2 | `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` | `tests/integration/harness-health.test.ts` | Express 实例挂 router 后 GET 返回 200 + 14 nodes；last_attempt_at 字段存在且 null 或 ISO；重复请求同 shape | `expect(res.status).toBe(200) and expect(res.body.nodes).toHaveLength(14)` 红（端点未实现）；`expect([null, 'string']).toContain(typeof res.body.last_attempt_at)` 红；`expect(res2.body.nodes).toEqual(res1.body.nodes)` 红 | 3 failures |

**总红失败数目标**：WS1(5) + WS2(3) = **8 failures** ≥ 7（满足 Reviewer 要求）。

---

## 红证据校验命令（外层机检验证"未实现确实红"）

Reviewer 可逐条跑下面命令，证明合同内的测试在"未实现状态"下确实红：

```bash
# 前置：当前 main 上 packages/brain/src/routes/harness.js 不含 /health handler；
# 即便已含，stash 后也回到无该 handler 状态以验证红
cd /workspace

# WS1 红证据
git stash --include-untracked
EXIT1=0
npx vitest run sprints/w8-langgraph-acceptance/tests/ws1/harness-health-endpoint.test.ts --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || EXIT1=$?
git stash pop
[ "$EXIT1" -ne 0 ] || { echo "FAIL: WS1 测试在未实现时未红 (EXIT1=$EXIT1)"; exit 1; }
grep -cE "FAIL|✗|failed" /tmp/ws1-red.log

# WS2 红证据
git stash --include-untracked
EXIT2=0
npx vitest run sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts --reporter=verbose 2>&1 | tee /tmp/ws2-red.log || EXIT2=$?
git stash pop
[ "$EXIT2" -ne 0 ] || { echo "FAIL: WS2 测试在未实现时未红 (EXIT2=$EXIT2)"; exit 1; }
grep -cE "FAIL|✗|failed" /tmp/ws2-red.log

echo "OK: WS1 + WS2 在未实现时确实红，红证据已写 /tmp/ws{1,2}-red.log"
```

**通过标准**：两条 vitest 命令 EXIT ≠ 0，且 FAIL 行计数之和 ≥ 7。
