# Sprint Contract Draft (Round 1)

> **Sprint**: W8 Acceptance v4 — LangGraph 14 节点端到端验证（post PR #2837 deploy）
> **journey_type**: autonomous
> **GAN Layer**: 2a (Proposer)
> **Initiative**: harness-acceptance-v4-2026-05-08
> **Acceptance Task**: `5eb2718b-48c7-43a1-88cb-8995a4b49bff`（同 INITIATIVE_ID，由本 sprint 在 Step 2 派出"acceptance run"子任务）

## Golden Path

```
[post #2837 deploy 校验] → [注册+派发 acceptance v4] → [14 节点 graph_node_update 全过] → [故障注入 A 自愈] → [故障注入 B interrupt → abort] → [故障注入 C watchdog → attempt N+1] → [终态 completed + 报告 + lead 自验 + KR 回写]
```

入口：执行者在 worker_machine（Cecelia Mac mini 主机）`docker exec brain` 可达。
出口：`docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md` 写盘 + `tasks.status='completed'` + KR 管家闭环 ≥ 7/7。

---

### Step 1: 部署一致性校验（前置闸门）

**可观测行为**: Brain 容器内 git HEAD == origin/main（PR #2837 已 deploy）；SKILL.md / harness-gan.graph.js 双修指纹存在；Brain 不在 emergency_brake；无残留 in_progress harness_initiative 任务占用 docker slot；scripts/acceptance/w8-v4/lib.mjs 模块的 `assertBrainImageInSync()` 函数被调用后能直接以非零 exit 阻断后续步骤。

**验证命令**:
```bash
set -e
# 1. Brain 容器代码与 origin/main 一致
BRAIN_HEAD=$(docker exec brain git rev-parse HEAD)
git fetch origin main >/dev/null 2>&1
MAIN_HEAD=$(git rev-parse origin/main)
[ "$BRAIN_HEAD" = "$MAIN_HEAD" ] || { echo "Brain image stale: brain=$BRAIN_HEAD origin/main=$MAIN_HEAD"; exit 1; }

# 2. PR #2837 双修指纹（SKILL Step 4 + graph fallback 同格式）
docker exec brain grep -qF "每轮（含被 REVISION 打回轮）" packages/workflows/skills/harness-contract-proposer/SKILL.md \
  || { echo "SKILL.md Step 4 fix not in container"; exit 1; }
docker exec brain grep -qE 'cp-harness-propose-r\$\{round\}-\$\{taskIdSlice\}' packages/brain/src/workflows/harness-gan.graph.js \
  || { echo "harness-gan.graph.js fallbackProposeBranch fix not in container"; exit 1; }

# 3. emergency_brake 与残留任务
STATE=$(curl -fsS localhost:5221/api/brain/status | jq -r '.brain_state // .state // ""')
[ "$STATE" != "emergency_brake" ] || { echo "Brain in emergency_brake"; exit 1; }
STUCK=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND status='in_progress' AND created_at > NOW() - interval '24 hours'" | tr -d ' ')
[ "$STUCK" -eq 0 ] || { echo "$STUCK stuck harness_initiative tasks in last 24h"; exit 1; }

# 4. helper module 真实存在（WS1 产物）+ 行为正确
node -e "import('./scripts/acceptance/w8-v4/lib.mjs').then(m => { if (typeof m.assertBrainImageInSync !== 'function') process.exit(2); })" \
  || { echo "WS1 helper module missing or assertBrainImageInSync not exported"; exit 1; }
```

**硬阈值**: 4 项全 PASS；命令总耗时 < 60s；任一 fail 即整 sprint FAIL（前置闸门，不重试）。

---

### Step 2: 注册 + 派发 acceptance v4 initiative

**可观测行为**: 通过 Brain API 创建新 `task_type=harness_initiative` task，payload 含 `initiative_id=harness-acceptance-v4-2026-05-08`；立即 dispatch 后 60s 内 task 进入 `in_progress`；不会因为 v1/v2/v3 历史 initiative_id 冲突。

**验证命令**:
```bash
set -e
# 防重派：同 initiative_id 不应已存在 task（与 PRD 假设对齐）
EXIST=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND payload->>'initiative_id'='harness-acceptance-v4-2026-05-08' AND created_at > NOW() - interval '7 days'" | tr -d ' ')
[ "$EXIST" -eq 0 ] || { echo "initiative_id collision: $EXIST existing tasks"; exit 1; }

# 注册
ACC_TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "priority": "P1",
    "payload": {
      "initiative_id": "harness-acceptance-v4-2026-05-08",
      "sprint_dir": "sprints/harness-acceptance-v4",
      "timeout_sec": 1800,
      "thin_feature": {
        "endpoint": "GET /api/brain/harness/health",
        "expected_fields": ["langgraph_version", "last_attempt_at"]
      },
      "e2e_test_path": "tests/e2e/harness-acceptance-smoke.spec.ts"
    }
  }' | jq -r '.task_id // .id')
echo "$ACC_TASK_ID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
  || { echo "register failed, got: $ACC_TASK_ID"; exit 1; }
echo "$ACC_TASK_ID" > /tmp/acc-v4-task-id.txt

# 派发
curl -fsS -X POST localhost:5221/api/brain/dispatch \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$ACC_TASK_ID\"}" | jq -e '.dispatched == true' >/dev/null

# 60s 内进入 in_progress（防止 dispatch 静默失败）
S=""; for i in $(seq 1 30); do
  S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
  [ "$S" = "in_progress" ] && break
  sleep 2
done
[ "$S" = "in_progress" ] || { echo "task not in_progress after 60s, got: $S"; exit 1; }
```

**硬阈值**: task_id 为合法 UUID v4 格式；60s 内 status=in_progress；初始化时 initiative_id 在过去 7 天无冲突。

---

### Step 3: 14 节点 graph_node_update 完整事件流（v3 fail 主验点）

**可观测行为**: DB `task_events` 表对该 ACC_TASK_ID 在派发后 30 分钟内累计 ≥ 14 条 distinct `graph_node_update` 事件，覆盖全部 14 节点 (`prep, planner, parsePrd, ganLoop, inferTaskPlan, dbUpsert, pick_sub_task, run_sub_task, evaluate, advance, retry, terminal_fail, final_evaluate, report`)；尤其 v3 fail 点 `inferTaskPlan` 必有 ≥ 1 条事件，且事件 payload 中 `propose_branch` 字段匹配 `^cp-harness-propose-r\d+-[a-f0-9]{8}$`（PR #2837 修后的 SKILL push 格式）。

**验证命令**:
```bash
set -e
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)
DISPATCH_TS=$(psql "$DB" -t -c "SELECT extract(epoch FROM created_at)::bigint FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')

# 等待 graph 跑完（最多 25 分钟，poll 每 30s）
for i in $(seq 1 50); do
  STATE=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
  [ "$STATE" = "completed" ] && break
  [ "$STATE" = "failed" ] && break
  sleep 30
done

# 1. distinct node count ≥ 14（带 task_id 与 dispatch 后时间窗口防止匹配 v3 残留事件）
NODE_COUNT=$(psql "$DB" -t -c "
  SELECT count(DISTINCT (payload->>'node'))
  FROM task_events
  WHERE task_id='$ACC_TASK_ID'
    AND event_type='graph_node_update'
    AND extract(epoch FROM created_at) >= $DISPATCH_TS
" | tr -d ' ')
[ "$NODE_COUNT" -ge 14 ] || { echo "only $NODE_COUNT distinct graph_node_update nodes, need 14"; exit 1; }

# 2. 14 个节点全覆盖（防止某个节点漏触发，count=14 但是同一节点重复 14 个 race condition 不应发生但显式校验）
EXPECTED='prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance retry terminal_fail final_evaluate report'
for node in $EXPECTED; do
  HIT=$(psql "$DB" -t -c "
    SELECT count(*) FROM task_events
    WHERE task_id='$ACC_TASK_ID'
      AND event_type='graph_node_update'
      AND payload->>'node'='$node'
      AND extract(epoch FROM created_at) >= $DISPATCH_TS
  " | tr -d ' ')
  [ "$HIT" -ge 1 ] || { echo "node $node has 0 events"; exit 1; }
done

# 3. v3 fail 点：inferTaskPlan payload.propose_branch 必匹配 PR #2837 修后格式
INFER_BRANCH=$(psql "$DB" -t -c "
  SELECT payload->>'propose_branch'
  FROM task_events
  WHERE task_id='$ACC_TASK_ID'
    AND event_type='graph_node_update'
    AND payload->>'node'='inferTaskPlan'
    AND extract(epoch FROM created_at) >= $DISPATCH_TS
  ORDER BY created_at LIMIT 1
" | tr -d ' ')
echo "$INFER_BRANCH" | grep -qE '^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$' \
  || { echo "inferTaskPlan propose_branch wrong format: '$INFER_BRANCH' (expect cp-harness-propose-rN-XXXXXXXX)"; exit 1; }

# 4. 兜底：报告生成器 dryrun 能找到所有 14 个节点（保证 WS3 不会在终态 step 才发现数据缺失）
node -e "
  import('./scripts/acceptance/w8-v4/render-report.mjs').then(async m => {
    const report = await m.renderAcceptanceReport({
      taskId: '$ACC_TASK_ID', dispatchTs: $DISPATCH_TS, mode: 'dryrun-nodes-only'
    });
    if (!report.includes('14/14')) { console.error('report renderer cannot tally 14/14'); process.exit(2); }
  });
"
```

**硬阈值**: distinct node count ≥ 14；每个 expected node ≥ 1 事件；inferTaskPlan.payload.propose_branch 必匹配 `^cp-harness-propose-r[1-9]\d*-[a-f0-9]{8}$`；renderer dryrun 输出含 "14/14"。**任一 fail = sprint FAIL**（gating Feature 0）。

---

### Step 4: 故障注入 A — Docker SIGKILL 自愈

**可观测行为**: 在某 LLM_RETRY 节点（preferably `run_sub_task`）执行中 docker kill 该容器；W6 Promise 立即 reject + W2 LLM_RETRY 自动重试 ≤ 3 次；子任务最终 PASS（task 不进入 failed）；无人工干预。

**验证命令**:
```bash
set -e
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)

# 找到为该 task 跑的 docker container（label 形式）
TARGET=$(docker ps --filter "label=cecelia.task_id=$ACC_TASK_ID" --format '{{.Names}}' | head -1)
[ -n "$TARGET" ] || { echo "no docker container labeled with task_id=$ACC_TASK_ID"; exit 1; }

INJECT_TS=$(date -u +%s)
docker kill "$TARGET" >/dev/null
echo "$INJECT_TS" > /tmp/acc-v4-inject-a-ts.txt

# 5min 内出现 ≥1 条 llm_retry 事件
RETRY_COUNT=0
for i in $(seq 1 30); do
  RETRY_COUNT=$(psql "$DB" -t -c "
    SELECT count(*) FROM task_events
    WHERE task_id='$ACC_TASK_ID'
      AND event_type='llm_retry'
      AND extract(epoch FROM created_at) > $INJECT_TS
  " | tr -d ' ')
  [ "$RETRY_COUNT" -ge 1 ] && break
  sleep 10
done
[ "$RETRY_COUNT" -ge 1 ] || { echo "no llm_retry event 5min after docker kill"; exit 1; }
[ "$RETRY_COUNT" -le 3 ] || { echo "llm_retry over cap: $RETRY_COUNT > 3"; exit 1; }

# task 没死（仍在跑或已完成，不能是 failed）
sleep 90
S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
[ "$S" = "in_progress" ] || [ "$S" = "completed" ] || { echo "task became $S after kill (expect in_progress/completed)"; exit 1; }
```

**硬阈值**: 注入后 5 min 内 llm_retry events ≥ 1 且 ≤ 3；90s 后 task.status ∈ {in_progress, completed}；不接受 failed/cancelled。

---

### Step 5: 故障注入 B — max_fix_rounds → W5 interrupt → 主理人 abort

**可观测行为**: final_evaluate 持续 FAIL 撞 max_fix_rounds 后，W5 触发 `interrupt()` 写一条 `harness_interrupts` pending 记录；模拟主理人 POST `/api/brain/harness-interrupts/:id/resume {action:"abort"}`；interrupt 进入 `resumed`；graph 干净走到 END(error) 不死循环。

**验证命令**:
```bash
set -e
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)
DISPATCH_TS=$(psql "$DB" -t -c "SELECT extract(epoch FROM created_at)::bigint FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')

# 等待 harness_interrupts pending 出现（最多 15 分钟，与 max_fix_rounds 触发时长配套）
PENDING_ID=""
for i in $(seq 1 30); do
  PENDING_ID=$(psql "$DB" -t -c "
    SELECT id FROM harness_interrupts
    WHERE task_id='$ACC_TASK_ID'
      AND status='pending'
      AND extract(epoch FROM created_at) >= $DISPATCH_TS
    ORDER BY created_at DESC LIMIT 1
  " | tr -d ' ')
  [ -n "$PENDING_ID" ] && [ "$PENDING_ID" != "" ] && break
  sleep 30
done
[ -n "$PENDING_ID" ] || { echo "no harness_interrupts pending 15min after dispatch"; exit 1; }

# 模拟主理人 abort
RESP=$(curl -fsS -X POST "localhost:5221/api/brain/harness-interrupts/$PENDING_ID/resume" \
  -H "Content-Type: application/json" \
  -d '{"action":"abort","reason":"acceptance v4 scenario B"}')
echo "$RESP" | jq -e '.status == "resumed" or .resumed == true' >/dev/null \
  || { echo "resume API did not return resumed: $RESP"; exit 1; }

# 数据库确认进入 resumed
RESUMED=$(psql "$DB" -t -c "
  SELECT status FROM harness_interrupts
  WHERE id='$PENDING_ID'
" | tr -d ' ')
[ "$RESUMED" = "resumed" ] || { echo "interrupt status not resumed: $RESUMED"; exit 1; }

# graph 不死循环（resume 后 5 min 内 task 必须出现 terminal_fail 节点事件 OR task.status=failed）
sleep 300
TERM_HIT=$(psql "$DB" -t -c "
  SELECT count(*) FROM task_events
  WHERE task_id='$ACC_TASK_ID'
    AND event_type='graph_node_update'
    AND payload->>'node'='terminal_fail'
    AND extract(epoch FROM created_at) >= $DISPATCH_TS
" | tr -d ' ')
TASK_FAILED=$(psql "$DB" -t -c "
  SELECT count(*) FROM tasks
  WHERE id='$ACC_TASK_ID' AND status='failed'
" | tr -d ' ')
[ "$TERM_HIT" -ge 1 ] || [ "$TASK_FAILED" -eq 1 ] || { echo "graph not exited after abort (no terminal_fail event and task not failed)"; exit 1; }
```

**硬阈值**: 15min 内 harness_interrupts.pending 出现且 task_id 匹配；abort 后 .status='resumed'；resume 后 5min 内 graph 走到 terminal_fail 节点 OR task.status=failed（即非死循环）。

---

### Step 6: 故障注入 C — Deadline 逾期 watchdog → attempt N+1

**可观测行为**: `UPDATE initiative_runs.deadline_at = NOW() - 1min`，W3 watchdog 5 分钟内扫到 → 标 `phase=failed, failure_reason=watchdog_overdue`；下次 dispatch 同 initiative_id 时 W1 attempt N+1 fresh thread 启动。

**验证命令**:
```bash
set -e
INJECT_TS=$(date -u +%s)

# 注入：把 active phase=running 的 initiative_run.deadline_at 改成 1 分钟前
ROWS=$(psql "$DB" -t -c "
  UPDATE initiative_runs
  SET deadline_at = NOW() - interval '1 minute'
  WHERE initiative_id='harness-acceptance-v4-2026-05-08'
    AND phase='running'
  RETURNING id
" | grep -c .)
[ "$ROWS" -ge 1 ] || { echo "no running initiative_run to inject deadline on"; exit 1; }

# 等 watchdog（≤ 5 min）
PHASE=""
for i in $(seq 1 30); do
  PHASE=$(psql "$DB" -t -c "
    SELECT phase FROM initiative_runs
    WHERE initiative_id='harness-acceptance-v4-2026-05-08'
      AND extract(epoch FROM updated_at) > $INJECT_TS
    ORDER BY updated_at DESC LIMIT 1
  " | tr -d ' ')
  [ "$PHASE" = "failed" ] && break
  sleep 15
done
[ "$PHASE" = "failed" ] || { echo "watchdog did not mark failed in 5min, got: $PHASE"; exit 1; }

# failure_reason 必须是 watchdog_overdue（区分自然 fail）
REASON=$(psql "$DB" -t -c "
  SELECT failure_reason FROM initiative_runs
  WHERE initiative_id='harness-acceptance-v4-2026-05-08'
    AND extract(epoch FROM updated_at) > $INJECT_TS
  ORDER BY updated_at DESC LIMIT 1
" | tr -d ' ')
[ "$REASON" = "watchdog_overdue" ] || { echo "failure_reason wrong: '$REASON' (expect watchdog_overdue)"; exit 1; }

# attempt N+1：重派同 initiative_id
ATTEMPT_BEFORE=$(psql "$DB" -t -c "
  SELECT max(attempt) FROM initiative_runs
  WHERE initiative_id='harness-acceptance-v4-2026-05-08'
" | tr -d ' ')
curl -fsS -X POST localhost:5221/api/brain/dispatch \
  -H "Content-Type: application/json" \
  -d '{"initiative_id":"harness-acceptance-v4-2026-05-08"}' >/dev/null
sleep 15
ATTEMPT_AFTER=$(psql "$DB" -t -c "
  SELECT max(attempt) FROM initiative_runs
  WHERE initiative_id='harness-acceptance-v4-2026-05-08'
" | tr -d ' ')
[ "$ATTEMPT_AFTER" -gt "$ATTEMPT_BEFORE" ] || { echo "attempt did not increment: $ATTEMPT_BEFORE → $ATTEMPT_AFTER"; exit 1; }
```

**硬阈值**: 5min 内 phase=failed；failure_reason='watchdog_overdue'；重派后 max(attempt) +1。

---

### Step 7: 终态校验 + 报告 + lead 自验文件 + KR 回写

**可观测行为**: acceptance task 终态 `status=completed`；`docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md` 含 14 节点证据 + v3→v4 diff 表 + 3 个故障注入时间线；`.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md` 含 5 项 lead 命令 stdout；KR "管家闭环" progress ≥ 7（从 6/7 推进）。

**验证命令**:
```bash
set -e
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)

# 1. task.status=completed
FINAL=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
[ "$FINAL" = "completed" ] || { echo "task not completed: $FINAL"; exit 1; }

# 2. acceptance 报告存在 + 关键内容
REPORT="docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md"
[ -f "$REPORT" ] || { echo "report file missing: $REPORT"; exit 1; }
[ "$(wc -c < "$REPORT")" -gt 2000 ] || { echo "report too short ($(wc -c < "$REPORT") bytes), not real evidence"; exit 1; }
grep -qE 'v3.*v4|v3 → v4|v3→v4' "$REPORT" || { echo "report missing v3→v4 diff section"; exit 1; }
grep -qE 'graph_node_update|14[ /]+14' "$REPORT" || { echo "report missing 14-node evidence"; exit 1; }
grep -qE '故障注入 A|Docker SIGKILL' "$REPORT" || { echo "report missing fault injection A"; exit 1; }
grep -qE '故障注入 B|max_fix_rounds|W5 interrupt' "$REPORT" || { echo "report missing fault injection B"; exit 1; }
grep -qE '故障注入 C|watchdog' "$REPORT" || { echo "report missing fault injection C"; exit 1; }
grep -qE '注入时刻|inject.*at|reaction.*at' "$REPORT" || { echo "report missing injection→reaction timeline"; exit 1; }

# 3. lead 自验证据文件存在 + 含 5 项 lead 命令 stdout 摘录
LEAD=".agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md"
[ -f "$LEAD" ] || { echo "lead evidence missing: $LEAD"; exit 1; }
[ "$(wc -c < "$LEAD")" -gt 1000 ] || { echo "lead evidence too short"; exit 1; }
for kw in "rev-parse" "brain/status" "/api/brain/tasks" "task_events" "status FROM tasks"; do
  grep -qF "$kw" "$LEAD" || { echo "lead evidence missing keyword: $kw"; exit 1; }
done

# 4. KR 进度推进
KR_PROGRESS=$(curl -fsS localhost:5221/api/brain/okr/current \
  | jq -r '[.objectives[]? .key_results[]? | select((.title // .name) | contains("管家闭环"))][0].progress_pct // 0')
# v3 是 6（6/7 通过），目标 ≥ 7
[ "$KR_PROGRESS" != "0" ] && [ "$KR_PROGRESS" != "null" ] || { echo "KR 管家闭环 not found"; exit 1; }
[ "$(echo "$KR_PROGRESS >= 7" | bc -l)" = "1" ] || { echo "KR 管家闭环 progress=$KR_PROGRESS, expect ≥7"; exit 1; }

# 5. 子 dev task PR merged（acceptance 派出的子任务真正走完 dev pipeline）
SUB_PR=$(psql "$DB" -t -c "
  SELECT count(*) FROM dev_records dr
  JOIN tasks t ON t.id = dr.task_id
  WHERE t.parent_task_id='$ACC_TASK_ID'
    AND dr.merged = true
    AND dr.created_at > NOW() - interval '90 minutes'
" | tr -d ' ')
[ "$SUB_PR" -ge 1 ] || { echo "no merged subtask PR for acceptance, got $SUB_PR"; exit 1; }
```

**硬阈值**: task.status=completed；report ≥ 2000 字节 + 6 个关键章节 grep 命中；lead evidence ≥ 1000 字节 + 5 个 lead 命令关键字命中；KR 管家闭环 progress ≥ 7；过去 90 分钟内 ≥ 1 个 acceptance 子任务 PR merged。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
# E2E acceptance for W8 v4 — chains all 7 Golden Path Steps in order.
# 重要：此脚本由 Evaluator 在 worker_machine 上直接执行，DB / TASK_ID 等必须可解析。
set -e
export DB="${DB:-postgresql://localhost/cecelia}"

# ---- Step 1: deploy 一致性 ----
BRAIN_HEAD=$(docker exec brain git rev-parse HEAD)
git fetch origin main >/dev/null 2>&1
MAIN_HEAD=$(git rev-parse origin/main)
[ "$BRAIN_HEAD" = "$MAIN_HEAD" ] || { echo "FAIL Step1: brain stale"; exit 1; }
docker exec brain grep -qF "每轮（含被 REVISION 打回轮）" packages/workflows/skills/harness-contract-proposer/SKILL.md
docker exec brain grep -qE 'cp-harness-propose-r\$\{round\}-\$\{taskIdSlice\}' packages/brain/src/workflows/harness-gan.graph.js
STATE=$(curl -fsS localhost:5221/api/brain/status | jq -r '.brain_state // .state // ""')
[ "$STATE" != "emergency_brake" ] || { echo "FAIL Step1: emergency_brake"; exit 1; }
[ "$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND status='in_progress' AND created_at > NOW() - interval '24 hours'" | tr -d ' ')" -eq 0 ]
node -e "import('./scripts/acceptance/w8-v4/lib.mjs').then(m => { if (typeof m.assertBrainImageInSync !== 'function') process.exit(1); })"

# ---- Step 2: register + dispatch ----
[ "$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND payload->>'initiative_id'='harness-acceptance-v4-2026-05-08' AND created_at > NOW() - interval '7 days'" | tr -d ' ')" -eq 0 ]
ACC_TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '{"task_type":"harness_initiative","priority":"P1","payload":{"initiative_id":"harness-acceptance-v4-2026-05-08","sprint_dir":"sprints/harness-acceptance-v4","timeout_sec":1800,"thin_feature":{"endpoint":"GET /api/brain/harness/health","expected_fields":["langgraph_version","last_attempt_at"]},"e2e_test_path":"tests/e2e/harness-acceptance-smoke.spec.ts"}}' | jq -r '.task_id // .id')
echo "$ACC_TASK_ID" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || { echo "FAIL Step2 register"; exit 1; }
echo "$ACC_TASK_ID" > /tmp/acc-v4-task-id.txt
curl -fsS -X POST localhost:5221/api/brain/dispatch -H "Content-Type: application/json" -d "{\"task_id\":\"$ACC_TASK_ID\"}" | jq -e '.dispatched == true' >/dev/null
S=""; for i in $(seq 1 30); do S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' '); [ "$S" = "in_progress" ] && break; sleep 2; done
[ "$S" = "in_progress" ] || { echo "FAIL Step2 dispatch"; exit 1; }

# ---- Step 3: 14-node 全过 ----
DISPATCH_TS=$(psql "$DB" -t -c "SELECT extract(epoch FROM created_at)::bigint FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
for i in $(seq 1 50); do
  STATE=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
  [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] && break
  sleep 30
done
NODE_COUNT=$(psql "$DB" -t -c "SELECT count(DISTINCT (payload->>'node')) FROM task_events WHERE task_id='$ACC_TASK_ID' AND event_type='graph_node_update' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
[ "$NODE_COUNT" -ge 14 ] || { echo "FAIL Step3: distinct nodes=$NODE_COUNT"; exit 1; }
for node in prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance retry terminal_fail final_evaluate report; do
  HIT=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE task_id='$ACC_TASK_ID' AND event_type='graph_node_update' AND payload->>'node'='$node' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
  [ "$HIT" -ge 1 ] || { echo "FAIL Step3: node $node missing"; exit 1; }
done
INFER_BRANCH=$(psql "$DB" -t -c "SELECT payload->>'propose_branch' FROM task_events WHERE task_id='$ACC_TASK_ID' AND event_type='graph_node_update' AND payload->>'node'='inferTaskPlan' AND extract(epoch FROM created_at) >= $DISPATCH_TS ORDER BY created_at LIMIT 1" | tr -d ' ')
echo "$INFER_BRANCH" | grep -qE '^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$' || { echo "FAIL Step3: inferTaskPlan branch=$INFER_BRANCH"; exit 1; }

# ---- Step 4-6: 故障注入（注：实际 acceptance run 中 Brain 自驱触发 LLM_RETRY，evaluator 这里仅观测被动证据） ----
# Step 4 evidence
RETRY_AFTER=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE task_id='$ACC_TASK_ID' AND event_type='llm_retry' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
[ "$RETRY_AFTER" -ge 1 ] && [ "$RETRY_AFTER" -le 9 ] || { echo "FAIL Step4: llm_retry count=$RETRY_AFTER (expect 1-9 across 3 injections)"; exit 1; }
# Step 5 evidence
INTR=$(psql "$DB" -t -c "SELECT count(*) FROM harness_interrupts WHERE task_id='$ACC_TASK_ID' AND status='resumed' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
[ "$INTR" -ge 1 ] || { echo "FAIL Step5: no resumed interrupt"; exit 1; }
# Step 6 evidence
WD=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_runs WHERE initiative_id='harness-acceptance-v4-2026-05-08' AND failure_reason='watchdog_overdue'" | tr -d ' ')
[ "$WD" -ge 1 ] || { echo "FAIL Step6: no watchdog_overdue row"; exit 1; }
ATT_MAX=$(psql "$DB" -t -c "SELECT max(attempt) FROM initiative_runs WHERE initiative_id='harness-acceptance-v4-2026-05-08'" | tr -d ' ')
[ "$ATT_MAX" -ge 2 ] || { echo "FAIL Step6: max attempt=$ATT_MAX (expect ≥2 after watchdog→reattempt)"; exit 1; }

# ---- Step 7: 终态 + 报告 + lead 自验 + KR ----
FINAL=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
[ "$FINAL" = "completed" ] || { echo "FAIL Step7: task=$FINAL"; exit 1; }
REPORT="docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md"
[ -f "$REPORT" ] && [ "$(wc -c < "$REPORT")" -gt 2000 ]
for k in 'graph_node_update' '故障注入 A' '故障注入 B' '故障注入 C' 'v3' 'watchdog'; do grep -qF "$k" "$REPORT"; done
LEAD=".agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md"
[ -f "$LEAD" ] && [ "$(wc -c < "$LEAD")" -gt 1000 ]
for k in 'rev-parse' 'brain/status' '/api/brain/tasks' 'task_events' 'status FROM tasks'; do grep -qF "$k" "$LEAD"; done
KR=$(curl -fsS localhost:5221/api/brain/okr/current | jq -r '[.objectives[]? .key_results[]? | select((.title // .name) | contains("管家闭环"))][0].progress_pct // 0')
[ "$(echo "$KR >= 7" | bc -l)" = "1" ] || { echo "FAIL Step7 KR: $KR"; exit 1; }
SUB=$(psql "$DB" -t -c "SELECT count(*) FROM dev_records dr JOIN tasks t ON t.id=dr.task_id WHERE t.parent_task_id='$ACC_TASK_ID' AND dr.merged=true AND dr.created_at > NOW() - interval '90 minutes'" | tr -d ' ')
[ "$SUB" -ge 1 ] || { echo "FAIL Step7: no merged subtask PR"; exit 1; }

echo "✅ W8 Acceptance v4 — Golden Path 7 Steps 全过；14/14 graph nodes；3/3 故障注入自愈；KR=$KR"
```

**通过标准**: 脚本 exit 0，stdout 末行匹配 `^✅ W8 Acceptance v4`。

---

## Workstreams

workstream_count: 3

### Workstream 1: 部署校验 + acceptance v4 派发 + 14 节点事件流验证 helper

**范围**: 实现 `scripts/acceptance/w8-v4/lib.mjs`，导出三函数：
- `assertBrainImageInSync({exec})` — 抛错若 brain HEAD ≠ origin/main
- `registerAndDispatchAcceptance({fetch, db})` — POST tasks + dispatch，返回 task_id
- `waitFor14GraphNodeEvents({query, taskId, dispatchTs, timeoutSec})` — 轮询 task_events，返回 distinct node 列表（≤14 即返回，含 inferTaskPlan branch 校验）

**大小**: M（约 200 行 lib + 100 行测试）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/acceptance-helper.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/lib.mjs`（新建）

---

### Workstream 2: 故障注入 A/B/C 自愈观测 helper

**范围**: 实现 `scripts/acceptance/w8-v4/fault-inject.mjs`，导出：
- `findContainerForTask({docker, taskId})` — `docker ps --filter` 取第一个 container name
- `pollLlmRetryEvents({query, taskId, sinceTs, capMax=3})` — 5min 内 poll，返回 retry 数；超过 cap 抛错
- `pollHarnessInterruptPending({query, taskId, sinceTs, timeoutMin=15})` — poll harness_interrupts，返回 pending row id
- `injectInitiativeDeadlineOverdue({db, initiativeId})` — 仅 UPDATE phase=running 行；返回受影响行数（必须 ≥1）
- `assertWatchdogMarkedFailed({db, initiativeId, sinceTs, timeoutMin=5})` — 校验 phase=failed + failure_reason=watchdog_overdue

**大小**: L（约 300 行 lib + 150 行测试）
**依赖**: Workstream 1 完成后（共享同一 DB query helper）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/fault-inject.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/fault-inject.mjs`（新建）

---

### Workstream 3: 终态校验 + 报告生成器 + lead 自验文件骨架

**范围**: 实现 `scripts/acceptance/w8-v4/render-report.mjs`，导出：
- `renderAcceptanceReport({taskId, dispatchTs, mode, db})` — 拼接 Markdown，含 14 节点 SQL 输出 + v3→v4 diff 表 + 3 个故障注入时间线；mode='dryrun-nodes-only' 时只输出节点统计供 Step 3 校验
- `renderLeadEvidence({brainHead, mainHead, brainStatus, accTaskId, terminalStatus})` — 生成 `.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md` 骨架，注入 5 项 lead 命令 stdout 摘录占位 + 必含 keyword
- `writeReportFiles({reportPath, leadPath, content})` — 原子写盘（mkdir -p + write）

**大小**: M（约 250 行 lib + 100 行测试）
**依赖**: Workstream 2 完成后（render 时需读取 fault-inject 产物）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/render-report.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/render-report.mjs`（新建）
- `docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md`（运行时生成；renderer 测试只验证字符串内容，最终文件由 acceptance run 时 renderer 调用产出）
- `.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md`（同上）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/acceptance-helper.test.ts` | `assertBrainImageInSync` 抛错；`registerAndDispatchAcceptance` 返回 task_id；`waitFor14GraphNodeEvents` 返回 14 个 distinct + inferTaskPlan 校验 | 模块未实现 → vitest 报 `Cannot find module './scripts/acceptance/w8-v4/lib.mjs'` → 3 failures |
| WS2 | `tests/ws2/fault-inject.test.ts` | `findContainerForTask` 取第一个；`pollLlmRetryEvents` cap=3 抛错；`pollHarnessInterruptPending` 返回 pending id；`injectInitiativeDeadlineOverdue` 仅改 running 行；`assertWatchdogMarkedFailed` 严格 reason 校验 | 模块未实现 → 5 failures |
| WS3 | `tests/ws3/render-report.test.ts` | `renderAcceptanceReport` 含 6 个关键章节；`renderLeadEvidence` 含 5 个 lead 关键字；`writeReportFiles` mkdir + write 原子 | 模块未实现 → 3 failures |

---

## GAN 对抗焦点（Reviewer 审查重点）

本合同的 Reviewer 应特别挑战：

1. **Step 3 防造假**: 14 节点用 `count(DISTINCT payload->>'node')` 而非 `count(*)`；显式遍历 14 个 expected node name 校验每个 ≥ 1，防止"14 条事件全是同一节点"造假；inferTaskPlan branch 用严格正则（hex8 + r[1-9]\d*）防止"任意字符串都过"。
2. **Step 4 cap 校验**: `RETRY_COUNT ≤ 3` 防止"无限重试也算 PASS"。
3. **Step 5 死循环检测**: resume 后 5min 内必须看到 `terminal_fail` 节点 OR `task.status=failed`，否则视为 graph 死循环。
4. **Step 6 attempt N+1**: 用 `max(attempt)` BEFORE/AFTER 对比，而非 `attempt > 1`，能识别真正的 N→N+1 增长。
5. **Step 7 报告字节数**: ≥ 2000 字节 + 6 个关键 grep，防止 `echo "OK" > report` 造假。
6. **Step 1 deploy 校验**: 用 `docker exec brain grep` 命中具体修复指纹，而非比对 commit hash（commit hash 可能有 fast-forward 但代码尚未生效）。
7. **时间窗口**: 所有 SQL `count(*)` / `select` 都带 `extract(epoch FROM created_at) >= $DISPATCH_TS` 或 `created_at > NOW() - interval '...'`，防止匹配 v1/v2/v3 历史残留。
8. **curl -f flag**: 所有 HTTP 调用都加 `-f`，HTTP 5xx 立即退出。
