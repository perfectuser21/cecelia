# Sprint Contract Draft (Round 1)

W8 LangGraph 修正收官验收 — 端到端跑通一次 harness Initiative：14 节点全路径 + sub_task 容器 spawn (带 credentials) + brain kill/resume 实证。**只验收，不改 graph 逻辑。**

## Golden Path

```
[fixture Initiative 派发 (POST /api/brain/tasks task_type=harness_initiative)]
  ↓
[Phase A 5 节点: prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert]
  ↓
[Phase B serial loop: pick_sub_task → run_sub_task (内嵌 harness-task subgraph: spawn → await_callback → parse_callback → poll_ci → merge_pr) → evaluate → advance]
  ↓
[中途 brain 容器 docker restart → checkpoints 表持久化 → 新进程从最近 interrupt 点 resume]
  ↓
[final_evaluate → report]
  ↓
[tasks.status=completed + checkpoints 多条 + walking_skeleton_thread_lookup 含 sub_task 容器 + sub_task spawn env 含 CECELIA_CREDENTIALS + dev_records 写入 1 条 sub_task PR + resume 前后无重复节点写]
```

合计被走过的不同节点 ≥ 14：

- Initiative 顶层（10）：`prep` / `planner` / `parsePrd` / `ganLoop` / `inferTaskPlan` / `dbUpsert` / `pick_sub_task` / `run_sub_task` / `evaluate` / `advance`（或 `retry`/`terminal_fail` 边界路径）/ `final_evaluate` / `report`
- Sub-graph harness-task（6）：`spawn` / `await_callback` / `parse_callback` / `poll_ci` / `merge_pr` /（边界）`fix_dispatch`

PRD 列的 14 节点 = Initiative 顶层 8 个核心 + harness-task sub-graph 6 个，本合同以"被实际遍历的节点集合 ≥ PRD 列的 14 个"为通过标准。

---

### Step 1: fixture Initiative 派发，Brain 接收并转入 in_progress

**可观测行为**：测试人或 acceptance 脚本把 `acceptance-fixture.json` POST 到 Brain `/api/brain/tasks`，Brain 落库 `tasks` 表一条 `task_type=harness_initiative` 的记录，dispatcher 把它转入 `in_progress`，且把 `payload.prd_content` 持久化下来供 `prepInitiativeNode` 读取。

**验证命令**：
```bash
# 1) fixture 文件必须存在且 schema 合法
test -f sprints/w8-langgraph-v8/acceptance-fixture.json
jq -e '.task_type=="harness_initiative" and (.payload.prd_content|length)>200 and (.payload.task_plan|length>=1)' \
  sprints/w8-langgraph-v8/acceptance-fixture.json
# 期望：jq exit 0（task_type 正确 + PRD ≥ 200 字符 + 至少 1 个 sub_task）

# 2) 派发后 5 分钟内 tasks 表应有该 task 且进 in_progress 或 completed（不许 stuck queued）
psql "$DB" -t -c "SELECT count(*) FROM tasks
  WHERE id='$TASK_ID'
    AND task_type='harness_initiative'
    AND status IN ('in_progress','completed')
    AND created_at > NOW() - interval '5 minutes'" | tr -d ' '
# 期望：count = 1
```

**硬阈值**：fixture 合法 + 5 分钟内 task 进入 in_progress/completed（防 dispatcher 卡 queued 假绿）。

---

### Step 2: Phase A 5 节点跑通（prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert）

**可观测行为**：Brain 在 fixture 派发后将 Initiative 推进通 Phase A 全部节点；任务 plan 被解析后写入 `initiative_runs` / `initiative_contracts` 表；checkpoints 表为该 thread_id 写入至少 5 条 checkpoint（每个节点至少 1）。

**验证命令**：
```bash
# checkpoints 表应有 thread_id 包含 task_id 的多条 checkpoint（每节点 >= 1）
psql "$DB" -t -c "SELECT count(DISTINCT checkpoint_id) FROM checkpoints
  WHERE thread_id LIKE '%${TASK_ID}%'" | tr -d ' '
# 期望：>= 5（5 个 Phase A 节点各 1，加上 START/END）

# initiative_contracts 表应有该 task 的 1 条记录（dbUpsert 写入）
psql "$DB" -t -c "SELECT count(*) FROM initiative_contracts
  WHERE task_id='$TASK_ID'
    AND created_at > NOW() - interval '10 minutes'" | tr -d ' '
# 期望：= 1
```

**硬阈值**：checkpoints distinct id ≥ 5，且 initiative_contracts 当窗口内写入 1 条。

---

### Step 3: pick_sub_task 选中 + run_sub_task 触发 harness-task sub-graph spawn

**可观测行为**：Initiative 进 serial 循环，`pick_sub_task` 选中第 1 个 sub_task，`run_sub_task` 调内嵌 `harness-task` 图的 `spawn` 节点真 spawn 一个 sibling docker 容器；spawn 时调 `resolveAccount` 把 `CECELIA_CREDENTIALS` + `CECELIA_MODEL` 注入容器 env；spawn 后立即写 `walking_skeleton_thread_lookup` 表（graph_name='harness-task'）。

**验证命令**：
```bash
# walking_skeleton_thread_lookup 应有 graph_name='harness-task' + thread_id 含 task_id 的至少 1 条
psql "$DB" -t -c "SELECT count(*) FROM walking_skeleton_thread_lookup
  WHERE graph_name='harness-task'
    AND thread_id LIKE 'harness-task:${TASK_ID}:%'
    AND created_at > NOW() - interval '10 minutes'" | tr -d ' '
# 期望：>= 1

# 容器 inspect 验 CECELIA_CREDENTIALS 真的注入（而非 undefined / 空字符串）
CONTAINER_ID=$(psql "$DB" -t -c "SELECT container_id FROM walking_skeleton_thread_lookup
  WHERE graph_name='harness-task' AND thread_id LIKE 'harness-task:${TASK_ID}:%'
  ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
test -n "$CONTAINER_ID"
docker inspect "$CONTAINER_ID" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^CECELIA_CREDENTIALS=.+' >/dev/null
# 期望：grep exit 0（行存在且 = 后非空）
```

**硬阈值**：thread_lookup 写入 ≥ 1 条 + 容器 env 含非空 CECELIA_CREDENTIALS。

---

### Step 4: harness-task sub-graph 走完 spawn → await_callback → parse_callback → poll_ci → merge_pr

**可观测行为**：sub_task 容器跑完后通过 callback router POST 回 Brain，`parseCallbackNode` 解析回执，`pollCiNode` 等 CI 绿，`mergePrNode` merge PR；`pr-callback-handler` 写入 `dev_records` 表 1 条带 pr_url 的记录；callback 处理完整链路在 30 分钟阈值内完成（防 await_callback 永久 stuck 假绿）。

**验证命令**：
```bash
# dev_records 表应有 task_id=该 sub_task 的记录 + pr_url 非空 + merged_at 在 30 分钟内
psql "$DB" -t -c "SELECT count(*) FROM dev_records
  WHERE task_id IN (
    SELECT id FROM tasks WHERE payload->>'parent_task_id'='$TASK_ID'
  )
  AND pr_url IS NOT NULL AND length(pr_url) > 10
  AND merged_at IS NOT NULL
  AND merged_at > NOW() - interval '30 minutes'" | tr -d ' '
# 期望：>= 1

# checkpoints 表 sub-graph thread_id 应见 spawn / await_callback / parse_callback / poll_ci / merge_pr 5 个节点 metadata
psql "$DB" -t -c "SELECT count(DISTINCT checkpoint_id) FROM checkpoints
  WHERE thread_id LIKE 'harness-task:${TASK_ID}:%'" | tr -d ' '
# 期望：>= 5
```

**硬阈值**：dev_records 30 分钟窗口内当 task 链上写入 ≥ 1 条 + sub-graph checkpoints 不同 id ≥ 5。

---

### Step 5: brain kill/resume 实证（docker restart brain 中途触发）

**可观测行为**：在 sub_task 容器还在 await_callback interrupt 时，acceptance 脚本对 brain 容器执行 `docker restart`；Brain 进程重启后，callback router 用 `walking_skeleton_thread_lookup` 反查到 thread_id，用 `Command(resume)` 唤回；graph 从最近 checkpoint 续跑，且**已完成节点不重复执行**（spawn 节点幂等门 + Phase A 节点幂等门生效）。

**验证命令**：
```bash
# checkpoints 表对该 thread_id 应有 parent_checkpoint_id 链 — 证明真 resume 而非重跑
psql "$DB" -t -c "SELECT count(*) FROM checkpoints
  WHERE thread_id LIKE '%${TASK_ID}%'
    AND parent_checkpoint_id IS NOT NULL" | tr -d ' '
# 期望：>= 3

# Brain 服务在 acceptance 窗口内确实重启过（uptime 短于 acceptance 总时长）
BRAIN_START=$(docker inspect brain --format '{{.State.StartedAt}}')
ACCEPTANCE_START=$(psql "$DB" -t -c "SELECT created_at FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
# Brain restart 应晚于 task 创建（证明 acceptance 期间发生了 restart）
test "$(date -d "$BRAIN_START" +%s)" -gt "$(date -d "$ACCEPTANCE_START" +%s)"

# spawn 节点幂等：containerId 在 thread_lookup 中只有 1 条 per (initiative, sub_task)
psql "$DB" -t -c "SELECT count(*) FROM walking_skeleton_thread_lookup
  WHERE graph_name='harness-task'
    AND thread_id LIKE 'harness-task:${TASK_ID}:%'
  GROUP BY thread_id HAVING count(*) > 1" | tr -d ' '
# 期望：空（GROUP BY HAVING 无行 — 没有 thread_id 出现 > 1 次）
```

**硬阈值**：≥ 3 条带 parent_checkpoint_id 的链式 checkpoint + brain restart 时间晚于 task 创建 + 无 thread_id 出现 > 1 次（证明幂等）。

---

### Step 6: evaluate → advance / retry → final_evaluate → report 跑完，task 终态 completed

**可观测行为**：sub_task merge 后 `evaluate` 节点判 PASS/FAIL，PASS 走 `advance` 推进，FAIL ≤ 2 轮走 `retry`；所有 sub_task 走完后 `final_evaluate` 做 E2E 验证，`report` 写最终回执；Brain 把 task `tasks.status` 改为 `completed`，`result.merged=true`。

**验证命令**：
```bash
# 最终 task 终态 completed
psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TASK_ID'" | tr -d ' '
# 期望：completed

# result.merged=true（mergePr 真合过 PR）
psql "$DB" -t -c "SELECT (result->>'merged')::boolean FROM tasks WHERE id='$TASK_ID'" | tr -d ' '
# 期望：t (true)

# 对 same task 的 dev_records 至少 1 条带 pr_url（覆盖 merge_pr → pr_callback 链路）
psql "$DB" -t -c "SELECT count(*) FROM dev_records
  WHERE task_id IN (
    SELECT id FROM tasks
    WHERE payload->>'parent_task_id'='$TASK_ID' OR id='$TASK_ID'
  ) AND merged_at IS NOT NULL" | tr -d ' '
# 期望：>= 1
```

**硬阈值**：tasks.status=completed + result.merged=true + dev_records 链上 ≥ 1 条 merged 记录。

---

### Step 7: 验收报告 + 节点轨迹证据物落库

**可观测行为**：acceptance 脚本跑完后产出 `sprints/w8-langgraph-v8/acceptance-report.md`，含**真实采集**的节点轨迹表（每节点 1 行：节点名 / 进入时间 / 出口状态）+ checkpoint 总数 + resume 前后 brain 启动时间戳 + sub_task 容器 inspect 输出 CECELIA_CREDENTIALS 注入证据；不允许 placeholder（如 `TODO`/`待填`）。

**验证命令**：
```bash
test -f sprints/w8-langgraph-v8/acceptance-report.md
# 节点轨迹表至少含 14 行（node ≥ 14）
NODES=$(grep -cE '^\| (prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|retry|terminal_fail|final_evaluate|report|spawn|await_callback|parse_callback|poll_ci|merge_pr|fix_dispatch) \|' \
  sprints/w8-langgraph-v8/acceptance-report.md)
[ "$NODES" -ge 14 ] || exit 1

# 报告中含真实 task_id（不是 fixture 占位 <TASK_ID>）
grep -E '\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b' \
  sprints/w8-langgraph-v8/acceptance-report.md >/dev/null

# 报告中无未填占位
! grep -E '\bTODO\b|<placeholder>|待填|tbd' sprints/w8-langgraph-v8/acceptance-report.md
```

**硬阈值**：报告含节点轨迹 ≥ 14 行 + 真实 UUID + 无 TODO/待填 placeholder。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本** `sprints/w8-langgraph-v8/scripts/run-acceptance.sh`：

```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v8"
FIXTURE="${SPRINT_DIR}/acceptance-fixture.json"

# ---------- Step 1: 派发 fixture Initiative ----------
test -f "$FIXTURE"
jq -e '.task_type=="harness_initiative" and (.payload.prd_content|length)>200 and (.payload.task_plan|length>=1)' "$FIXTURE"

TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  --data @"$FIXTURE" | jq -r '.id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]
ACCEPTANCE_START_EPOCH=$(date +%s)
echo "✅ Step 1: 派发 task_id=$TASK_ID"

# 等 dispatcher 把 task 转 in_progress（最多 60s）
for i in $(seq 1 60); do
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "in_progress" ] || [ "$STATUS" = "completed" ] && break
  sleep 1
done
[ "$STATUS" = "in_progress" ] || [ "$STATUS" = "completed" ]

# ---------- Step 2: Phase A ----------
# 等 dbUpsert 跑完写 initiative_contracts（最多 600s — Phase A 含 ganLoop 多轮 LLM）
for i in $(seq 1 600); do
  CT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_contracts WHERE task_id='$TASK_ID'" | tr -d ' ')
  [ "$CT" -ge 1 ] && break
  sleep 1
done
[ "$CT" -ge 1 ]
CHKPT=$(psql "$DB" -t -c "SELECT count(DISTINCT checkpoint_id) FROM checkpoints WHERE thread_id LIKE '%${TASK_ID}%'" | tr -d ' ')
[ "$CHKPT" -ge 5 ]
echo "✅ Step 2: Phase A — initiative_contracts=1 + checkpoints=$CHKPT"

# ---------- Step 3: sub_task spawn + credentials ----------
# 等 thread_lookup 写入 sub-graph 容器（最多 300s）
for i in $(seq 1 300); do
  CID=$(psql "$DB" -t -c "SELECT container_id FROM walking_skeleton_thread_lookup
    WHERE graph_name='harness-task' AND thread_id LIKE 'harness-task:${TASK_ID}:%'
    ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ -n "$CID" ] && break
  sleep 1
done
[ -n "$CID" ]
docker inspect "$CID" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^CECELIA_CREDENTIALS=.+' >/dev/null
echo "✅ Step 3: sub_task 容器 $CID env 含 CECELIA_CREDENTIALS"

# ---------- Step 5: brain kill/resume（提前在 sub_task 仍 running 时触发） ----------
# sub_task 在 await_callback 时窗口内 docker restart brain
sleep 5  # 让 sub_task 容器进 await_callback interrupt
docker restart brain
# 等 brain 健康检查回来
for i in $(seq 1 60); do
  curl -fsS localhost:5221/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS localhost:5221/health >/dev/null
echo "✅ Step 5a: brain restart 完成"

# ---------- Step 4 & 6: 等 task 终态 completed（最多 1800s = 30 分钟阈值） ----------
for i in $(seq 1 1800); do
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && { echo "❌ task failed"; exit 1; }
  sleep 1
done
[ "$STATUS" = "completed" ]

MERGED=$(psql "$DB" -t -c "SELECT (result->>'merged')::boolean FROM tasks WHERE id='$TASK_ID'" | tr -d ' ')
[ "$MERGED" = "t" ]

DEVRECS=$(psql "$DB" -t -c "SELECT count(*) FROM dev_records
  WHERE task_id IN (SELECT id FROM tasks WHERE payload->>'parent_task_id'='$TASK_ID' OR id='$TASK_ID')
    AND merged_at IS NOT NULL
    AND merged_at > NOW() - interval '30 minutes'" | tr -d ' ')
[ "$DEVRECS" -ge 1 ]
echo "✅ Step 4 & 6: task completed, merged=true, dev_records=$DEVRECS"

# ---------- Step 5b: resume 链证据 ----------
RESUME_LINKS=$(psql "$DB" -t -c "SELECT count(*) FROM checkpoints
  WHERE thread_id LIKE '%${TASK_ID}%' AND parent_checkpoint_id IS NOT NULL" | tr -d ' ')
[ "$RESUME_LINKS" -ge 3 ]

DUP=$(psql "$DB" -t -c "SELECT count(*) FROM (
  SELECT thread_id FROM walking_skeleton_thread_lookup
  WHERE graph_name='harness-task' AND thread_id LIKE 'harness-task:${TASK_ID}:%'
  GROUP BY thread_id HAVING count(*) > 1
) dups" | tr -d ' ')
[ "$DUP" = "0" ]
echo "✅ Step 5b: resume 链 ≥ 3, 无幂等违反"

# ---------- Step 7: 报告产出物 ----------
test -f "${SPRINT_DIR}/acceptance-report.md"
NODE_LINES=$(grep -cE '^\| (prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|retry|terminal_fail|final_evaluate|report|spawn|await_callback|parse_callback|poll_ci|merge_pr|fix_dispatch) \|' "${SPRINT_DIR}/acceptance-report.md")
[ "$NODE_LINES" -ge 14 ]
grep -E "$TASK_ID" "${SPRINT_DIR}/acceptance-report.md" >/dev/null
! grep -E '\bTODO\b|<placeholder>|待填|tbd' "${SPRINT_DIR}/acceptance-report.md"
echo "✅ Step 7: acceptance-report.md 含节点轨迹 $NODE_LINES 行 + 真实 task_id"

echo "🎉 W8 LangGraph 收官验收 — Golden Path 全程通过"
```

**通过标准**：脚本 `exit 0`。任何一步失败立即退出非 0。

**反作弊关键时间窗约束**：
- Step 1 tasks.created_at < 5 分钟（防 INSERT 历史 task 假绿）
- Step 2 initiative_contracts.created_at < 10 分钟
- Step 3 thread_lookup.created_at < 10 分钟 + docker inspect 必须命中真实 env
- Step 4 dev_records.merged_at < 30 分钟
- Step 5 brain StartedAt > tasks.created_at（证明 acceptance 期间真发生了 restart）
- Step 7 报告必须含真实 UUID（防全 placeholder 蒙混）

---

## Workstreams

workstream_count: 3

### Workstream 1: acceptance-fixture（最短 Golden Path 派发载荷）

**范围**：在 `sprints/w8-langgraph-v8/acceptance-fixture.json` 写一个最小合法 harness Initiative 派发体；含 task_type / payload.prd_content（≥ 200 字符）/ payload.task_plan（1 个 sub_task） / payload.fixture_marker=true（acceptance 标记，便于事后 SELECT）。
**大小**：S（< 100 行 JSON + JSDoc 注释）
**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/fixture-shape.test.ts`

---

### Workstream 2: 集成测试（mock 层 14 节点 + checkpoint resume + credentials 注入）

**范围**：在 `packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js` 写 vitest 集成测试：
- 用 `MemorySaver` 编译 `compileHarnessFullGraph()`，mock spawn / docker / pool / resolveAccount / parseTaskPlan / runGanContractGraph，让 graph 真走完 14 节点
- 第一次 invoke 让 sub-graph 在 `await_callback` interrupt（mock spawn 不立即 callback）
- 第二次 invoke 用 `Command(resume:{...})` 唤回 → 走完 → 断言：
  - `compiled.getState(config).values.report_path` 非空
  - mock spawn 被调用次数 = sub_task 数（不重 spawn）
  - mock spawn 调用 args 含 `env.CECELIA_CREDENTIALS`
  - 14 节点（含 sub-graph 6 节点）的 mock 函数 call count ≥ 1（用 spy 验）
  - resume 前后已完成节点不重跑（幂等门生效）

**大小**：M（200-400 行）
**依赖**：Workstream 1（fixture 提供 prd_content 给 prep 节点 mock）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/w8-acceptance.integration.test.ts`

---

### Workstream 3: 验收脚本 + 报告 generator + 报告 schema 校验

**范围**：
- `sprints/w8-langgraph-v8/scripts/run-acceptance.sh`：上面 E2E 完整脚本（实环境跑）
- `sprints/w8-langgraph-v8/scripts/generate-report.mjs`：从 PG 拉 task_id 的 checkpoints / thread_lookup / dev_records / docker inspect 输出，生成 `acceptance-report.md`（节点轨迹表 + 计数 + brain 启动时间戳）
- `sprints/w8-langgraph-v8/acceptance-report.template.md`：模板（合同里允许 placeholder，但 generate-report 必须把它们全部替换成真值）
- `sprints/w8-langgraph-v8/acceptance-report.md`：脚本运行后产出（首版可仅产出含 fixture_marker=false 的占位 + DRY_RUN=1 模式可生成 sample）

**大小**：M（脚本 200 行 + report generator 150 行 + 模板 100 行）
**依赖**：Workstream 2（集成测试 PASS 后才有信心实环境跑）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report-generator.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/fixture-shape.test.ts` | (1) fixture JSON 解析合法 (2) task_type=harness_initiative (3) payload.prd_content ≥ 200 字符 (4) payload.task_plan 至少 1 个 sub_task 且每个 sub_task 含 id/title/dod (5) fixture_marker=true | WS1 → 5 failures（fixture 不存在） |
| WS2 | `tests/ws2/w8-acceptance.integration.test.ts` | (1) full graph 编译不崩 (2) 第一次 invoke 后 state 在 `pick_sub_task` 之后某节点（不是 START）(3) sub-graph 第一次 invoke 后停在 `await_callback` interrupt (4) Command(resume) 唤回 graph 走到 `report` 节点 (5) sub_task spawn mock 被调用 args.env 含 CECELIA_CREDENTIALS (6) resume 前后 spawn mock 总调用次数 = sub_task 数 (7) prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report 节点 mock 各 ≥ 1 次（顶层 12 节点）(8) sub-graph spawn/await_callback/parse_callback/poll_ci/merge_pr 节点各 ≥ 1 次（sub-graph 5 节点） | WS2 → 8 failures（测试文件不存在） |
| WS3 | `tests/ws3/report-generator.test.ts` | (1) generate-report.mjs 在 DRY_RUN=1 下不连 PG 也能输出含 14 行 node 轨迹的 markdown (2) generate-report 接 task_id 参数后产出含该 UUID 的报告 (3) report 内不含 TODO/待填/placeholder 字面量 (4) run-acceptance.sh 含 `set -euo pipefail` (5) run-acceptance.sh 中所有 psql count 查询都附时间窗口（grep `interval '` 至少 5 处） | WS3 → 5 failures（脚本/generator 不存在） |

合计预期红 = 5 + 8 + 5 = **18 failures**（命令 `npx vitest run sprints/w8-langgraph-v8/tests/ --reporter=verbose` 应见 ≥ 18 个 fail）。
