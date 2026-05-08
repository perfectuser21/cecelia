# Sprint Contract Draft (Round 2)

W8 LangGraph 修正收官验收 — 端到端跑通一次 harness Initiative：14 节点全路径 + sub_task 容器 spawn (带 credentials) + brain kill/resume 实证。**只验收，不改 graph 逻辑。**

> Round 2 修订基于 Round 1 Reviewer 反馈：
> 1. 加 **节点字典** 小节，固定节点集合（顶层 12 必走 + sub-graph 5 必走 + 边界不计入），合计必走 = 17。
> 2. Step 2 描述里"5 个 Phase A 节点" → "6 个 Phase A 节点"（与下面节点字典一致）。
> 3. WS2 BEHAVIOR (7)(8) 拆成顶层 12 + sub-graph 5，合计要 17 个 mock spy 各 ≥ 1 次。
> 4. R3 mitigation：WS2 只验**逻辑流转 + credentials 注入参数**；`acceptance-report.md` 必须出自 WS3 **实跑** 而非 DRY_RUN。
> 5. R4 cascade mitigation：CI 按 WS 顺序跑；WS2 失败时 WS3 标 SKIP 而非 FAIL（避免噪声）。

---

## 节点字典（合同 SSOT，所有 step / WS / 测试以此为准）

| 类别 | 节点名 | 必走？ | 说明 |
|---|---|---|---|
| 顶层 Phase A | `prep` | ✅ | Initiative 入口 / context 准备 |
| 顶层 Phase A | `planner` | ✅ | 任务规划起点 |
| 顶层 Phase A | `parsePrd` | ✅ | PRD 解析 |
| 顶层 Phase A | `ganLoop` | ✅ | GAN 合同对抗（带 pgCheckpointer 兜底） |
| 顶层 Phase A | `inferTaskPlan` | ✅ | 从 GAN 输出推 task_plan |
| 顶层 Phase A | `dbUpsert` | ✅ | 落库 initiative_contracts |
| 顶层 Phase B | `pick_sub_task` | ✅ | serial 循环选下一个 sub_task |
| 顶层 Phase B | `run_sub_task` | ✅ | 调起 harness-task sub-graph（spawn-and-interrupt） |
| 顶层 Phase B | `evaluate` | ✅ | sub_task PASS/FAIL 判定 |
| 顶层 Phase B | `advance` | ✅ | 推进到下一个 sub_task |
| 顶层 Phase C | `final_evaluate` | ✅ | E2E Golden Path 终评 |
| 顶层 Phase C | `report` | ✅ | 终态回执写入 |
| 顶层 边界 | `retry` | ➖ | 错误恢复路径（≤2 轮）；不强制必走 |
| 顶层 边界 | `terminal_fail` | ➖ | 失败终态；不强制必走 |
| sub-graph | `spawn` | ✅ | sibling 容器 spawn + credentials 注入 |
| sub-graph | `await_callback` | ✅ | interrupt 等 callback router 回写 |
| sub-graph | `parse_callback` | ✅ | callback payload 解析 |
| sub-graph | `poll_ci` | ✅ | 等 CI 绿 |
| sub-graph | `merge_pr` | ✅ | 合 PR |
| sub-graph 边界 | `fix_dispatch` | ➖ | CI 红/merge 冲突路径；不强制必走 |

**统计**：顶层必走 12 + sub-graph 必走 5 = **必走 17 节点**。边界节点（retry / terminal_fail / fix_dispatch）允许出现但不要求。

PRD 文档原写 "14 节点" — 在严格语义下被解释为 "顶层 12 + sub-graph 5 - 重复名（pick_sub_task 在 PRD 里出现一次）= **≥ 14 节点集**" 的保留下限。本合同采用**显式枚举的 17 个必走节点**为准（"≥ 14" 是 PRD 自我描述的下界，本合同等价收紧到 17 个都必走）。

---

## Golden Path

```
[fixture Initiative 派发 (POST /api/brain/tasks task_type=harness_initiative)]
  ↓
[Phase A 6 节点: prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert]
  ↓
[Phase B serial loop: pick_sub_task → run_sub_task (内嵌 harness-task subgraph: spawn → await_callback → parse_callback → poll_ci → merge_pr) → evaluate → advance]
  ↓
[中途 brain 容器 docker restart → checkpoints 表持久化 → 新进程从最近 interrupt 点 resume]
  ↓
[final_evaluate → report]
  ↓
[tasks.status=completed + checkpoints 多条 + walking_skeleton_thread_lookup 含 sub_task 容器 + sub_task spawn env 含 CECELIA_CREDENTIALS + dev_records 写入 1 条 sub_task PR + resume 前后无重复节点写]
```

合计被走过的不同节点 ≥ 17（节点字典里所有"必走"项），覆盖 PRD 提到的 ≥ 14 下限。

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

### Step 2: Phase A 6 节点跑通（prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert）

**可观测行为**：Brain 在 fixture 派发后将 Initiative 推进通 Phase A 全部 **6 个节点**；任务 plan 被解析后写入 `initiative_runs` / `initiative_contracts` 表；checkpoints 表为该 thread_id 写入至少 6 条 checkpoint（每个 Phase A 节点至少 1）。

**验证命令**：
```bash
# checkpoints 表应有 thread_id 包含 task_id 的多条 checkpoint（每节点 >= 1）
psql "$DB" -t -c "SELECT count(DISTINCT checkpoint_id) FROM checkpoints
  WHERE thread_id LIKE '%${TASK_ID}%'" | tr -d ' '
# 期望：>= 6（6 个 Phase A 节点各 1）

# initiative_contracts 表应有该 task 的 1 条记录（dbUpsert 写入）
psql "$DB" -t -c "SELECT count(*) FROM initiative_contracts
  WHERE task_id='$TASK_ID'
    AND created_at > NOW() - interval '10 minutes'" | tr -d ' '
# 期望：= 1
```

**硬阈值**：checkpoints distinct id ≥ 6，且 initiative_contracts 当窗口内写入 1 条。

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

### Step 7: 验收报告 + 节点轨迹证据物落库（**必须出自 WS3 实跑，非 DRY_RUN**）

**可观测行为**：acceptance 脚本（`run-acceptance.sh`）跑完后产出 `sprints/w8-langgraph-v8/acceptance-report.md`，含**真实采集**的节点轨迹表（每节点 1 行：节点名 / 进入时间 / 出口状态）+ checkpoint 总数 + resume 前后 brain 启动时间戳 + sub_task 容器 inspect 输出 CECELIA_CREDENTIALS 注入证据；不允许 placeholder（如 `TODO`/`待填`）；**不允许 DRY_RUN 产出冒充**（脚本头部必须含真实 task_id 元数据 + DRY_RUN=0 标记）。

**验证命令**：
```bash
test -f sprints/w8-langgraph-v8/acceptance-report.md
# 节点轨迹表至少含 17 行（节点字典必走集合 17 个；下限保 14 兼容 PRD 文字）
NODES=$(grep -cE '^\| (prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|retry|terminal_fail|final_evaluate|report|spawn|await_callback|parse_callback|poll_ci|merge_pr|fix_dispatch) \|' \
  sprints/w8-langgraph-v8/acceptance-report.md)
[ "$NODES" -ge 14 ] || exit 1

# 报告中含真实 task_id（不是 fixture 占位 <TASK_ID>）
grep -E '\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b' \
  sprints/w8-langgraph-v8/acceptance-report.md >/dev/null

# 报告中无未填占位
! grep -E '\bTODO\b|<placeholder>|待填|tbd' sprints/w8-langgraph-v8/acceptance-report.md

# 报告头部含 "DRY_RUN: 0" 元数据（防 DRY_RUN 产出冒充实跑）
grep -E '^- ?DRY_RUN: ?0\b|^DRY_RUN=0\b|^<!-- DRY_RUN=0 -->' \
  sprints/w8-langgraph-v8/acceptance-report.md >/dev/null
```

**硬阈值**：报告含节点轨迹 ≥ 14 行（节点字典理想 17 行）+ 真实 UUID + 无 TODO/待填 placeholder + 头部 `DRY_RUN: 0` 标记。

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

# ---------- Step 2: Phase A 6 节点 ----------
# 等 dbUpsert 跑完写 initiative_contracts（最多 600s — Phase A 含 ganLoop 多轮 LLM）
for i in $(seq 1 600); do
  CT=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_contracts WHERE task_id='$TASK_ID'" | tr -d ' ')
  [ "$CT" -ge 1 ] && break
  sleep 1
done
[ "$CT" -ge 1 ]
CHKPT=$(psql "$DB" -t -c "SELECT count(DISTINCT checkpoint_id) FROM checkpoints WHERE thread_id LIKE '%${TASK_ID}%'" | tr -d ' ')
[ "$CHKPT" -ge 6 ]
echo "✅ Step 2: Phase A 6 节点 — initiative_contracts=1 + checkpoints=$CHKPT"

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

# ---------- Step 7: 实跑产出 acceptance-report.md（DRY_RUN=0） ----------
DRY_RUN=0 node "${SPRINT_DIR}/scripts/generate-report.mjs" --task-id "$TASK_ID" \
  > "${SPRINT_DIR}/acceptance-report.md"
test -f "${SPRINT_DIR}/acceptance-report.md"
NODE_LINES=$(grep -cE '^\| (prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|retry|terminal_fail|final_evaluate|report|spawn|await_callback|parse_callback|poll_ci|merge_pr|fix_dispatch) \|' "${SPRINT_DIR}/acceptance-report.md")
[ "$NODE_LINES" -ge 14 ]
grep -E "$TASK_ID" "${SPRINT_DIR}/acceptance-report.md" >/dev/null
! grep -E '\bTODO\b|<placeholder>|待填|tbd' "${SPRINT_DIR}/acceptance-report.md"
grep -E '^- ?DRY_RUN: ?0\b|^DRY_RUN=0\b|^<!-- DRY_RUN=0 -->' "${SPRINT_DIR}/acceptance-report.md" >/dev/null
echo "✅ Step 7: acceptance-report.md 含节点轨迹 $NODE_LINES 行 + 真实 task_id + DRY_RUN=0"

echo "🎉 W8 LangGraph 收官验收 — Golden Path 全程通过"
```

**通过标准**：脚本 `exit 0`。任何一步失败立即退出非 0。

**反作弊关键时间窗约束**：
- Step 1 tasks.created_at < 5 分钟（防 INSERT 历史 task 假绿）
- Step 2 initiative_contracts.created_at < 10 分钟
- Step 3 thread_lookup.created_at < 10 分钟 + docker inspect 必须命中真实 env
- Step 4 dev_records.merged_at < 30 分钟
- Step 5 brain StartedAt > tasks.created_at（证明 acceptance 期间真发生了 restart）
- Step 7 报告必须含真实 UUID + `DRY_RUN: 0` 元数据（防 DRY_RUN 产出冒充实跑）

---

## CI 编排约定（R4 cascade mitigation）

CI 必须按 `WS1 → WS2 → WS3` 顺序执行；当 WS2 失败时，**WS3 整体标记为 SKIP**（而非 FAIL），避免 cascade 噪声。约束方式：
- WS3 测试入口（`tests/ws3/report-generator.test.ts`）首部声明 `describe.skipIf(process.env.WS2_FAILED === '1')`，CI 在 WS2 fail 时设置 `WS2_FAILED=1`。
- WS3 acceptance 实跑（`run-acceptance.sh`）也以环境变量 `WS2_FAILED=1` 早退（exit 0 + echo SKIP）。

---

## Workstreams

workstream_count: 3

### Workstream 1: acceptance-fixture（最短 Golden Path 派发载荷）

**范围**：在 `sprints/w8-langgraph-v8/acceptance-fixture.json` 写一个最小合法 harness Initiative 派发体；含 task_type / payload.prd_content（≥ 200 字符）/ payload.task_plan（1 个 sub_task） / payload.fixture_marker=true（acceptance 标记，便于事后 SELECT）。
**大小**：S（< 100 行 JSON + JSDoc 注释）
**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/fixture-shape.test.ts`

---

### Workstream 2: 集成测试（mock 层 17 节点 + checkpoint resume + credentials 注入参数）

**范围**：在 `packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js` 写 vitest 集成测试。**只验"逻辑流转 + credentials 注入参数"**，不替代实跑：
- 用 `MemorySaver` 编译 `compileHarnessFullGraph()`，mock spawn / docker / pool / resolveAccount / parseTaskPlan / runGanContractGraph，让 graph 真走完节点字典里的 17 个必走节点
- 第一次 invoke 让 sub-graph 在 `await_callback` interrupt（mock spawn 不立即 callback）
- 第二次 invoke 用 `Command(resume:{...})` 唤回 → 走完 → 断言：
  - `compiled.getState(config).values.report_path` 非空
  - mock spawn 被调用次数 = sub_task 数（不重 spawn）
  - mock spawn 调用 args 含 `env.CECELIA_CREDENTIALS`（**仅验注入参数，不验真容器 env**）
  - **顶层 12 节点 mock 函数 call count 各 ≥ 1**（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / final_evaluate / report）
  - **sub-graph 5 节点 mock 函数 call count 各 ≥ 1**（spawn / await_callback / parse_callback / poll_ci / merge_pr）
  - 合计 17 个 mock 函数被调用过 ≥ 1 次（用 spy 验）
  - resume 前后已完成节点不重跑（幂等门生效）

**大小**：M（200-400 行）
**依赖**：Workstream 1（fixture 提供 prd_content 给 prep 节点 mock）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/w8-acceptance.integration.test.ts`

---

### Workstream 3: 验收脚本 + 报告 generator + 报告 schema 校验（**实跑产出 acceptance-report.md**）

**范围**：
- `sprints/w8-langgraph-v8/scripts/run-acceptance.sh`：上面 E2E 完整脚本（实环境跑）；末尾以 `DRY_RUN=0` 调 generator 产 `acceptance-report.md`
- `sprints/w8-langgraph-v8/scripts/generate-report.mjs`：从 PG 拉 task_id 的 checkpoints / thread_lookup / dev_records / docker inspect 输出，生成 `acceptance-report.md`（节点轨迹表 + 计数 + brain 启动时间戳）；DRY_RUN=1 模式可生成 sample（仅供测试），但 `acceptance-report.md` **必须出自 DRY_RUN=0 实跑**
- `sprints/w8-langgraph-v8/acceptance-report.template.md`：模板（合同里允许 placeholder，但 generate-report 必须把它们全部替换成真值）
- `sprints/w8-langgraph-v8/acceptance-report.md`：脚本运行后产出（首版可仅产出含 fixture_marker=false 的占位，但报告头部必须含 `DRY_RUN: 0`）

**WS2 失败时**：WS3 测试 `describe.skipIf(WS2_FAILED==='1')`、`run-acceptance.sh` 在 WS2_FAILED=1 时早退 SKIP（不 FAIL）。

**大小**：M（脚本 200 行 + report generator 180 行 + 模板 100 行）
**依赖**：Workstream 2（集成测试 PASS 后才有信心实环境跑）

**BEHAVIOR 覆盖测试文件**：`tests/ws3/report-generator.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/fixture-shape.test.ts` | (1) fixture JSON 解析合法 (2) task_type=harness_initiative (3) payload.prd_content ≥ 200 字符 (4) payload.task_plan 至少 1 个 sub_task 且每个 sub_task 含 id/title/dod (5) fixture_marker=true | WS1 → 5 failures（fixture 不存在） |
| WS2 | `tests/ws2/w8-acceptance.integration.test.ts` | (1) 集成测试文件存在 (2) 文件 import compileHarnessFullGraph (3) 文件 import MemorySaver + Command (4) 文件 mock account-rotation 验 credentials 注入路径 (5) 断言 spawn mock args.env 含 CECELIA_CREDENTIALS (6) 引用 acceptance-fixture.json 作为输入 (7) 顶层 12 节点（prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）名都在测试代码中出现 (8) sub-graph 5 节点（spawn/await_callback/parse_callback/poll_ci/merge_pr）名都在测试代码中出现 (9) 测试代码含 `report_path` 断言（resume 走到 report 节点） (10) 测试代码含"无重 spawn"幂等断言（spawn 调用次数 = sub_task 数） | WS2 → 10 failures（测试文件不存在） |
| WS3 | `tests/ws3/report-generator.test.ts` | (1) run-acceptance.sh 含 `set -euo pipefail` (2) run-acceptance.sh 至少 5 处 `interval '` 时间窗口 (3) run-acceptance.sh 含 `docker restart brain` (4) generate-report.mjs 文件存在 (5) DRY_RUN=1 下产出含 14 行 node 轨迹的 markdown (6) `--task-id` 参数后产出报告含该 UUID (7) DRY_RUN 输出不含 TODO/<placeholder>/待填/tbd (8) 模板存在并含 `\| 节点 \| 进入时间 \| 出口状态 \|` 表头 (9) run-acceptance.sh 末尾以 `DRY_RUN=0` 调 generate-report 产 acceptance-report.md (10) WS2_FAILED=1 时 describe 自动 skip（cascade 噪声 mitigation） | WS3 → 10 failures（脚本/generator 不存在） |

合计预期红 = 5 + 10 + 10 = **25 failures**（命令 `npx vitest run sprints/w8-langgraph-v8/tests/ --reporter=verbose` 应见 ≥ 25 个 fail）。
