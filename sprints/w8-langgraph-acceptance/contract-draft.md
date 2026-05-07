# Sprint Contract Draft (Round 1)

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
psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
" | tee /tmp/w8-step2-distinct.out

DISTINCT=$(cat /tmp/w8-step2-distinct.out | tr -d ' ')
[ "$DISTINCT" -ge 14 ] || { echo "FAIL: distinct nodeName=$DISTINCT < 14"; exit 1; }

# 进一步：验证 14 个节点名集合完全覆盖
psql "$DB" -At -c "
  SELECT string_agg(DISTINCT payload->>'nodeName', ',' ORDER BY payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
" | tee /tmp/w8-step2-set.out

# 期望：覆盖 prep,planner,parsePrd,ganLoop,inferTaskPlan,dbUpsert,pick_sub_task,run_sub_task,evaluate,advance,retry|terminal_fail,final_evaluate,report
for NODE in prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance final_evaluate report; do
  grep -qw "$NODE" /tmp/w8-step2-set.out || { echo "FAIL: missing required node $NODE"; exit 1; }
done
```

**硬阈值**:
- `count(DISTINCT payload->>'nodeName') >= 14`（窗口 60 分钟内）
- 12 个必现节点（prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）逐一存在
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

read -r PHASE COMPLETED NOFAIL < /tmp/w8-step4.out
[ "$PHASE" = "done" ] || { echo "FAIL: phase=$PHASE != done"; exit 1; }
[ "$COMPLETED" = "1" ] || { echo "FAIL: completed_at IS NULL"; exit 1; }
[ "$NOFAIL" = "1" ] || { echo "FAIL: failure_reason 非空"; exit 1; }

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

echo "==> Step 2: 14 distinct nodeName"
DISTINCT=$(psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
")
[ "$DISTINCT" -ge 14 ] || { echo "FAIL Step 2: distinct=$DISTINCT"; exit 1; }
for NODE in prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance final_evaluate report; do
  EXISTS=$(psql "$DB" -At -c "
    SELECT count(*) FROM task_events
     WHERE event_type='graph_node_update'
       AND payload->>'initiativeId'='${INITIATIVE_ID}'
       AND payload->>'nodeName'='$NODE'
       AND created_at > NOW() - interval '60 minutes'
  ")
  [ "$EXISTS" -ge 1 ] || { echo "FAIL Step 2: missing node $NODE"; exit 1; }
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

echo "==> Step 4: phase=done + completed_at + no failure"
read -r PHASE COMPLETED NOFAIL <<< "$(psql "$DB" -At -F' ' -c "
  SELECT phase,
         (completed_at IS NOT NULL)::int,
         (failure_reason IS NULL)::int
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '60 minutes'
   ORDER BY created_at DESC LIMIT 1
")"
[ "$PHASE" = "done" ] && [ "$COMPLETED" = "1" ] && [ "$NOFAIL" = "1" ] \
  || { echo "FAIL Step 4: phase=$PHASE completed=$COMPLETED nofail=$NOFAIL"; exit 1; }

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

**BEHAVIOR 覆盖测试文件**: `tests/ws1/harness-health-endpoint.test.ts`

---

### Workstream 2: health endpoint 集成测试

**范围**: 新建 `tests/integration/harness-health.test.ts`（vitest）：启 Brain（直接 `import` server 或起子进程），向 `/api/brain/harness/health` 发请求，断言 status=200 + body shape（langgraph_version 非空 / last_attempt_at null|ISO / nodes 长度=14 且含 14 节点名）。

**大小**: S（< 100 行）

**依赖**: Workstream 1 完成（实现先行；测试用 vitest run 真实命中端点）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/harness-health-integration.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/harness-health-endpoint.test.ts` | handler 函数返回正确 shape；`last_attempt_at=null` 时不抛；`langgraph_version` 是字符串 | WS1 → 3 failures（handler 不存在 / 字段缺失） |
| WS2 | `tests/ws2/harness-health-integration.test.ts` | 启 Brain 实例后 GET /health 返回 200 + body 含 14 nodes | WS2 → 2 failures（路由未挂载或 body shape 错误） |
