# Sprint Contract Draft (Round 1)

## Golden Path

[入口: harness_initiative task 派发]
  → [Step 1: 14 节点 happy path 全程命中]
  → [Step 2: PgCheckpointer 真持久化 14 节点链路]
  → [Step 3: kill brain → 同 thread_id resume，从最近 checkpoint 续跑]
  → [出口: brain_tasks status ∈ {completed, failed} + dev-records ≥ 1 条]

---

### Step 1: 14 节点 happy path 全程命中（含 retry/terminal_fail 合法跳过）

**可观测行为**：派发一条最小 `harness_initiative` 任务后，LangGraph 图按拓扑顺序至少命中 12 个 happy path 节点（`prep, planner, parsePrd, ganLoop, inferTaskPlan, dbUpsert, pick_sub_task, run_sub_task, evaluate, advance, final_evaluate, report`），`retry` / `terminal_fail` 在最小 PRD 下未被命中即视为合法跳过。每节点在 `traversal-observer` 助手记录 ≥1 条 enter/exit 事件。

**验证命令**：
```bash
# 跑全图 acceptance traversal smoke（新增脚本，由 Generator 创建）
cd /workspace
TASK_ID=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID="harness-initiative-${TASK_ID}"
node packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs \
  --task-id "$TASK_ID" --thread-id "$THREAD_ID" 2>&1 | tee /tmp/w8-traversal.log

# 期望 stdout 含 VISITED_NODES 行，且 12 个 happy 节点都出现一次以上
grep -E "^VISITED_NODES:" /tmp/w8-traversal.log | head -1 \
  | grep -oE "(prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|final_evaluate|report)" \
  | sort -u | wc -l \
  | awk '{ if ($1 < 12) { print "FAIL: only " $1 "/12 happy nodes hit"; exit 1 } else print "OK: " $1 "/12 happy nodes hit" }'

# 同时确认 retry / terminal_fail 在本 happy run 是合法"未命中"——脚本应输出 SKIPPED_NODES: retry,terminal_fail
grep -E "^SKIPPED_NODES:" /tmp/w8-traversal.log | grep -E "retry" | grep -E "terminal_fail" \
  || { echo "FAIL: retry/terminal_fail 未被显式标记为 SKIPPED"; exit 1; }
```

**硬阈值**：脚本 exit 0 + happy 节点访问数 ≥ 12（共 14 节点中 12 个 happy 必经，retry/terminal_fail 合法跳过）；脚本耗时 < 180s（最小 Initiative 端到端预算）。

---

### Step 2: PgCheckpointer 真持久化（无 MemorySaver fallback）

**可观测行为**：Step 1 跑完后，Pg `checkpoints` 表有以本次 `thread_id` 为键的多条记录，至少 12 条不同 `metadata->>'source'` / `checkpoint->>'channel_values.__node__'` 对应 happy path 12 节点；同时图源代码中 `MemorySaver` 引用已被 Stream 2 删除（除测试外）；`getPgCheckpointer` 自动注入路径在 hotfix #2846 后必经。

**验证命令**：
```bash
# 2.1 查 checkpoints 表，确认 14 节点链路（happy path 至少 12 节点 each ≥1 entry）
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
THREAD_ID=$(cat /tmp/w8-traversal.log | grep -oE "^THREAD_ID: \S+" | awk '{print $2}')
[ -n "$THREAD_ID" ] || { echo "FAIL: THREAD_ID 未从 Step 1 日志解析到"; exit 1; }

# 总 entry 数 ≥ 14（每节点至少 1）
TOTAL=$(psql "$DB" -t -A -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID' AND created_at > NOW() - interval '10 minutes'")
[ "$TOTAL" -ge 14 ] || { echo "FAIL: total checkpoints=$TOTAL < 14"; exit 1; }

# 不同节点（按 metadata->'writes' 中出现的 node 名）≥ 12
DISTINCT_NODES=$(psql "$DB" -t -A -c "
  SELECT count(DISTINCT k) FROM checkpoints,
    jsonb_object_keys(coalesce(metadata->'writes', '{}'::jsonb)) AS k
  WHERE thread_id='$THREAD_ID'
    AND created_at > NOW() - interval '10 minutes'
    AND k IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert',
              'pick_sub_task','run_sub_task','evaluate','advance','final_evaluate','report')
")
[ "$DISTINCT_NODES" -ge 12 ] || { echo "FAIL: distinct happy nodes=$DISTINCT_NODES < 12"; exit 1; }

# 2.2 源码中无 MemorySaver fallback（Stream 2 已删除 ganLoop fallback；只测试文件可保留）
grep -n "MemorySaver" packages/brain/src/workflows/harness-initiative.graph.js \
  && { echo "FAIL: harness-initiative.graph.js 仍引用 MemorySaver"; exit 1; }
echo "OK: source 无 MemorySaver"

# 2.3 hotfix #2846 路径生效——traversal smoke 输出 PG_CHECKPOINTER_INJECTED: true
grep -E "^PG_CHECKPOINTER_INJECTED: true$" /tmp/w8-traversal.log \
  || { echo "FAIL: PgCheckpointer auto-inject 未观测到（hotfix 路径未生效）"; exit 1; }
```

**硬阈值**：`checkpoints` 表 thread_id 行数 ≥ 14（10 分钟时间窗内）；distinct happy nodes ≥ 12；源码 grep `MemorySaver` 命中数 = 0；smoke 输出 `PG_CHECKPOINTER_INJECTED: true`。

---

### Step 3: kill-resume on 14-node graph（幂等 + 续跑）

**可观测行为**：在 Step 1 跑到中段（约 `evaluate` 节点完成后）强制中断 brain 进程，然后用同 `thread_id` 重新 invoke，图从最近 checkpoint 恢复继续执行到终态；resume 不重复执行已完成节点的副作用（`brain_tasks` 表无重复 sub_task 行、`dev-records` 表本 initiative 仅 1 条）。

**验证命令**：
```bash
# 3.1 跑 kill-resume smoke（新增脚本）
cd /workspace
TASK_ID=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID="harness-initiative-kr-${TASK_ID}"
node packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs \
  --task-id "$TASK_ID" --thread-id "$THREAD_ID" \
  --kill-after-node evaluate 2>&1 | tee /tmp/w8-kill-resume.log

# 3.2 确认 RESUME_OK 标记
grep -E "^RESUME_OK$" /tmp/w8-kill-resume.log \
  || { echo "FAIL: smoke 未输出 RESUME_OK"; exit 1; }

# 3.3 确认幂等（无副作用重复）
grep -E "^NO_DUPLICATE_SIDE_EFFECT$" /tmp/w8-kill-resume.log \
  || { echo "FAIL: smoke 检测到副作用重复（节点幂等门破损）"; exit 1; }

# 3.4 DB 层复检：dev-records 表本 task_id 关联记录 = 1
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
DEVREC_COUNT=$(psql "$DB" -t -A -c "
  SELECT count(*) FROM dev_records
  WHERE task_id='$TASK_ID'
    AND created_at > NOW() - interval '10 minutes'
")
[ "$DEVREC_COUNT" -eq 1 ] || { echo "FAIL: dev-records 本 task_id 行数=$DEVREC_COUNT，期望恰好 1（幂等）"; exit 1; }

# 3.5 brain_tasks 终态
TASK_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM brain_tasks WHERE id='$TASK_ID'")
case "$TASK_STATUS" in
  completed|failed) echo "OK: task 终态=$TASK_STATUS" ;;
  *) echo "FAIL: task 仍在中间态: $TASK_STATUS"; exit 1 ;;
esac
```

**硬阈值**：smoke 输出 `RESUME_OK` + `NO_DUPLICATE_SIDE_EFFECT`；`dev_records` 本 task_id 行数 = 1（恰好 1，证明幂等）；`brain_tasks.status ∈ {completed, failed}`。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous
**journey_type_reason**: 整个验证只触碰 packages/brain/ 内的 LangGraph harness 运行时持久化与节点遍历，无 UI、无 dev pipeline、无 agent 协议变更。

**完整验证脚本**：
```bash
#!/bin/bash
set -e

cd /workspace
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# 0. 前置：docker-compose 起 Pg + Brain（若已起略过）
docker compose ps brain | grep -qE "running|Up" \
  || { echo "FAIL: brain 容器未起，跑 docker compose up -d 后再试"; exit 1; }
docker compose ps postgres | grep -qE "running|Up" \
  || { echo "FAIL: postgres 容器未起"; exit 1; }

# 1. Step 1 — 14 节点 traversal smoke
TASK_ID_T=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID_T="harness-initiative-${TASK_ID_T}"
node packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs \
  --task-id "$TASK_ID_T" --thread-id "$THREAD_ID_T" 2>&1 | tee /tmp/w8-traversal.log

HAPPY_HIT=$(grep -E "^VISITED_NODES:" /tmp/w8-traversal.log | head -1 \
  | grep -oE "(prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|final_evaluate|report)" \
  | sort -u | wc -l)
[ "$HAPPY_HIT" -ge 12 ] || { echo "FAIL: Step1 happy 节点 $HAPPY_HIT/12"; exit 1; }
grep -E "^PG_CHECKPOINTER_INJECTED: true$" /tmp/w8-traversal.log \
  || { echo "FAIL: PgCheckpointer 未自动注入"; exit 1; }

# 2. Step 2 — Pg 持久化复检
TOTAL=$(psql "$DB" -t -A -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID_T' AND created_at > NOW() - interval '10 minutes'")
[ "$TOTAL" -ge 14 ] || { echo "FAIL: Step2 checkpoints=$TOTAL < 14"; exit 1; }

DISTINCT_NODES=$(psql "$DB" -t -A -c "
  SELECT count(DISTINCT k) FROM checkpoints,
    jsonb_object_keys(coalesce(metadata->'writes', '{}'::jsonb)) AS k
  WHERE thread_id='$THREAD_ID_T'
    AND created_at > NOW() - interval '10 minutes'
    AND k IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert',
              'pick_sub_task','run_sub_task','evaluate','advance','final_evaluate','report')
")
[ "$DISTINCT_NODES" -ge 12 ] || { echo "FAIL: Step2 distinct happy nodes=$DISTINCT_NODES < 12"; exit 1; }

grep -n "MemorySaver" packages/brain/src/workflows/harness-initiative.graph.js \
  && { echo "FAIL: 源码仍引用 MemorySaver"; exit 1; } || true

# 3. Step 3 — kill-resume
TASK_ID_K=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID_K="harness-initiative-kr-${TASK_ID_K}"
node packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs \
  --task-id "$TASK_ID_K" --thread-id "$THREAD_ID_K" \
  --kill-after-node evaluate 2>&1 | tee /tmp/w8-kill-resume.log

grep -E "^RESUME_OK$" /tmp/w8-kill-resume.log || { echo "FAIL: Step3 RESUME_OK 缺失"; exit 1; }
grep -E "^NO_DUPLICATE_SIDE_EFFECT$" /tmp/w8-kill-resume.log || { echo "FAIL: Step3 副作用重复"; exit 1; }

DEVREC=$(psql "$DB" -t -A -c "SELECT count(*) FROM dev_records WHERE task_id='$TASK_ID_K' AND created_at > NOW() - interval '10 minutes'")
[ "$DEVREC" -eq 1 ] || { echo "FAIL: Step3 dev_records=$DEVREC ≠ 1"; exit 1; }

TASK_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM brain_tasks WHERE id='$TASK_ID_K'")
case "$TASK_STATUS" in
  completed|failed) ;;
  *) echo "FAIL: Step3 task 仍在中间态: $TASK_STATUS"; exit 1 ;;
esac

echo "OK: W8 Acceptance v7 Golden Path 全程通过"
```

**通过标准**：脚本 exit 0；Step1 happy 节点 ≥ 12，Step2 checkpoints 行数 ≥ 14、distinct happy nodes ≥ 12、源码 MemorySaver 引用 = 0，Step3 RESUME_OK + NO_DUPLICATE_SIDE_EFFECT + dev_records = 1 + brain_tasks 终态。

---

## Workstreams

workstream_count: 3

### Workstream 1: 14 节点 traversal observer + happy path 验收测试

**范围**：新增 traversal observer 助手模块（包装 `harness-initiative.graph.invoke` 注册 enter/exit 事件 hook，输出 VISITED_NODES / SKIPPED_NODES / PG_CHECKPOINTER_INJECTED 行）+ smoke 脚本 + Vitest 验收测试，覆盖最小 Initiative 12 happy 节点全程命中、retry/terminal_fail 合法跳过。
**大小**：M（150–250 行：observer + smoke 脚本 + 测试）
**依赖**：无
**BEHAVIOR 覆盖测试文件**：`tests/ws1/acceptance-traversal.test.js`

---

### Workstream 2: PgCheckpointer 持久化验证 + 无 MemorySaver 静态守门

**范围**：新增 checkpoint inspector 助手模块（按 thread_id 查 `checkpoints` 表 + 解析 `metadata->'writes'` 拿到节点名集合）+ Vitest 验收测试，跑完 Step 1 后断言 ≥14 行、≥12 distinct happy nodes、`PG_CHECKPOINTER_INJECTED: true`、源码 grep `MemorySaver` 为空。
**大小**：S（80–150 行：inspector + 测试，复用 WS1 smoke 输出）
**依赖**：Workstream 1 完成后（依赖 traversal smoke 产物 thread_id）
**BEHAVIOR 覆盖测试文件**：`tests/ws2/acceptance-pg-persistence.test.js`

---

### Workstream 3: kill-resume on 14-node graph 验收

**范围**：新增 kill-resume runner 助手模块（spawn brain 跑图 → 在指定节点完成后 SIGKILL → 同 thread_id 重新 invoke 续跑）+ smoke 脚本 + Vitest 验收测试，断言 RESUME_OK、节点幂等（无副作用重复）、dev_records 仅 1 条、brain_tasks 终态可达。
**大小**：M（180–280 行：runner + smoke + 测试）
**依赖**：Workstream 1 完成后（共享 observer 与 smoke 基础设施）
**BEHAVIOR 覆盖测试文件**：`tests/ws3/acceptance-kill-resume.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/acceptance-traversal.test.js` | 12 happy 节点全程命中 + retry/terminal_fail 合法跳过 + PgCheckpointer 自动注入观测 | import `acceptance/traversal-observer.js` 失败（模块不存在）→ vitest exit 1 |
| WS2 | `tests/ws2/acceptance-pg-persistence.test.js` | checkpoints 表 ≥14 行 + ≥12 distinct happy node 写入 + 源码无 MemorySaver | import `acceptance/checkpoint-inspector.js` 失败 → vitest exit 1 |
| WS3 | `tests/ws3/acceptance-kill-resume.test.js` | kill 中段 → resume 续跑到终态 + 节点幂等（dev_records=1）+ brain_tasks 终态 | import `acceptance/kill-resume-runner.js` 失败 → vitest exit 1 |
