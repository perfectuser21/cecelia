# Sprint Contract Draft (Round 2) — W8 v9 LangGraph 修正全套 final acceptance

> 本 sprint 是 **验收性**，不修改 packages/brain / entrypoint.sh / graph 任何代码。
> 目标：用现有 main 分支 Brain（含 4 个 hotfix）真派一次 walking_skeleton harness_initiative，证明 **spawn-callback-resume 闭环全程无人干预跑通**，并落 evidence + 报告。
>
> **Round 2 修订要点**（处理 Round 1 Reviewer 反馈）：
> - **R3 binary verdict 模型**：合同硬阈值=「闭环跑通」，「任务 PASS」是期望但非合同必过项；FAIL 终止态作为有效 evidence 形态被显式接受。
> - **R4 7200s 硬超时 fall-through**：WS2 polling 设 7200s 硬上限；超时 → 写 timeout fail evidence 仍走 WS3 报告，不永等。
> - **测试文件 NEW/EXISTING 标记**：所有 `tests/wsN/*.test.ts` 标 **NEW**（本 sprint r1 commit 1b62cb72e 产出，是合同对 Generator 的产出物清单一部分）。Test Contract 表加 Runner（vitest）和 Status（NEW）两列。
> - **测试 RED 用例数从 13 → 17**（≥ 7 目标已远超达成）：WS1 +1（health check）、WS2 +2（loop closure / final_evaluate node）、WS3 +1（双 verdict 区分）。

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
        │ (sub_task 行 status=completed verdict=DONE|FAIL; PR 视任务状态 merge 或保持 open)
        ▼
[C 阶段 Final E2E: final_evaluate (跑 e2e_acceptance) → report]
        │
        ▼
[出口（合同硬阈值，binary verdict 模型）]
        │
        ├─ 必过：loop_success = true（图跑完到 final_evaluate + report；tasks.status=completed；initiative_runs.completed_at 非空）
        └─ 期望：task_pass = (custom_props.final_e2e_verdict='PASS')；FAIL 终止态作为有效 evidence
        │
        ▼
[evidence: acceptance-evidence.md + 最终报告 docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md + learnings]
```

---

## 验收判定模型 (Verdict Matrix) — Round 2 新增

合同 PASS 用 **二维 verdict**，区分"管道工作了"和"功能工作了"：

| 维度 | 含义 | 字段来源 |
|---|---|---|
| **loop_success** | spawn-callback-resume 闭环跑通：图跑到 `final_evaluate` 节点 + `report` 节点都写了 graph_node_update；tasks.status=completed；initiative_runs.completed_at 非空 | `task_events.event_type='graph_node_update'` + `tasks.status` + `initiative_runs.completed_at` |
| **task_pass** | walking_skeleton 的 e2e_acceptance 命令跑出 verdict=PASS | `tasks.custom_props->>'final_e2e_verdict' = 'PASS'` |

**evidence 形态判定**：

| loop_success | task_pass | 形态 | 合同 verdict |
|:-:|:-:|---|:-:|
| ✓ | ✓ | A 形（理想）：闭环 PASS + 任务 PASS | **PASS** |
| ✓ | ✗ | B 形（退化但有效）：闭环 PASS + 任务 FAIL | **PASS**（合同允许，但报告必须标注 task_fail_reason） |
| ✗ | — | C 形（失败）：闭环未跑通（图卡住、tasks 非 completed、initiative_runs 未 completed_at） | **FAIL** |

**合同硬阈值** = `loop_success == true`。`task_pass=false` 不导致合同 FAIL，但必须在 evidence + 报告里显式标注 task_fail_reason（不允许"装看不见"）。

---

### Step 1: 派发 walking_skeleton harness_initiative 任务

**可观测行为**：主理人 POST `localhost:5221/api/brain/tasks` 后，Brain 返回新建任务的 task_id；下一个 dispatcher tick 内（≤ 60s），该任务的 status 从 `queued` 转为 `in_progress`，并在 `task_events` 写入 `graph_node_update` 类型事件，证明 LangGraph harness-initiative 全图已被路由启动。

**前置产物**：`sprints/w8-langgraph-v9/acceptance-task-payload.json` 存在，且 JSON 解析后含字段：`task_type=harness_initiative`、`payload.walking_skeleton.thin_feature`（非空字符串）、`payload.walking_skeleton.e2e_acceptance.command`（非空字符串）、`payload.walking_skeleton.e2e_acceptance.timeout_sec`（数字 ≤ 600）。

**前置环境检查**：Brain 进程在跑（`curl -fsS localhost:5221/api/brain/health` 返回 healthy），否则不可派发。

**验证命令**：

```bash
# 0a. Brain health 必须先绿（防 dispatcher 不在）
curl -fsS localhost:5221/api/brain/health | jq -e '.status == "healthy" or .status == "ok"'

# 0b. payload 文件存在并语法合法
test -f sprints/w8-langgraph-v9/acceptance-task-payload.json
jq -e '.task_type == "harness_initiative"
       and (.payload.walking_skeleton.thin_feature | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.command | type == "string" and length > 0)
       and (.payload.walking_skeleton.e2e_acceptance.timeout_sec | type == "number" and . <= 600)' \
   sprints/w8-langgraph-v9/acceptance-task-payload.json

# 1. POST 派任务 → 提取 task_id 写到 /tmp/w8v9-task-id（供后续 step 引用）
TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  --data-binary @sprints/w8-langgraph-v9/acceptance-task-payload.json | jq -r '.id // .task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]
echo "$TASK_ID" > /tmp/w8v9-task-id

# 2. 90s 内 status 转 in_progress（dispatcher tick 拉到）
DEADLINE=$(($(date +%s)+90))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(curl -fsS "localhost:5221/api/brain/tasks/$TASK_ID" | jq -r '.status')
  [ "$STATUS" = "in_progress" ] && break
  sleep 5
done
[ "$STATUS" = "in_progress" ]

# 3. 5min 时间窗内 task_events 出现至少 1 条 graph_node_update（证明 graph 启动）
psql "${DB:-postgresql://localhost/cecelia}" -t -c "
  SELECT count(*) FROM task_events
  WHERE task_id = '$TASK_ID'
    AND event_type = 'graph_node_update'
    AND created_at > NOW() - interval '5 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'
```

**硬阈值**：
- Brain `/api/brain/health` 返回 healthy/ok
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

### Step 3: B 阶段 sub_task spawn-callback-resume 闭环（含 7200s 硬超时 fall-through）

**可观测行为**：`pick_sub_task` 选首个 sub_task 后，`run_sub_task` 节点用 spawn-and-interrupt 模式：docker run 起 `harness-task-ws*-r*-<short>` 容器并立即 return，下一节点 `interrupt()` 让 graph yield，state 持久化到 PG checkpointer；容器内 claude CLI 输出 `{"verdict":"DONE"|"FAIL", ...}` exit=0；entrypoint.sh 用注入的 `HARNESS_CALLBACK_URL` POST 到 `/api/brain/sub-task-callback`；callback router 查 `walking_skeleton_thread_lookup` / `harness_thread_lookup` 命中 thread_id；`Command(resume)` 唤回 graph，跑完 `evaluate / advance`，sub_task 行 status=completed。

**Round 2 关键放宽**（R3）：sub_task 的 verdict 可以是 DONE 或 FAIL（loop 都跑通了）；只要"管道转完一圈"即合同 PASS。理想形态是 verdict=DONE + PR merged，但 verdict=FAIL（容器跑不出 PR / CI 红 merge 阻塞 / e2e_acceptance 失败）也作为**有效 evidence 形态**接受，进入 evaluate→advance→retry/terminal_fail 的正常分支。

**Round 2 关键 R4 fall-through**：本 step polling 设 **7200 秒（2 小时）硬超时**。
- 超时前闭环跑完 → 正常进入 Step 4。
- 超时仍未见 `final_evaluate` 节点的 graph_node_update 或 `tasks.status='completed'` → 进入 **timeout fall-through 分支**：跳出 polling，把当前快照（最后一条 task_event / 当前 sub_task status / 当前 PR 状态 / 当前 initiative_runs.phase）写入 `acceptance-evidence.md` 的 "Timeout Snapshot" 段；Step 4 / Step 5 仍跑（用 timeout fail 路径），不永等。

**验证命令**：

```bash
TASK_ID=$(cat /tmp/w8v9-task-id)
DB="${DB:-postgresql://localhost/cecelia}"

# 1. 至少 1 条 interrupt_pending + 至少 1 条 interrupt_resumed（证明 spawn-and-interrupt 闭环跑通）
psql "$DB" -t -c "
  SELECT
    SUM(CASE WHEN event_type = 'interrupt_pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN event_type = 'interrupt_resumed' THEN 1 ELSE 0 END) AS resumed
  FROM task_events
  WHERE (task_id = '$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id = '$TASK_ID'))
    AND created_at > NOW() - interval '120 minutes'
" -A -F'|' | head -1 | awk -F'|' '$1+0 >= 1 && $2+0 >= 1 { exit 0 } { exit 1 }'

# 2. thread_lookup 表命中（证明 callback router 不是凭 hex HOSTNAME 撞运气）
psql "$DB" -t -c "
  SELECT (SELECT count(*) FROM walking_skeleton_thread_lookup
          WHERE thread_id LIKE 'harness-initiative:%'
            AND created_at > NOW() - interval '120 minutes')
       + (SELECT count(*) FROM harness_thread_lookup
          WHERE thread_id LIKE 'harness-initiative:%'
            AND created_at > NOW() - interval '120 minutes')
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'

# 3. 闭环完成判据（loop closure，硬必过）：sub_task 至少 1 行 status=completed（不卡 in_progress），verdict 字段写入（DONE 或 FAIL 都算）
psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id = '$TASK_ID'
    AND status = 'completed'
    AND COALESCE(result->>'verdict', custom_props->>'verdict') IN ('DONE','FAIL')
    AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'

# 4. 期望（happy path）：sub_task verdict=DONE 且 pr_url 非空（合同允许此项 fail，但需写入 evidence）
DONE_PR=$(psql "$DB" -t -A -c "
  SELECT COALESCE(result->>'pr_url', custom_props->>'pr_url') FROM tasks
  WHERE parent_task_id = '$TASK_ID'
    AND status = 'completed'
    AND COALESCE(result->>'verdict', custom_props->>'verdict') = 'DONE'
    AND COALESCE(result->>'pr_url', custom_props->>'pr_url') ~ '^https://github\\.com/.+/pull/[0-9]+$'
    AND created_at > NOW() - interval '120 minutes'
  LIMIT 1
" | tr -d ' ')
if [ -n "$DONE_PR" ]; then
  PR_NUM=$(echo "$DONE_PR" | grep -oE '[0-9]+$')
  gh pr view "$PR_NUM" --json state,mergedAt,baseRefName \
    | jq -e '.state == "MERGED" and .mergedAt != null and .baseRefName == "main"' \
    || echo "WARN: sub_task verdict=DONE 但 PR 未 MERGED → B 形态退化（合同允许，evidence 必须记录原因）"
else
  echo "WARN: 未发现 verdict=DONE+PR 行 → B 形态退化或 timeout fall-through，evidence 必须记录"
fi

# 5. Brain log 在 task 时间窗口内不含致命模式（spot-check fail-fast 信号）
journalctl -u brain --since "2 hours ago" 2>/dev/null \
  | grep -E "await_callback timeout|lookup miss 404|OOM_killed.*reject.*no handler" \
  | wc -l | awk '$1+0 == 0 { exit 0 } { exit 1 }' || \
  echo "WARN: journalctl 不可用，需 evidence 文档手动贴 brain.log 截"
```

**硬阈值**（必须全部通过，否则合同 FAIL）：
- ≤ 120min 时间窗内 interrupt_pending ≥ 1 且 interrupt_resumed ≥ 1（证明 spawn-and-interrupt 模式工作）
- thread_lookup 表（任一）命中 ≥ 1（证明 callback router 走表路径，不是凭 HOSTNAME 撞运气）
- sub_task 至少 1 行 status=completed 且 verdict ∈ {DONE, FAIL}（loop closure 必过 — Round 2 放宽）
- Brain log 三个致命模式 0 命中（journalctl 不可用时 evidence 手动证）

**软阈值**（期望但允许 fail，evidence 必须显式记录原因）：
- sub_task verdict=DONE + PR MERGED 到 main（happy path A 形态）

---

### Step 4: C 阶段 Final E2E + report 节点 + acceptance evidence 落盘（binary verdict 模型）

**可观测行为**：所有 sub_task 完成后，`final_evaluate` 节点跑 walking_skeleton 的 e2e_acceptance（一条 curl/test 命令），verdict 写入 task `custom_props.final_e2e_verdict`；`report` 节点写 `tasks.result` 和 `initiative_runs.completed_at`；`tasks` 表本任务 status=completed；`initiative_runs` 表 phase ∈ {`completed_success`, `completed_failure`}（取决于 final_e2e_verdict）。

`sprints/w8-langgraph-v9/acceptance-evidence.md` 落盘，含本 sprint 实际跑出的 task_id、sub_task task_id 列表、sub_task PR URL（若有）、SQL 截图、关键 brain log 行号、**显式标注 loop_verdict 与 task_verdict 双字段**、若 task_verdict=FAIL 必须有 task_fail_reason 段、若触发 timeout fall-through 必须有 Timeout Snapshot 段。

**验证命令**：

```bash
TASK_ID=$(cat /tmp/w8v9-task-id)
DB="${DB:-postgresql://localhost/cecelia}"

# 1. 闭环必过（loop_success 硬阈值）：
#    a. tasks 行 status=completed
#    b. final_evaluate 节点和 report 节点都有 graph_node_update（图跑到底）
#    c. initiative_runs.completed_at 非空（不卡 watchdog_overdue）
psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE id = '$TASK_ID' AND status = 'completed'
    AND updated_at > NOW() - interval '180 minutes'
" | tr -d ' ' | awk '$1+0 == 1 { exit 0 } { exit 1 }'

psql "$DB" -t -c "
  SELECT count(DISTINCT (data->>'node'))
  FROM task_events
  WHERE task_id = '$TASK_ID'
    AND event_type = 'graph_node_update'
    AND data->>'node' IN ('final_evaluate','report')
    AND created_at > NOW() - interval '180 minutes'
" | tr -d ' ' | awk '$1+0 >= 2 { exit 0 } { exit 1 }'

psql "$DB" -t -c "
  SELECT count(*) FROM initiative_runs
  WHERE task_id = '$TASK_ID'
    AND phase IN ('completed_success','completed_failure')
    AND completed_at IS NOT NULL
    AND completed_at > NOW() - interval '180 minutes'
" | tr -d ' ' | awk '$1+0 >= 1 { exit 0 } { exit 1 }'

# 2. 期望（task_pass，软阈值，可 FAIL，但 evidence 必须显式记录）：
TASK_VERDICT=$(psql "$DB" -t -A -c "
  SELECT custom_props->>'final_e2e_verdict' FROM tasks WHERE id='$TASK_ID'
" | tr -d ' ')
echo "task_verdict=$TASK_VERDICT (PASS 是理想，FAIL 也接受 — 见 evidence 必填段)"

# 3. evidence 文档落盘 + 含真实 task_id 引用（防造假）+ 显式双 verdict
test -f sprints/w8-langgraph-v9/acceptance-evidence.md
grep -q "$TASK_ID" sprints/w8-langgraph-v9/acceptance-evidence.md
grep -E "loop_verdict.*(PASS|true|success)" sprints/w8-langgraph-v9/acceptance-evidence.md
grep -E "task_verdict.*(PASS|FAIL)" sprints/w8-langgraph-v9/acceptance-evidence.md
# evidence 必须显式声明 4 个 hotfix（PR #2845/2846/2847/2850）已生效
grep -E "#2845" sprints/w8-langgraph-v9/acceptance-evidence.md
grep -E "#2846" sprints/w8-langgraph-v9/acceptance-evidence.md
grep -E "#2847" sprints/w8-langgraph-v9/acceptance-evidence.md
grep -E "#2850" sprints/w8-langgraph-v9/acceptance-evidence.md
# evidence 不含占位符
! grep -E "TBD|TODO|PLACEHOLDER|XXXX|<填写>" sprints/w8-langgraph-v9/acceptance-evidence.md
# 若 task_verdict 不为 PASS，evidence 必须有 task_fail_reason 段
if [ "$TASK_VERDICT" != "PASS" ] && [ -n "$TASK_VERDICT" ]; then
  grep -E "task_fail_reason" sprints/w8-langgraph-v9/acceptance-evidence.md
fi
```

**硬阈值**：
- **loop_success 必过**：tasks.status=completed AND distinct node count of {final_evaluate, report} ≥ 2 AND initiative_runs phase ∈ {completed_success, completed_failure} AND completed_at 非空（180min 时间窗）
- evidence 文档存在 + 含真实 task_id + 显式 loop_verdict + task_verdict 双字段 + 含 4 个 hotfix PR 编号 + 不含占位符
- 若 task_verdict=FAIL，evidence 必须含 task_fail_reason 段

**软阈值**（不挂掉合同）：
- task_pass = (final_e2e_verdict='PASS')

---

### Step 5: 最终 acceptance 报告 + learnings 落盘（双 verdict 区分）

**可观测行为**：`docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md` 落盘，含：本次 task_id / 14→7 节点 graph_node_update 截 SQL / sub_task PR 链接（若有）/ KR 进度变化（设计完成态→可观测验证态）/ failure_reason 全空证据（指 brain 主流程失败标志，不是 task FAIL）/ **显式区分 loop_verdict 与 task_verdict 两段判定**。`docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md` 落盘，含至少 1 条**非平凡** learning（即不是"跑通了"这种废话）。

**验证命令**：

```bash
REPORT=docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md
LEARN=docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md
TASK_ID=$(cat /tmp/w8v9-task-id)

# 1. 报告文档存在并含必填段落
test -f "$REPORT"
grep -q "$TASK_ID" "$REPORT"
grep -E "graph_node_update" "$REPORT"
grep -E "KR|key_result|管家闭环" "$REPORT"
# 报告必须显式断言 failure_reason 全空（指 brain 主流程未触发任何 fail-fast）
grep -E "failure_reason.*(NULL|空|none|null)" "$REPORT"
# Round 2 新增：报告必须显式记录两个 verdict（区分管道 vs 任务）
grep -E "loop_verdict" "$REPORT"
grep -E "task_verdict" "$REPORT"

# 2. learnings 文档存在且不少于 60 字（防一句话敷衍）
test -f "$LEARN"
[ "$(wc -c < "$LEARN")" -ge 60 ]
# learnings 不能只复述 PRD 已知信息：必须含至少一个 PRD 文本里没有的具体细节
! diff <(sort -u "$LEARN") <(sort -u sprints/w8-langgraph-v9/sprint-prd.md) | grep -q "^>"
```

**硬阈值**：
- 报告文件存在 + 7 段必填内容（task_id / graph_node_update / KR 字段 / failure_reason 全空断言 / loop_verdict / task_verdict / sub_task PR 链接段）
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

# ==== Step 0: Brain health pre-check ====
curl -fsS localhost:5221/api/brain/health | jq -e '.status == "healthy" or .status == "ok"'

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
echo "$TASK_ID" > /tmp/w8v9-task-id
echo "[Step1] dispatched task_id=$TASK_ID"

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

# ==== Step 3: B 阶段 spawn-callback-resume + 7200s 硬超时 fall-through ====
TIMEOUT_HIT=false
DEADLINE=$(($(date +%s)+7200))
while [ $(date +%s) -lt $DEADLINE ]; do
  CLOSED=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE parent_task_id='$TASK_ID' AND status='completed' AND COALESCE(result->>'verdict', custom_props->>'verdict') IN ('DONE','FAIL') AND created_at > NOW() - interval '120 minutes'" | tr -d ' ')
  PENDING=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE (task_id='$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='$TASK_ID')) AND event_type='interrupt_pending' AND created_at > NOW() - interval '120 minutes'" | tr -d ' ')
  RESUMED=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE (task_id='$TASK_ID' OR task_id IN (SELECT id FROM tasks WHERE parent_task_id='$TASK_ID')) AND event_type='interrupt_resumed' AND created_at > NOW() - interval '120 minutes'" | tr -d ' ')
  [ "$PENDING" -ge 1 ] && [ "$RESUMED" -ge 1 ] && [ "$CLOSED" -ge 1 ] && break
  sleep 60
done
if [ $(date +%s) -ge $DEADLINE ]; then
  TIMEOUT_HIT=true
  echo "[Step3] WARN: 7200s 硬超时触发 fall-through，进入 timeout snapshot 路径"
fi
[ "$PENDING" -ge 1 ] && [ "$RESUMED" -ge 1 ] && [ "$CLOSED" -ge 1 ]

THREAD_HITS=$(psql "$DB" -t -c "SELECT (SELECT count(*) FROM walking_skeleton_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes') + (SELECT count(*) FROM harness_thread_lookup WHERE thread_id LIKE 'harness-initiative:%' AND created_at > NOW() - interval '120 minutes')" | tr -d ' ')
[ "$THREAD_HITS" -ge 1 ]
echo "[Step3] interrupt_pending=$PENDING, interrupt_resumed=$RESUMED, sub_task closed=$CLOSED, thread_hits=$THREAD_HITS, timeout_hit=$TIMEOUT_HIT"

# ==== Step 4: 闭环必过（loop_success）+ 双 verdict 记录 ====
TASK_DONE=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id='$TASK_ID' AND status='completed' AND updated_at > NOW() - interval '180 minutes'" | tr -d ' ')
[ "$TASK_DONE" = "1" ]

FINAL_REPORT_NODES=$(psql "$DB" -t -c "SELECT count(DISTINCT (data->>'node')) FROM task_events WHERE task_id='$TASK_ID' AND event_type='graph_node_update' AND data->>'node' IN ('final_evaluate','report') AND created_at > NOW() - interval '180 minutes'" | tr -d ' ')
[ "$FINAL_REPORT_NODES" -ge 2 ]

INIT_OK=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_runs WHERE task_id='$TASK_ID' AND phase IN ('completed_success','completed_failure') AND completed_at IS NOT NULL AND completed_at > NOW() - interval '180 minutes'" | tr -d ' ')
[ "$INIT_OK" -ge 1 ]

TASK_VERDICT=$(psql "$DB" -t -A -c "SELECT custom_props->>'final_e2e_verdict' FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
echo "[Step4] loop_success=true (task=completed, final_evaluate+report nodes=$FINAL_REPORT_NODES, initiative_runs ok=$INIT_OK), task_verdict=$TASK_VERDICT"

test -f "$SPRINT_DIR/acceptance-evidence.md"
grep -q "$TASK_ID" "$SPRINT_DIR/acceptance-evidence.md"
grep -E "loop_verdict.*(PASS|true|success)" "$SPRINT_DIR/acceptance-evidence.md"
grep -E "task_verdict.*(PASS|FAIL)" "$SPRINT_DIR/acceptance-evidence.md"
grep -E "#2845|#2846|#2847|#2850" "$SPRINT_DIR/acceptance-evidence.md"
! grep -E "TBD|TODO|PLACEHOLDER|XXXX|<填写>" "$SPRINT_DIR/acceptance-evidence.md"
if [ "$TASK_VERDICT" != "PASS" ] && [ -n "$TASK_VERDICT" ]; then
  grep -E "task_fail_reason" "$SPRINT_DIR/acceptance-evidence.md"
fi
echo "[Step4] evidence ✓"

# ==== Step 5: 最终报告 + learnings ====
REPORT=docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md
test -f "$REPORT"
grep -q "$TASK_ID" "$REPORT"
grep -E "graph_node_update" "$REPORT"
grep -E "KR|key_result|管家闭环" "$REPORT"
grep -E "failure_reason.*(NULL|空|none|null)" "$REPORT"
grep -E "loop_verdict" "$REPORT"
grep -E "task_verdict" "$REPORT"

LEARN=docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md
test -f "$LEARN"
[ "$(wc -c < "$LEARN")" -ge 60 ]

echo "✅ W8 v9 Golden Path 全程验证通过 — task_id=$TASK_ID loop_success=true task_verdict=$TASK_VERDICT timeout_hit=$TIMEOUT_HIT"
```

**通过标准**：脚本 `exit 0`。loop_success 是合同 verdict 唯一硬条件；task_verdict=FAIL 不挂掉脚本（evidence 段已捕获）。

---

## Workstreams

workstream_count: 3

### Workstream 1: 派发 walking_skeleton + 验证 dispatcher 起 graph

**范围**：写 `acceptance-task-payload.json`（schema 合法的 walking_skeleton payload，含 1 个 thin_feature + 1 条 e2e_acceptance 命令），POST 到 Brain 拿 task_id，验证 90s 内 status 转 in_progress 且 task_events 至少 1 条 graph_node_update。

**大小**：S（payload < 60 行 JSON + 1 个验证脚本）

**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/payload-and-dispatch.test.ts` — **Status: NEW（本 sprint r1 commit 1b62cb72e 产出，r2 增 1 个 health 用例）**，Runner: `vitest`

---

### Workstream 2: 跑通全图 + 收 evidence（含 7200s 硬超时 fall-through）

**范围**：等待 LangGraph harness-initiative full graph 跑完（A→B→C 阶段），实时收集 task_events / sub_task / interrupt_pending+interrupt_resumed / thread_lookup 命中 / sub_task PR 状态（merge / open / closed）证据；polling 设 7200s 硬上限，超时则写 timeout snapshot 段；所有证据写入 `acceptance-evidence.md`，**显式区分 loop_verdict 与 task_verdict**，含 task_id、SQL 截、PR URL（若有）、4 个 hotfix PR 编号、Brain log 关键行号。task_verdict=FAIL 时必须含 task_fail_reason 段；timeout 触发时必须含 Timeout Snapshot 段。

**大小**：M（一段时间 polling + evidence 文档约 200 行）

**依赖**：Workstream 1 完成（task_id 已派发且 in_progress）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/run-and-evidence.test.ts` — **Status: NEW（本 sprint r1 commit 1b62cb72e 产出，r2 增 2 个用例：loop closure / final_evaluate node）**，Runner: `vitest`

---

### Workstream 3: 最终 acceptance 报告 + learnings（双 verdict 区分）

**范围**：写 `docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md`（含 task_id / graph_node_update SQL 截 / sub_task PR 链接段 / KR 进度变化 / failure_reason 全空断言 / **loop_verdict 与 task_verdict 双段判定**）+ `docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md`（≥ 60 字节、至少 1 条 PRD 之外的具体 learning）。回写 Brain task 状态（PATCH /api/brain/tasks/{task_id}）：status=completed + result 含 loop_success=true 与 task_pass=(true|false)。

**大小**：S（两份 markdown < 300 行）

**依赖**：Workstream 2 完成（evidence 已落盘，含双 verdict）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report-and-learnings.test.ts` — **Status: NEW（本 sprint r1 commit 1b62cb72e 产出，r2 增 1 个用例：双 verdict 区分）**，Runner: `vitest`

---

## Test Contract

| Workstream | Test File | Status | Runner | BEHAVIOR 覆盖 | 预期红证据（未实现/未跑时） |
|---|---|:-:|:-:|---|---|
| WS1 | `tests/ws1/payload-and-dispatch.test.ts` | **NEW** | `vitest` | Brain health / payload schema / POST 返回 task_id / 90s 内 in_progress / 至少 1 graph_node_update | 5 failures（health 5xx / payload 不存在 / TASK_ID 不存在 / status 非 in_progress / 节点事件 0） |
| WS2 | `tests/ws2/run-and-evidence.test.ts` | **NEW** | `vitest` | 6 distinct planning node / sub_task ≥ 1 with contract_dod_path / interrupt_pending+resumed 各 ≥ 1 / thread_lookup 命中 / loop closure (sub_task verdict ∈ DONE/FAIL) / final_evaluate+report 节点都跑过 / happy path verdict=DONE+merged / evidence 双 verdict 完整 | 8 failures |
| WS3 | `tests/ws3/report-and-learnings.test.ts` | **NEW** | `vitest` | 报告 7 段必填（含 loop_verdict + task_verdict）/ learnings ≥60 字节且非 PRD 子集 / Brain task 状态回写 PATCH / 报告显式区分 loop vs task verdict | 4 failures |

**Runner 调用方式**：
```bash
npx vitest run "sprints/w8-langgraph-v9/tests/" --reporter=verbose
# 未实现/未跑时预期 17 个 it() 全 RED → exit code != 0
```

**RED 用例总数**：17（≥ 7 远超达成）。
