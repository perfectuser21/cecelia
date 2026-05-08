# Sprint Contract Draft (Round 2)

> **Sprint**: W8 Acceptance v4 — LangGraph 14 节点端到端验证（post PR #2837 deploy）
> **journey_type**: autonomous
> **GAN Layer**: 2a (Proposer)
> **Initiative**: harness-acceptance-v4-2026-05-08
> **Acceptance Task**: `5eb2718b-48c7-43a1-88cb-8995a4b49bff`（同 INITIATIVE_ID，由本 sprint 在 Step 2 派出"acceptance run"子任务）

## R1 Reviewer 反馈处理（R2 修订摘要）

| Reviewer 关切 | R2 落地 |
|---|---|
| (R3) W5 interrupt 24h 自动超时被误判为正常 abort | Step 5 记录 `harness_interrupts.created_at` 到 `resumed_at` delta，硬阈值 `< 24h`；超过则报告备注但不算 fail；新增 ws3 helper `assertInterruptResumeSla` + 红测试 |
| (R4) cascade — Step 4 注入失败导致 Step 5/6 无信号 | 每个故障注入步用 `recordInjectionTimestamp(kind)` 写独立证据文件 `/tmp/acc-v4-inject-{a,b,c}-ts.txt`；evaluator Step 7 调 `replayInjectionEvidence` 回放判定（即使前序 race 失败也能定位 evidence 文件） |
| test_is_red 加固 | Test Contract 表"预期红证据"列追加每个测试**首条 `expect()` 行号 + 断言原文**，让 Reviewer 一眼看出 Red 落在断言而非 import |
| internal_consistency 加固 | E2E 脚本 Step 4 evidence 块加注释 `# 累计上限 9 = 单次 cap 3 × 3 个 LLM_RETRY 注入窗口`；inferTaskPlan 正则在脚本顶部以 `INFER_BRANCH_RE='^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$'` 定义，Step 1（grep 校验源码）+ Step 3（校验运行时值）共用同一变量 |

## Golden Path

```
[post #2837 deploy 校验] → [注册+派发 acceptance v4] → [14 节点 graph_node_update 全过] → [故障注入 A 自愈] → [故障注入 B interrupt → abort + SLA] → [故障注入 C watchdog → attempt N+1] → [终态 completed + 报告 + lead 自验 + KR 回写]
```

入口：执行者在 worker_machine（Cecelia Mac mini 主机）`docker exec brain` 可达。
出口：`docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md` 写盘 + `tasks.status='completed'` + KR 管家闭环 ≥ 7/7。

**全脚本顶部共享变量**（Step 1 / Step 3 / E2E 共用，单一来源防止漂移）：

```bash
# inferTaskPlan propose_branch 正则；PR #2837 修复后 SKILL push 同格式
INFER_BRANCH_RE='^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$'

# 故障注入证据文件（R4 cascade mitigation：独立落盘）
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"
```

---

### Step 1: 部署一致性校验（前置闸门）

**可观测行为**: Brain 容器内 git HEAD == origin/main（PR #2837 已 deploy）；SKILL.md / harness-gan.graph.js 双修指纹存在；harness-gan.graph.js 中 fallbackProposeBranch 用的字面量正则匹配 `INFER_BRANCH_RE`（同源校验防漂移）；Brain 不在 emergency_brake；无残留 in_progress harness_initiative 任务占用 docker slot；scripts/acceptance/w8-v4/lib.mjs 的 `assertBrainImageInSync()` 函数被调用后能直接以非零 exit 阻断后续步骤。

**验证命令**:
```bash
set -e
# 顶部变量（Step 1/3/E2E 共享）
INFER_BRANCH_RE='^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$'
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"

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

# 2b. 源码字面量正则与 INFER_BRANCH_RE 同源（防漂移：未来人改了 graph 但忘改本合同）
SRC_FORMAT=$(docker exec brain grep -oE 'cp-harness-propose-r\$\{[a-zA-Z]+\}-\$\{[a-zA-Z]+\}' packages/brain/src/workflows/harness-gan.graph.js | head -1)
[ "$SRC_FORMAT" = 'cp-harness-propose-r${round}-${taskIdSlice}' ] \
  || { echo "harness-gan.graph.js fallbackProposeBranch format diverged from INFER_BRANCH_RE: '$SRC_FORMAT'"; exit 1; }

# 3. emergency_brake 与残留任务
STATE=$(curl -fsS localhost:5221/api/brain/status | jq -r '.brain_state // .state // ""')
[ "$STATE" != "emergency_brake" ] || { echo "Brain in emergency_brake"; exit 1; }
STUCK=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND status='in_progress' AND created_at > NOW() - interval '24 hours'" | tr -d ' ')
[ "$STUCK" -eq 0 ] || { echo "$STUCK stuck harness_initiative tasks in last 24h"; exit 1; }

# 4. helper module 真实存在（WS1 产物）+ 行为正确
node -e "import('./scripts/acceptance/w8-v4/lib.mjs').then(m => { if (typeof m.assertBrainImageInSync !== 'function') process.exit(2); })" \
  || { echo "WS1 helper module missing or assertBrainImageInSync not exported"; exit 1; }
```

**硬阈值**: 5 项全 PASS（含 2b 源码字面量同源）；命令总耗时 < 60s；任一 fail 即整 sprint FAIL（前置闸门，不重试）。

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

**可观测行为**: DB `task_events` 表对该 ACC_TASK_ID 在派发后 30 分钟内累计 ≥ 14 条 distinct `graph_node_update` 事件，覆盖全部 14 节点 (`prep, planner, parsePrd, ganLoop, inferTaskPlan, dbUpsert, pick_sub_task, run_sub_task, evaluate, advance, retry, terminal_fail, final_evaluate, report`)；尤其 v3 fail 点 `inferTaskPlan` 必有 ≥ 1 条事件，且事件 payload 中 `propose_branch` 字段匹配 `$INFER_BRANCH_RE`（与 Step 1 校验源码字面量同源、与 PR #2837 修后的 SKILL push 格式一致）。

**验证命令**:
```bash
set -e
# 顶部变量（与 Step 1 同源；脚本独立运行时也定义一次）
INFER_BRANCH_RE='^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$'

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

# 3. v3 fail 点：inferTaskPlan payload.propose_branch 必匹配 $INFER_BRANCH_RE（与 Step 1 同源）
INFER_BRANCH=$(psql "$DB" -t -c "
  SELECT payload->>'propose_branch'
  FROM task_events
  WHERE task_id='$ACC_TASK_ID'
    AND event_type='graph_node_update'
    AND payload->>'node'='inferTaskPlan'
    AND extract(epoch FROM created_at) >= $DISPATCH_TS
  ORDER BY created_at LIMIT 1
" | tr -d ' ')
echo "$INFER_BRANCH" | grep -qE "$INFER_BRANCH_RE" \
  || { echo "inferTaskPlan propose_branch wrong format: '$INFER_BRANCH' (expect $INFER_BRANCH_RE)"; exit 1; }

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

**硬阈值**: distinct node count ≥ 14；每个 expected node ≥ 1 事件；inferTaskPlan.payload.propose_branch 必匹配 `$INFER_BRANCH_RE`（同 Step 1 源码字面量）；renderer dryrun 输出含 "14/14"。**任一 fail = sprint FAIL**（gating Feature 0）。

---

### Step 4: 故障注入 A — Docker SIGKILL 自愈

**可观测行为**: 在某 LLM_RETRY 节点（preferably `run_sub_task`）执行中 docker kill 该容器；W6 Promise 立即 reject + W2 LLM_RETRY 自动重试 ≤ 3 次；子任务最终 PASS（task 不进入 failed）；无人工干预；**注入时刻独立落盘到 `$INJECT_EVIDENCE_DIR/inject-a.json`，evaluator 即使后续 race 失败也能从该文件回放判定**（R4 cascade mitigation）。

**验证命令**:
```bash
set -e
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)

# 找到为该 task 跑的 docker container（label 形式）
TARGET=$(docker ps --filter "label=cecelia.task_id=$ACC_TASK_ID" --format '{{.Names}}' | head -1)
[ -n "$TARGET" ] || { echo "no docker container labeled with task_id=$ACC_TASK_ID"; exit 1; }

INJECT_TS=$(date -u +%s)
docker kill "$TARGET" >/dev/null

# R4 mitigation: 独立 evidence 文件（即使本步骤后续 poll 失败，Step 7 evaluator 仍能 replay 判定）
node -e "
  import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(m => m.recordInjectionTimestamp({
    kind: 'A', dir: '$INJECT_EVIDENCE_DIR', taskId: '$ACC_TASK_ID',
    injectTs: $INJECT_TS, target: '$TARGET', meta: { node_hint: 'run_sub_task' }
  }));
"
[ -f "$INJECT_EVIDENCE_DIR/inject-a.json" ] || { echo "evidence file inject-a.json not written"; exit 1; }

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

**硬阈值**: 注入后 5 min 内 llm_retry events ≥ 1 且 ≤ 3；90s 后 task.status ∈ {in_progress, completed}；不接受 failed/cancelled；`inject-a.json` 必须落盘（含 INJECT_TS、target container、kind=A）。

---

### Step 5: 故障注入 B — max_fix_rounds → W5 interrupt → 主理人 abort（含 24h SLA）

**可观测行为**: final_evaluate 持续 FAIL 撞 max_fix_rounds 后，W5 触发 `interrupt()` 写一条 `harness_interrupts` pending 记录；模拟主理人 POST `/api/brain/harness-interrupts/:id/resume {action:"abort"}`；interrupt 进入 `resumed`；graph 干净走到 END(error) 不死循环；**`resumed_at - created_at < 24h` 否则报告备注"超 W5 自动超时阈值，本次实际 abort 时刻可能被 W5 timer 抢先"**（R3 mitigation）；**注入证据独立落盘到 `$INJECT_EVIDENCE_DIR/inject-b.json`**（R4 mitigation）。

**验证命令**:
```bash
set -e
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)
DISPATCH_TS=$(psql "$DB" -t -c "SELECT extract(epoch FROM created_at)::bigint FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')

# 等待 harness_interrupts pending 出现（最多 15 分钟，与 max_fix_rounds 触发时长配套）
PENDING_ID=""
PENDING_CREATED_TS=""
for i in $(seq 1 30); do
  ROW=$(psql "$DB" -t -A -F '|' -c "
    SELECT id, extract(epoch FROM created_at)::bigint
    FROM harness_interrupts
    WHERE task_id='$ACC_TASK_ID'
      AND status='pending'
      AND extract(epoch FROM created_at) >= $DISPATCH_TS
    ORDER BY created_at DESC LIMIT 1
  " | tr -d ' ')
  PENDING_ID=$(echo "$ROW" | cut -d'|' -f1)
  PENDING_CREATED_TS=$(echo "$ROW" | cut -d'|' -f2)
  [ -n "$PENDING_ID" ] && [ "$PENDING_ID" != "" ] && break
  sleep 30
done
[ -n "$PENDING_ID" ] || { echo "no harness_interrupts pending 15min after dispatch"; exit 1; }

INJECT_TS=$(date -u +%s)
# R4 mitigation: 独立 evidence
node -e "
  import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(m => m.recordInjectionTimestamp({
    kind: 'B', dir: '$INJECT_EVIDENCE_DIR', taskId: '$ACC_TASK_ID',
    injectTs: $INJECT_TS, target: '$PENDING_ID',
    meta: { interrupt_id: '$PENDING_ID', pending_created_ts: $PENDING_CREATED_TS }
  }));
"

# 模拟主理人 abort
RESP=$(curl -fsS -X POST "localhost:5221/api/brain/harness-interrupts/$PENDING_ID/resume" \
  -H "Content-Type: application/json" \
  -d '{"action":"abort","reason":"acceptance v4 scenario B"}')
echo "$RESP" | jq -e '.status == "resumed" or .resumed == true' >/dev/null \
  || { echo "resume API did not return resumed: $RESP"; exit 1; }

# 数据库确认进入 resumed + R3 24h SLA 校验
SLA_ROW=$(psql "$DB" -t -A -F '|' -c "
  SELECT status, extract(epoch FROM resumed_at)::bigint, extract(epoch FROM created_at)::bigint
  FROM harness_interrupts
  WHERE id='$PENDING_ID'
" | tr -d ' ')
RESUMED=$(echo "$SLA_ROW" | cut -d'|' -f1)
RESUMED_TS=$(echo "$SLA_ROW" | cut -d'|' -f2)
CREATED_TS=$(echo "$SLA_ROW" | cut -d'|' -f3)
[ "$RESUMED" = "resumed" ] || { echo "interrupt status not resumed: $RESUMED"; exit 1; }

# R3: delta < 24h（86400s）作为 happy path；超过则报告备注（不算 fail，因为 W5 已自动 abort，结果一致）
DELTA=$((RESUMED_TS - CREATED_TS))
node -e "
  import('./scripts/acceptance/w8-v4/render-report.mjs').then(m => m.assertInterruptResumeSla({
    interruptId: '$PENDING_ID', deltaSec: $DELTA, slaSec: 86400,
    evidenceDir: '$INJECT_EVIDENCE_DIR'
  }));
"
# 该 helper 行为：delta < 86400s → 写 happy 标记到 inject-b.json；≥86400s → 写 sla-exceeded note 但不抛错（报告 caveat）

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

**硬阈值**: 15min 内 harness_interrupts.pending 出现且 task_id 匹配；abort 后 .status='resumed'；resume 后 5min 内 graph 走到 terminal_fail 节点 OR task.status=failed（即非死循环）；`inject-b.json` 落盘；`assertInterruptResumeSla` delta 字段写入 evidence（< 24h 标 happy；≥ 24h 标 caveat 但不阻断）。

---

### Step 6: 故障注入 C — Deadline 逾期 watchdog → attempt N+1

**可观测行为**: `UPDATE initiative_runs.deadline_at = NOW() - 1min`，W3 watchdog 5 分钟内扫到 → 标 `phase=failed, failure_reason=watchdog_overdue`；下次 dispatch 同 initiative_id 时 W1 attempt N+1 fresh thread 启动；**注入证据独立落盘到 `$INJECT_EVIDENCE_DIR/inject-c.json`**（R4 mitigation）。

**验证命令**:
```bash
set -e
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"

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

# R4 mitigation: 独立 evidence
node -e "
  import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(m => m.recordInjectionTimestamp({
    kind: 'C', dir: '$INJECT_EVIDENCE_DIR', taskId: 'harness-acceptance-v4-2026-05-08',
    injectTs: $INJECT_TS, target: 'initiative_runs.deadline_at',
    meta: { rows_updated: $ROWS }
  }));
"

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

**硬阈值**: 5min 内 phase=failed；failure_reason='watchdog_overdue'；重派后 max(attempt) +1；`inject-c.json` 落盘。

---

### Step 7: 终态校验 + 报告 + lead 自验文件 + KR 回写（含 evidence replay）

**可观测行为**: acceptance task 终态 `status=completed`；`docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md` 含 14 节点证据 + v3→v4 diff 表 + 3 个故障注入时间线 + 24h SLA caveat（如 Step 5 触发）；`.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md` 含 5 项 lead 命令 stdout；KR "管家闭环" progress ≥ 7（从 6/7 推进）；**evaluator 调 `replayInjectionEvidence` 从 `$INJECT_EVIDENCE_DIR` 回放 3 个 inject-{a,b,c}.json 证据，即使某 step 中途 race fail 也能定位到具体注入时刻 → 系统反应时刻 → 终态**（R4 mitigation 闭环）。

**验证命令**:
```bash
set -e
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
ACC_TASK_ID=$(cat /tmp/acc-v4-task-id.txt)

# 1. task.status=completed
FINAL=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
[ "$FINAL" = "completed" ] || { echo "task not completed: $FINAL"; exit 1; }

# 2. R4 mitigation 闭环：3 个 evidence 文件齐全 + replay 解析无错
for k in a b c; do
  [ -f "$INJECT_EVIDENCE_DIR/inject-$k.json" ] \
    || { echo "missing inject-$k.json (R4 cascade may have masked failure)"; exit 1; }
done
node -e "
  import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(async m => {
    const replay = await m.replayInjectionEvidence({ dir: '$INJECT_EVIDENCE_DIR' });
    if (replay.length !== 3) { console.error('expected 3 evidence files, got ' + replay.length); process.exit(2); }
    if (!replay.every(r => ['A','B','C'].includes(r.kind))) { console.error('kinds mismatch'); process.exit(3); }
  });
"

# 3. acceptance 报告存在 + 关键内容
REPORT="docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md"
[ -f "$REPORT" ] || { echo "report file missing: $REPORT"; exit 1; }
[ "$(wc -c < "$REPORT")" -gt 2000 ] || { echo "report too short ($(wc -c < "$REPORT") bytes), not real evidence"; exit 1; }
grep -qE 'v3.*v4|v3 → v4|v3→v4' "$REPORT" || { echo "report missing v3→v4 diff section"; exit 1; }
grep -qE 'graph_node_update|14[ /]+14' "$REPORT" || { echo "report missing 14-node evidence"; exit 1; }
grep -qE '故障注入 A|Docker SIGKILL' "$REPORT" || { echo "report missing fault injection A"; exit 1; }
grep -qE '故障注入 B|max_fix_rounds|W5 interrupt' "$REPORT" || { echo "report missing fault injection B"; exit 1; }
grep -qE '故障注入 C|watchdog' "$REPORT" || { echo "report missing fault injection C"; exit 1; }
grep -qE '注入时刻|inject.*at|reaction.*at' "$REPORT" || { echo "report missing injection→reaction timeline"; exit 1; }

# 4. lead 自验证据文件存在 + 含 5 项 lead 命令 stdout 摘录
LEAD=".agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md"
[ -f "$LEAD" ] || { echo "lead evidence missing: $LEAD"; exit 1; }
[ "$(wc -c < "$LEAD")" -gt 1000 ] || { echo "lead evidence too short"; exit 1; }
for kw in "rev-parse" "brain/status" "/api/brain/tasks" "task_events" "status FROM tasks"; do
  grep -qF "$kw" "$LEAD" || { echo "lead evidence missing keyword: $kw"; exit 1; }
done

# 5. KR 进度推进
KR_PROGRESS=$(curl -fsS localhost:5221/api/brain/okr/current \
  | jq -r '[.objectives[]? .key_results[]? | select((.title // .name) | contains("管家闭环"))][0].progress_pct // 0')
[ "$KR_PROGRESS" != "0" ] && [ "$KR_PROGRESS" != "null" ] || { echo "KR 管家闭环 not found"; exit 1; }
[ "$(echo "$KR_PROGRESS >= 7" | bc -l)" = "1" ] || { echo "KR 管家闭环 progress=$KR_PROGRESS, expect ≥7"; exit 1; }

# 6. 子 dev task PR merged（acceptance 派出的子任务真正走完 dev pipeline）
SUB_PR=$(psql "$DB" -t -c "
  SELECT count(*) FROM dev_records dr
  JOIN tasks t ON t.id = dr.task_id
  WHERE t.parent_task_id='$ACC_TASK_ID'
    AND dr.merged = true
    AND dr.created_at > NOW() - interval '90 minutes'
" | tr -d ' ')
[ "$SUB_PR" -ge 1 ] || { echo "no merged subtask PR for acceptance, got $SUB_PR"; exit 1; }
```

**硬阈值**: task.status=completed；3 个 inject-{a,b,c}.json 齐全 + replay 返回 3 项；report ≥ 2000 字节 + 6 个关键章节 grep 命中；lead evidence ≥ 1000 字节 + 5 个 lead 命令关键字命中；KR 管家闭环 progress ≥ 7；过去 90 分钟内 ≥ 1 个 acceptance 子任务 PR merged。

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

# ===== R2 顶部共享变量（internal_consistency 加固）=====
# inferTaskPlan propose_branch 严格正则；Step 1 校验源码 + Step 3 校验运行时值同源
INFER_BRANCH_RE='^cp-harness-propose-r[1-9][0-9]*-[a-f0-9]{8}$'
# 故障注入 evidence 目录（R4 cascade mitigation）
INJECT_EVIDENCE_DIR='/tmp/acc-v4-inject'
mkdir -p "$INJECT_EVIDENCE_DIR"

# ---- Step 1: deploy 一致性 ----
BRAIN_HEAD=$(docker exec brain git rev-parse HEAD)
git fetch origin main >/dev/null 2>&1
MAIN_HEAD=$(git rev-parse origin/main)
[ "$BRAIN_HEAD" = "$MAIN_HEAD" ] || { echo "FAIL Step1: brain stale"; exit 1; }
docker exec brain grep -qF "每轮（含被 REVISION 打回轮）" packages/workflows/skills/harness-contract-proposer/SKILL.md
docker exec brain grep -qE 'cp-harness-propose-r\$\{round\}-\$\{taskIdSlice\}' packages/brain/src/workflows/harness-gan.graph.js
# 源码字面量同源校验（与 INFER_BRANCH_RE 对齐）
SRC_FORMAT=$(docker exec brain grep -oE 'cp-harness-propose-r\$\{[a-zA-Z]+\}-\$\{[a-zA-Z]+\}' packages/brain/src/workflows/harness-gan.graph.js | head -1)
[ "$SRC_FORMAT" = 'cp-harness-propose-r${round}-${taskIdSlice}' ] || { echo "FAIL Step1: source diverged from INFER_BRANCH_RE"; exit 1; }
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
echo "$INFER_BRANCH" | grep -qE "$INFER_BRANCH_RE" || { echo "FAIL Step3: inferTaskPlan branch=$INFER_BRANCH (expect $INFER_BRANCH_RE)"; exit 1; }

# ---- Step 4-6: 故障注入（注：实际 acceptance run 中 Brain 自驱触发 LLM_RETRY，evaluator 这里仅观测被动证据） ----
# Step 4 evidence — 累计上限 9 = 单次 cap 3 × 3 个 LLM_RETRY 注入窗口（A/B/C 三场景各最多 3 次）
RETRY_AFTER=$(psql "$DB" -t -c "SELECT count(*) FROM task_events WHERE task_id='$ACC_TASK_ID' AND event_type='llm_retry' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
[ "$RETRY_AFTER" -ge 1 ] && [ "$RETRY_AFTER" -le 9 ] || { echo "FAIL Step4: llm_retry count=$RETRY_AFTER (expect 1-9 across 3 injections)"; exit 1; }

# Step 5 evidence — 含 24h SLA delta 计算（R3 mitigation）
INTR_ROW=$(psql "$DB" -t -A -F '|' -c "SELECT count(*), max(extract(epoch FROM resumed_at)::bigint - extract(epoch FROM created_at)::bigint) FROM harness_interrupts WHERE task_id='$ACC_TASK_ID' AND status='resumed' AND extract(epoch FROM created_at) >= $DISPATCH_TS" | tr -d ' ')
INTR_COUNT=$(echo "$INTR_ROW" | cut -d'|' -f1)
INTR_MAX_DELTA=$(echo "$INTR_ROW" | cut -d'|' -f2)
[ "$INTR_COUNT" -ge 1 ] || { echo "FAIL Step5: no resumed interrupt"; exit 1; }
# delta < 86400s 是 happy；≥86400s 写 caveat 但不阻断（W5 自动 abort 也算成功路径）
if [ -n "$INTR_MAX_DELTA" ] && [ "$INTR_MAX_DELTA" -ge 86400 ]; then
  echo "WARN Step5: interrupt resume delta=${INTR_MAX_DELTA}s exceeds 24h SLA — likely W5 auto-abort, see report caveat"
fi

# Step 6 evidence
WD=$(psql "$DB" -t -c "SELECT count(*) FROM initiative_runs WHERE initiative_id='harness-acceptance-v4-2026-05-08' AND failure_reason='watchdog_overdue'" | tr -d ' ')
[ "$WD" -ge 1 ] || { echo "FAIL Step6: no watchdog_overdue row"; exit 1; }
ATT_MAX=$(psql "$DB" -t -c "SELECT max(attempt) FROM initiative_runs WHERE initiative_id='harness-acceptance-v4-2026-05-08'" | tr -d ' ')
[ "$ATT_MAX" -ge 2 ] || { echo "FAIL Step6: max attempt=$ATT_MAX (expect ≥2 after watchdog→reattempt)"; exit 1; }

# ---- Step 7: 终态 + 报告 + lead 自验 + KR + R4 evidence replay ----
FINAL=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$ACC_TASK_ID'" | tr -d ' ')
[ "$FINAL" = "completed" ] || { echo "FAIL Step7: task=$FINAL"; exit 1; }
# R4 evidence replay
for k in a b c; do
  [ -f "$INJECT_EVIDENCE_DIR/inject-$k.json" ] || { echo "FAIL Step7: evidence inject-$k.json missing (R4 cascade unmasked)"; exit 1; }
done
node -e "import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(async m => { const r = await m.replayInjectionEvidence({ dir: '$INJECT_EVIDENCE_DIR' }); if (r.length !== 3) process.exit(2); });"
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
- `waitFor14GraphNodeEvents({query, taskId, dispatchTs, timeoutSec})` — 轮询 task_events，返回 distinct node 列表（≤14 即返回，含 inferTaskPlan branch 校验，正则与 contract 顶部 INFER_BRANCH_RE 同源）

**大小**: M（约 200 行 lib + 100 行测试）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/acceptance-helper.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/lib.mjs`（新建）

---

### Workstream 2: 故障注入 A/B/C 自愈观测 helper（含 R4 evidence 落盘 + 回放）

**范围**: 实现 `scripts/acceptance/w8-v4/fault-inject.mjs`，导出：
- `findContainerForTask({docker, taskId})` — `docker ps --filter` 取第一个 container name
- `pollLlmRetryEvents({query, taskId, sinceTs, capMax=3})` — 5min 内 poll，返回 retry 数；超过 cap 抛错
- `pollHarnessInterruptPending({query, taskId, sinceTs, timeoutMin=15})` — poll harness_interrupts，返回 pending row id
- `injectInitiativeDeadlineOverdue({db, initiativeId})` — 仅 UPDATE phase=running 行；返回受影响行数（必须 ≥1）
- `assertWatchdogMarkedFailed({db, initiativeId, sinceTs, timeoutMin=5})` — 校验 phase=failed + failure_reason=watchdog_overdue
- **`recordInjectionTimestamp({kind, dir, taskId, injectTs, target, meta})`** — R4 mitigation：写 `${dir}/inject-${kind.toLowerCase()}.json`，含 kind/taskId/injectTs/target/meta 字段；mkdir -p；原子 write
- **`replayInjectionEvidence({dir})`** — R4 mitigation：读 `${dir}/inject-{a,b,c}.json` 三个文件，校验 kind ∈ {A,B,C}，返回数组 `[{kind, taskId, injectTs, target, meta}, ...]`；缺文件抛错

**大小**: L（约 350 行 lib + 200 行测试）
**依赖**: Workstream 1 完成后（共享同一 DB query helper）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/fault-inject.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/fault-inject.mjs`（新建）

---

### Workstream 3: 终态校验 + 报告生成器 + lead 自验文件骨架 + R3 SLA helper

**范围**: 实现 `scripts/acceptance/w8-v4/render-report.mjs`，导出：
- `renderAcceptanceReport({taskId, dispatchTs, mode, db, slaCaveats})` — 拼接 Markdown，含 14 节点 SQL 输出 + v3→v4 diff 表 + 3 个故障注入时间线 + （若有）24h SLA caveat 段；mode='dryrun-nodes-only' 时只输出节点统计供 Step 3 校验
- `renderLeadEvidence({brainHead, mainHead, brainStatus, accTaskId, terminalStatus})` — 生成 `.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md` 骨架，注入 5 项 lead 命令 stdout 摘录占位 + 必含 keyword
- `writeReportFiles({reportPath, leadPath, content})` — 原子写盘（mkdir -p + write）
- **`assertInterruptResumeSla({interruptId, deltaSec, slaSec=86400, evidenceDir})`** — R3 mitigation：delta < slaSec 写 happy 标记到 inject-b.json；≥ slaSec 写 sla-exceeded caveat 但不抛错（W5 自动 abort 也是合法路径）；返回 `{ withinSla: boolean, caveat: string|null }`

**大小**: M（约 300 行 lib + 150 行测试）
**依赖**: Workstream 2 完成后（render 时需读取 fault-inject 产物 + assertInterruptResumeSla 写 inject-b.json）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/render-report.test.ts`

**预期受影响文件**:
- `scripts/acceptance/w8-v4/render-report.mjs`（新建）
- `docs/superpowers/reports/2026-05-08-harness-langgraph-acceptance-v4.md`（运行时生成；renderer 测试只验证字符串内容，最终文件由 acceptance run 时 renderer 调用产出）
- `.agent-knowledge/harness-langgraph-14-node/lead-acceptance-w8-v4.md`（同上）

---

## Test Contract（R2 加固：每行含首条 expect 行号 + 断言原文）

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（首条 expect 行号 + 断言原文） |
|---|---|---|---|
| WS1 | `tests/ws1/acceptance-helper.test.ts` | assertBrainImageInSync 抛错；registerAndDispatchAcceptance 返回 task_id；waitFor14GraphNodeEvents 14 节点 + inferTaskPlan branch 校验 | 模块未实现 → vitest 报 `Cannot find module './scripts/acceptance/w8-v4/lib.mjs'`，**首条断言** `tests/ws1/acceptance-helper.test.ts:19 await expect(assertBrainImageInSync({ exec })).rejects.toThrow(/stale\|mismatch\|aaaaaaaa/i)` 直接 fail（非 import 错误而是断言落空） → **7 failures** |
| WS2 | `tests/ws2/fault-inject.test.ts` | findContainerForTask 取第一个；pollLlmRetryEvents cap=3 抛错；pollHarnessInterruptPending 含 task_id；injectInitiativeDeadlineOverdue 仅改 running；assertWatchdogMarkedFailed 严格 reason；**recordInjectionTimestamp 写 JSON**；**replayInjectionEvidence 读 3 文件** | 模块未实现 → **首条断言** `tests/ws2/fault-inject.test.ts:19 expect(name).toBe('container-aaa')` 直接 fail → **R2 新增覆盖 R4 helpers 的红测试**（≥ 13 failures：原 9 + record 写 JSON + 自动 mkdir + replay 三件齐全 + replay 缺件抛错） |
| WS3 | `tests/ws3/render-report.test.ts` | renderAcceptanceReport 6 章节；renderLeadEvidence 5 关键字；writeReportFiles 原子；**assertInterruptResumeSla 24h 边界** | 模块未实现 → **首条断言** `tests/ws3/render-report.test.ts:44 expect(md.length).toBeGreaterThanOrEqual(2000)` 直接 fail → **R2 新增覆盖 R3 SLA helper 红测试**（≥ 8 failures：原 5 + slaCaveats 段 + R3 SLA happy + R3 SLA exceeded） |

---

## GAN 对抗焦点（Reviewer 审查重点）

本合同的 Reviewer 应特别挑战：

1. **Step 3 防造假**: 14 节点用 `count(DISTINCT payload->>'node')` 而非 `count(*)`；显式遍历 14 个 expected node name 校验每个 ≥ 1，防止"14 条事件全是同一节点"造假；inferTaskPlan branch 用顶部共享 `$INFER_BRANCH_RE`（`^cp-harness-propose-r[1-9]\d*-[a-f0-9]{8}$`）防止"任意字符串都过"，且与 Step 1 源码字面量校验同源（防漂移）。
2. **Step 4 cap 校验 + 累计上限注释**: `RETRY_COUNT ≤ 3` 单次 cap；E2E `RETRY_AFTER ≤ 9` 注释明示 `# 累计上限 9 = 单次 cap 3 × 3 个 LLM_RETRY 注入窗口`，防止 reviewer 困惑"为什么 9"。
3. **Step 5 死循环检测 + R3 24h SLA**: resume 后 5min 内必须看到 `terminal_fail` 节点 OR `task.status=failed`；新增 `assertInterruptResumeSla` 校验 `resumed_at - created_at` delta，<24h 标 happy，≥24h 写 caveat（W5 自动 abort 不算 fail，结果一致）。
4. **Step 6 attempt N+1**: 用 `max(attempt)` BEFORE/AFTER 对比，而非 `attempt > 1`，能识别真正的 N→N+1 增长。
5. **R4 cascade mitigation**: 故障注入 A/B/C 各写独立 `inject-{a,b,c}.json`；evaluator Step 7 调 `replayInjectionEvidence` 校验 3 文件齐全 + kind 正确 + 即使前序 race 失败也能从 evidence 文件回放定位时刻链。
6. **Step 7 报告字节数**: ≥ 2000 字节 + 6 个关键 grep，防止 `echo "OK" > report` 造假。
7. **Step 1 deploy 校验**: 用 `docker exec brain grep` 命中具体修复指纹，而非比对 commit hash（commit hash 可能有 fast-forward 但代码尚未生效）；新增 2b 源码字面量同源校验（防 INFER_BRANCH_RE 与代码漂移）。
8. **时间窗口**: 所有 SQL `count(*)` / `select` 都带 `extract(epoch FROM created_at) >= $DISPATCH_TS` 或 `created_at > NOW() - interval '...'`，防止匹配 v1/v2/v3 历史残留。
9. **curl -f flag**: 所有 HTTP 调用都加 `-f`，HTTP 5xx 立即退出。
