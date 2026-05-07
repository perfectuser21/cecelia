# Sprint Contract Draft (Round 1)

> **Initiative**: W8 Acceptance v2 — LangGraph 14 节点端到端验证（fixed UUID `39d535f3-520a-4a92-a2b6-b31645e11664`）
> **journey_type**: autonomous
> **journey_type_reason**: 主路径完全在 packages/brain 内由 LangGraph 调度自动跑通；主理人只在场景 B 的 interrupt 决策这一步介入（abort）。

## Golden Path

[清残留 + 注册 fixed-UUID harness_initiative + dispatch] → [14 节点 full graph 自动流转，子任务 health endpoint PR merge，final_evaluate verdict=PASS] → [叠加 3 个故障注入：A=docker SIGKILL→重试 PASS / B=max_fix_rounds→interrupt→resume abort→END error / C=watchdog deadline→phase=failed] → [verify-checklist 全过 + acceptance 报告写入 + KR 进度 +Δ]

---

### Step 1: 清理 fixed-UUID 残留 + 注册 harness_initiative + dispatch

**可观测行为**：
- DB 中 `initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664'` 的 `initiative_runs` / `initiative_contracts` / `tasks` 行被清理或标 failed 收尾（`completed_at IS NOT NULL`）
- 新建 `tasks` 行，`task_type='harness_initiative'`，`payload->>'initiative_id'='39d535f3-...'`，`payload->>'sprint_dir'='sprints/w8-langgraph-v2'`
- `POST /api/brain/tasks/:id/dispatch` 返回 HTTP 2xx，task 状态 5 秒内变为 `in_progress`

**验证命令**:
```bash
# 1) 清理校验：fixed UUID 没有 in-flight initiative_runs
psql "$DB" -t -c "SELECT count(*) FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at IS NULL" | tr -d ' '
# 期望：0

# 2) 任务注册校验：刚注册的 task 存在且 payload 正确
psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664' AND payload->>'sprint_dir'='sprints/w8-langgraph-v2' AND created_at > NOW() - INTERVAL '5 minutes'" | tr -d ' '
# 期望：>=1（且必须是 5 分钟内的，防造假）

# 3) dispatch 后状态推进
NEW_TASK_ID=$(psql "$DB" -t -c "SELECT id FROM tasks WHERE task_type='harness_initiative' AND payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
sleep 8
psql "$DB" -t -c "SELECT status FROM tasks WHERE id='${NEW_TASK_ID}'" | tr -d ' '
# 期望：in_progress 或 completed（不能停留在 queued）
```

**硬阈值**：
- 清理后残留 in-flight = 0
- 5 分钟内创建出唯一新 task，payload 字段精确匹配
- dispatch 后 8 秒内状态 ≠ `queued`

---

### Step 2: 14 节点 full graph 全部流转 + thin feature PR merge + final_evaluate=PASS

**可观测行为**：
- `task_events` 中针对该 fixed-UUID 派生任务族写入 14 个不同 `payload->>'nodeName'` 的 `graph_node_update` 事件（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）
- thin feature 子任务对应 PR merge 到 main，PR 标题/分支与 acceptance 命名规则匹配（`cp-MMDDHHNN-w8-acceptance-v2-*` 或 sprint_dir 关联）
- `initiative_runs` 该 initiative_id 行 `phase='done'` 且 `completed_at IS NOT NULL`
- `task_events` 末尾包含 `event_type='final_evaluate_verdict'` 或等效记录，verdict='PASS'

**验证命令**:
```bash
# 1) 14 个不同 nodeName 计数（窗口 2 小时防造假）
DISTINCT_NODES=$(psql "$DB" -t -c "
SELECT count(DISTINCT payload->>'nodeName')
FROM task_events
WHERE event_type='graph_node_update'
  AND payload->>'nodeName' IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')
  AND task_id IN (
    SELECT id FROM tasks
    WHERE payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664'
       OR id::text='39d535f3-520a-4a92-a2b6-b31645e11664'
  )
  AND created_at > NOW() - INTERVAL '2 hours'
" | tr -d ' ')
[ "$DISTINCT_NODES" = "14" ] || { echo "❌ distinct nodeName=$DISTINCT_NODES, 期望 14"; exit 1; }

# 2) initiative_runs phase=done
psql "$DB" -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at > NOW() - INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1" | tr -d ' '
# 期望：done

# 3) thin feature PR merge 到 main（acceptance 跑动产生）
gh pr list --search "harness/health in:title OR sprint_dir:sprints/w8-langgraph-v2" --state merged --json number,mergedAt,title --limit 5 | jq 'length'
# 期望：>=1
gh pr list --search "harness/health" --state merged --json mergedAt --limit 1 | jq -r '.[0].mergedAt' | xargs -I{} date -d {} +%s | awk -v now=$(date +%s) '{if(now-$1<7200)print "ok"; else print "old"}'
# 期望：ok（2 小时内 merge）

# 4) final_evaluate 节点写入证据 + verdict=PASS（payload 内 verdict 字段）
psql "$DB" -t -c "
SELECT count(*) FROM task_events
WHERE event_type='graph_node_update'
  AND payload->>'nodeName'='final_evaluate'
  AND (payload->>'verdict'='PASS' OR payload->'state'->>'verdict'='PASS')
  AND task_id IN (SELECT id FROM tasks WHERE payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664')
  AND created_at > NOW() - INTERVAL '2 hours'
" | tr -d ' '
# 期望：>=1
```

**硬阈值**：
- 14 个 distinct nodeName 全部命中（少 1 个即 FAIL）
- initiative_runs.phase='done'，completed_at 在 2 小时内
- thin feature PR 在 2 小时内 merge
- final_evaluate verdict=PASS 至少 1 条

---

### Step 3: 故障注入 A — docker SIGKILL → OOM_killed → 自动重试 3 次 → 子任务 PASS

**可观测行为**：
- 在某个子任务 evaluate 节点跑 docker container 时，外部 `docker kill <container_id>` 注入 SIGKILL
- `docker-executor.js` Promise reject `OOM_killed`（`exit_code=137 && !timed_out`）
- `callback_queue` / `task_events` 写入 `failure_class='docker_oom_killed'` 行
- `raise('P1', 'docker_oom_killed_<taskId>', ...)` 在 Brain stdout 留 `[alerting] P1 docker_oom_killed_*` 行
- LLM_RETRY 自动重试 3 次内子任务最终 status='completed'

**验证命令**:
```bash
# 0) 先准备：拿到当前 in-flight 子任务 + container_id
SUB_TASK_ID=$(psql "$DB" -t -c "
SELECT id FROM tasks
WHERE parent_task_id IN (SELECT id FROM tasks WHERE payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664')
  AND status='in_progress'
ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$SUB_TASK_ID" ] || { echo "❌ 找不到 in-flight 子任务"; exit 1; }

CONTAINER_ID=$(docker ps --filter "label=task_id=$SUB_TASK_ID" --format '{{.ID}}' | head -1)
[ -n "$CONTAINER_ID" ] || { echo "❌ 找不到 container"; exit 1; }

# 注入 SIGKILL
docker kill --signal=KILL "$CONTAINER_ID"

# 1) 等待 callback_queue 写入 docker_oom_killed（窗口 60 秒）
for i in $(seq 1 30); do
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM callback_queue WHERE task_id='$SUB_TASK_ID' AND failure_class='docker_oom_killed' AND created_at > NOW() - INTERVAL '2 minutes'" | tr -d ' ')
  [ "$COUNT" -ge 1 ] && break
  sleep 2
done
[ "$COUNT" -ge 1 ] || { echo "❌ 60s 内未写 docker_oom_killed"; exit 1; }

# 2) Brain 日志含 P1 alert（路径假设 packages/brain/logs/brain.out 或通过 journalctl）
BRAIN_LOG="${BRAIN_LOG:-packages/brain/logs/brain.out}"
grep -c "\[alerting\] P1 docker_oom_killed_${SUB_TASK_ID}" "$BRAIN_LOG" 2>/dev/null
# 期望：>=1

# 3) 等待最多 10 分钟，子任务最终 completed（重试 3 次后 PASS）
for i in $(seq 1 60); do
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$SUB_TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  sleep 10
done
[ "$STATUS" = "completed" ] || { echo "❌ 子任务最终 status=$STATUS，期望 completed"; exit 1; }

# 4) 重试次数 >= 1（execution_attempts），证明真的进入 retry 路径
ATTEMPTS=$(psql "$DB" -t -c "SELECT execution_attempts FROM tasks WHERE id='$SUB_TASK_ID'" | tr -d ' ')
[ "$ATTEMPTS" -ge 2 ] || { echo "❌ execution_attempts=$ATTEMPTS，期望 >=2"; exit 1; }
```

**硬阈值**：
- 60 秒内 callback_queue 写入 `failure_class='docker_oom_killed'` ≥ 1 条
- Brain 日志含 `[alerting] P1 docker_oom_killed_<sub_task_id>` ≥ 1 行
- 子任务最终 status='completed'
- execution_attempts ≥ 2（证明走过重试）

---

### Step 4: 故障注入 B — 强制 final E2E FAIL × 3 → interrupt() → resume abort → END error

**可观测行为**：
- 强制 `final_evaluate` 节点连续 FAIL 3 次（写假 evidence 或 patch shim），撞 `MAX_FIX_ROUNDS=3`
- `task_events` 写入 `event_type='interrupt_pending'` 1 条
- `GET /api/brain/harness-interrupts` 返回该 task_id 在 `interrupts[]` 中
- `POST /api/brain/harness-interrupts/:taskId/resume` body `{"decision":{"action":"abort"}}` 返回 HTTP 202
- `task_events` 后续写入 `event_type='interrupt_resumed'` 1 条，payload 含 action=abort
- `initiative_runs.phase='failed'`，`failure_reason` 含 `abort` 或 `interrupt`

**验证命令**:
```bash
# 前置：fault-b 脚本已让 final_evaluate FAIL × 3 触发 interrupt
PARENT_TASK_ID=$(psql "$DB" -t -c "SELECT id FROM tasks WHERE payload->>'initiative_id'='39d535f3-520a-4a92-a2b6-b31645e11664' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')

# 1) 等待 interrupt_pending 事件出现（窗口 5 分钟）
for i in $(seq 1 30); do
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE event_type='interrupt_pending' AND task_id='$PARENT_TASK_ID' AND created_at > NOW() - INTERVAL '10 minutes'" | tr -d ' ')
  [ "$COUNT" -ge 1 ] && break
  sleep 10
done
[ "$COUNT" -ge 1 ] || { echo "❌ interrupt_pending 未出现"; exit 1; }

# 2) /harness-interrupts API 返回该 taskId
curl -fs localhost:5221/api/brain/harness-interrupts | jq -r ".interrupts[].task_id" | grep -F "$PARENT_TASK_ID"
# 期望：grep 命中（exit 0）

# 3) resume abort 并校验 HTTP 202
RESUME_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "localhost:5221/api/brain/harness-interrupts/${PARENT_TASK_ID}/resume" \
  -H "Content-Type: application/json" \
  -d '{"decision":{"action":"abort"}}')
[ "$RESUME_HTTP" = "202" ] || { echo "❌ resume HTTP=$RESUME_HTTP，期望 202"; exit 1; }

# 4) interrupt_resumed 事件写入（窗口 60 秒）
for i in $(seq 1 30); do
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE event_type='interrupt_resumed' AND task_id='$PARENT_TASK_ID' AND payload::text LIKE '%abort%' AND created_at > NOW() - INTERVAL '5 minutes'" | tr -d ' ')
  [ "$COUNT" -ge 1 ] && break
  sleep 2
done
[ "$COUNT" -ge 1 ] || { echo "❌ interrupt_resumed(abort) 未写入"; exit 1; }

# 5) initiative_runs 终态：phase=failed，failure_reason 标 abort
PHASE=$(psql "$DB" -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
REASON=$(psql "$DB" -t -c "SELECT failure_reason FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ "$PHASE" = "failed" ] || { echo "❌ phase=$PHASE，期望 failed"; exit 1; }
echo "$REASON" | grep -Eq "abort|interrupt|max_fix_rounds" || { echo "❌ failure_reason='$REASON' 不含 abort/interrupt/max_fix_rounds"; exit 1; }
```

**硬阈值**：
- interrupt_pending ≥ 1 条（10 分钟内）
- harness-interrupts API 返回该 taskId
- resume 接口返回 HTTP 202
- interrupt_resumed 事件 payload 含 'abort'
- initiative_runs.phase='failed'，failure_reason 命中 abort/interrupt/max_fix_rounds 之一

---

### Step 5: 故障注入 C — watchdog deadline 过期 → phase=failed + Feishu P1 alert

**可观测行为**：
- `UPDATE initiative_runs SET deadline_at=NOW()-INTERVAL '1 minute' WHERE initiative_id='39d535f3-...' AND completed_at IS NULL`
- 等下次 watchdog tick（≤ 5 分钟）扫到
- `initiative_runs.phase='failed'`，`failure_reason='watchdog_overdue'`，`completed_at` 在 6 分钟内
- Brain 日志含 `[harness-watchdog] flagged initiative=39d535f3-...`
- 若 notifier 配置完整，Feishu 收到 P1 推送（`[alerting] P1 ...overdue`）

**验证命令**:
```bash
# 0) 准备：把 deadline 改到过去
psql "$DB" -c "UPDATE initiative_runs SET deadline_at=NOW()-INTERVAL '1 minute' WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at IS NULL AND phase IN ('A_contract','A_planning','B_task_loop','C_final_e2e')"

# 1) 等 watchdog 扫到（最多 6 分钟）
for i in $(seq 1 36); do
  PHASE=$(psql "$DB" -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND failure_reason='watchdog_overdue' AND completed_at > NOW() - INTERVAL '10 minutes' ORDER BY completed_at DESC LIMIT 1" | tr -d ' ')
  [ "$PHASE" = "failed" ] && break
  sleep 10
done
[ "$PHASE" = "failed" ] || { echo "❌ 6 分钟内 watchdog 未触发"; exit 1; }

# 2) failure_reason 精确匹配
REASON=$(psql "$DB" -t -c "SELECT failure_reason FROM initiative_runs WHERE initiative_id='39d535f3-520a-4a92-a2b6-b31645e11664' AND completed_at > NOW() - INTERVAL '10 minutes' ORDER BY completed_at DESC LIMIT 1" | tr -d ' ')
[ "$REASON" = "watchdog_overdue" ] || { echo "❌ failure_reason=$REASON"; exit 1; }

# 3) Brain 日志含 watchdog flagged 行
BRAIN_LOG="${BRAIN_LOG:-packages/brain/logs/brain.out}"
grep -c "\[harness-watchdog\] flagged initiative=39d535f3-520a-4a92-a2b6-b31645e11664" "$BRAIN_LOG" 2>/dev/null
# 期望：>=1
```

**硬阈值**：
- 6 分钟内 initiative_runs 进入 phase='failed' 且 failure_reason='watchdog_overdue'
- Brain 日志含 `[harness-watchdog] flagged initiative=<fixed-uuid>` ≥ 1 行
- completed_at 时间戳为最近 10 分钟内（窗口防造假）

---

### Step 6: verify-checklist 全过 + acceptance 报告写入 + KR 进度 +Δ

**可观测行为**：
- `scripts/acceptance/w8-v2/verify-checklist.sh` 一键聚合 5 个步骤的所有断言，exit 0
- `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md` 文件存在并 commit 到当前分支
- 报告包含 3 张表：14节点事件计数表 / 3故障注入终态表 / KR 进度增量表
- `GET /api/brain/okr/current` 中 harness-reliability KR 当前值高于 acceptance 跑前快照

**验证命令**:
```bash
# 1) verify-checklist 跑通
bash scripts/acceptance/w8-v2/verify-checklist.sh
# 期望：exit 0

# 2) 报告文件存在 + 含 3 张表
REPORT="docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md"
[ -f "$REPORT" ] || { echo "❌ 报告未写入"; exit 1; }
grep -c "## 14 节点事件计数" "$REPORT" || exit 1
grep -c "## 故障注入终态" "$REPORT" || exit 1
grep -c "## KR 进度增量" "$REPORT" || exit 1

# 3) 报告已 commit（不允许只放 working tree 不入库）
git ls-files --error-unmatch "$REPORT"
# 期望：exit 0

# 4) KR 进度 +Δ：与 sprint 启动时快照对比（快照存于 sprints/w8-langgraph-v2/kr-snapshot-before.json）
SNAPSHOT="sprints/w8-langgraph-v2/kr-snapshot-before.json"
[ -f "$SNAPSHOT" ] || { echo "❌ KR 快照缺失（acceptance 启动前应抓快照）"; exit 1; }
BEFORE=$(jq -r '.objectives[].key_results[] | select(.name|test("harness-reliability";"i")) | .current_value // 0' "$SNAPSHOT" | head -1)
AFTER=$(curl -fs localhost:5221/api/brain/okr/current | jq -r '.objectives[].key_results[] | select(.name|test("harness-reliability";"i")) | .current_value // 0' | head -1)
awk -v b="$BEFORE" -v a="$AFTER" 'BEGIN{ if(a+0 > b+0) exit 0; else exit 1 }'
# 期望：exit 0（after > before）
```

**硬阈值**：
- verify-checklist.sh exit 0
- 报告文件存在 + 3 张表标题全部命中
- 报告已 git ls-files 入库
- KR `harness-reliability` current_value 严格大于 sprint 启动前快照值

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
BRAIN_LOG="${BRAIN_LOG:-packages/brain/logs/brain.out}"
INIT_ID="39d535f3-520a-4a92-a2b6-b31645e11664"
SPRINT_DIR="sprints/w8-langgraph-v2"
REPORT="docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md"

# Pre: KR 快照（如缺失则当场抓一次，但 acceptance 流程要求事先抓）
[ -f "${SPRINT_DIR}/kr-snapshot-before.json" ] || \
  curl -fs localhost:5221/api/brain/okr/current > "${SPRINT_DIR}/kr-snapshot-before.json"

# Step 1: 清理 + 注册 + dispatch
bash scripts/acceptance/w8-v2/register-and-dispatch.sh | tee "${SPRINT_DIR}/dispatch.log"

# 等 happy path 跑完（最长 30 分钟，否则 watchdog 自己会兜底——这里给一个上限）
for i in $(seq 1 90); do
  PHASE=$(psql "$DB" -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='${INIT_ID}' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ "$PHASE" = "done" ] && break
  sleep 20
done

# Step 2 验证：14 节点 + thin feature PR + final_evaluate=PASS
DISTINCT_NODES=$(psql "$DB" -t -c "
SELECT count(DISTINCT payload->>'nodeName') FROM task_events
WHERE event_type='graph_node_update'
  AND payload->>'nodeName' IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert','pick_sub_task','run_sub_task','evaluate','advance','retry','terminal_fail','final_evaluate','report')
  AND created_at > NOW() - INTERVAL '2 hours'
  AND task_id IN (SELECT id FROM tasks WHERE payload->>'initiative_id'='${INIT_ID}')" | tr -d ' ')
[ "$DISTINCT_NODES" = "14" ] || { echo "❌ Step2 distinct=$DISTINCT_NODES"; exit 1; }

PR_MERGED=$(gh pr list --search "harness/health" --state merged --json number --limit 5 | jq 'length')
[ "$PR_MERGED" -ge 1 ] || { echo "❌ Step2 thin feature PR 未 merge"; exit 1; }

# Step 3: fault A
bash scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh | tee "${SPRINT_DIR}/fault-a.log"

# Step 4: fault B
bash scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh | tee "${SPRINT_DIR}/fault-b.log"

# Step 5: fault C
bash scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh | tee "${SPRINT_DIR}/fault-c.log"

# Step 6: verify-checklist 聚合 + 报告 commit + KR +Δ
bash scripts/acceptance/w8-v2/verify-checklist.sh | tee "${SPRINT_DIR}/verify.log"
[ -f "$REPORT" ] || { echo "❌ 报告缺失"; exit 1; }
git ls-files --error-unmatch "$REPORT"

BEFORE=$(jq -r '.objectives[].key_results[] | select(.name|test("harness-reliability";"i")) | .current_value // 0' "${SPRINT_DIR}/kr-snapshot-before.json" | head -1)
AFTER=$(curl -fs localhost:5221/api/brain/okr/current | jq -r '.objectives[].key_results[] | select(.name|test("harness-reliability";"i")) | .current_value // 0' | head -1)
awk -v b="$BEFORE" -v a="$AFTER" 'BEGIN{ if(a+0 > b+0) exit 0; else exit 1 }' || { echo "❌ KR 未增"; exit 1; }

echo "✅ Golden Path 全程验证通过：14 节点 + 3 故障注入自愈 + 报告入库 + KR +Δ"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 3

### Workstream 1: register-and-dispatch.sh — 干净起点 + 注册 fixed-UUID 任务 + 派发 + 流式 tail

**范围**:
- 新建 `scripts/acceptance/w8-v2/register-and-dispatch.sh`
- 内容：清理残留 SQL（DELETE/UPDATE in-flight 行）→ 用 `curl -f -X POST localhost:5221/api/brain/tasks` 注册 `harness_initiative` task（payload 含 fixed UUID + sprint_dir + thin_features + budget_usd + timeout_sec）→ `POST /:id/dispatch` → tail `task_events` 直到 happy path 终态或超时
- 输出：`sprints/w8-langgraph-v2/dispatch.log`，结尾打印 `DISPATCH_COMPLETE: phase=done|failed`

**大小**: M（130–180 LOC）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/register-dispatch.test.ts`

---

### Workstream 2: 三个故障注入脚本 inject-fault-{a,b,c}.sh

**范围**:
- 新建 3 个脚本：
  - `scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh`：定位当前 in-flight 子任务 container_id → `docker kill --signal=KILL` → 等 callback_queue.failure_class='docker_oom_killed' → 等子任务最终 status='completed' 且 execution_attempts ≥ 2
  - `scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh`：注入 final E2E 连续 FAIL（写假 final_evaluate evidence 让 verdict=FAIL × 3）→ 等 task_events.event_type='interrupt_pending' → curl `/api/brain/harness-interrupts` 校验返回 → curl `/resume` body `{"decision":{"action":"abort"}}` 期望 HTTP 202 → 等 interrupt_resumed + initiative_runs.phase='failed'
  - `scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh`：`UPDATE initiative_runs SET deadline_at=NOW()-INTERVAL '1 minute'` → 轮询 6 分钟等 watchdog flag → 校验 phase='failed', failure_reason='watchdog_overdue' + Brain 日志 flagged 行

**大小**: M（每个 60–120 LOC，合计 200–300 LOC）
**依赖**: Workstream 1（必须有 in-flight initiative 才能注入）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/fault-injection.test.ts`

---

### Workstream 3: verify-checklist.sh + acceptance 报告

**范围**:
- 新建 `scripts/acceptance/w8-v2/verify-checklist.sh`：聚合所有 Golden Path Step 的关键断言（14节点 distinct + initiative_runs.phase + thin feature PR merged + 3 故障注入终态 + KR +Δ），任一失败 exit 1
- 新建 `docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md`，模板包含：
  - `# 结论`（PASS/FAIL）
  - `## 14 节点事件计数`（每节点事件数表）
  - `## 故障注入终态`（A/B/C 三场景终态表）
  - `## KR 进度增量`（before/after 对比）
  - `## Follow-up`（跑动中发现的非阻塞 issue）
- 在 sprint 启动时抓 `sprints/w8-langgraph-v2/kr-snapshot-before.json`（脚本兜底逻辑）
- 报告文件 git add + commit（脚本内或调用方负责）

**大小**: M（脚本 100–160 LOC + 报告模板 80–150 行 markdown）
**依赖**: Workstream 2（需要 3 个 fault 跑完后才能聚合）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/verify-and-report.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/register-dispatch.test.ts` | 脚本存在 + shebang + 含 fixed UUID 清理 + 调用 /api/brain/tasks 注册 + 调用 /dispatch + tail task_events + 退出码语义 + bash 语法合法 | 脚本不存在 → 5 个 it 失败 |
| WS2 | `tests/ws2/fault-injection.test.ts` | 3 个脚本各有 inject + assert 段；A 含 `docker kill --signal=KILL`；B 含 `harness-interrupts` 与 `decision.*abort`；C 含 `deadline_at=NOW()-INTERVAL` 与 `watchdog_overdue`；3 个脚本 bash -n 语法合法 | 3 个脚本不存在 → 至少 9 个 it 失败 |
| WS3 | `tests/ws3/verify-and-report.test.ts` | verify-checklist.sh 存在且含 14 distinct + thin feature PR + 3 故障终态 + KR +Δ 五段断言；报告 markdown 含 4 个固定 H2 标题；KR 快照逻辑存在 | 脚本与报告均不存在 → 至少 6 个 it 失败 |
