# Sprint Contract Draft (Round 4)

> Round 3 → Reviewer REVISION，本轮处理 3 项新反馈 + 补 Risk Register ≥ 7：
> (R5 / R-CASCADE-FAILURE, high) Step 1 失败必须立即 `exit 1`，不进 Step 2；E2E 脚本 `set -euo pipefail` 防 cascade 被静默吞；
> (R6 / R-HELPERS-MISSING, medium) E2E 脚本首行守卫 `[ -f sprints/w8-langgraph-acceptance/helpers.sh ] || { echo "FAIL: helpers.sh missing"; exit 2; }`，**exit 2** = 脚手架坏，**exit 1** = 红证据；并在 source 后断言 `W8_ACCEPTANCE_HELPERS_LOADED=1`；
> (R7 / R-PR-NOT-LINKED-TO-INITIATIVE, medium) E2E §Step 3 SELECT 与 §Step 3 主合同对齐双路兜底：`task_id IN (parent_initiative_id 子任务)` **OR** `pr_url LIKE '%harness%'`，并要求 PR diff + main HEAD handler 双确认避免误绿；
> (R8) 顶部新增 §Risk Register 共 8 项已注册风险，覆盖 cascade / helpers / schema drift / pr-link / 重启时序 / watchdog / 重派 / sleep 掩盖。

> **Round 1-3 已处理项保留**（R1 缺失节点诊断行 + 立即 exit 1 / R2 metadata dump / R3 Brain 重启时序兜底 / R4 helpers.sh SSOT）；本轮在已有基础上**收紧** cascade 与脚手架守卫，并把所有缓解措施登记到 Risk Register。

---

## Risk Register（risk_registered ≥ 7，覆盖 cascade / helpers / schema-drift 三大类）

下表登记 8 项验证脚本可能假通过 / 假失败的风险及其缓解措施。Reviewer 可据此逐条核对合同里是否真的有对应防御代码。

| ID | 风险描述 | 严重度 | 类别 | 缓解措施 / 落点 |
|---|---|---|---|---|
| **R-CASCADE-FAILURE** | Step 1 写 `initiative_runs.thread_id` 失败 → Step 2 fallback 取 `THREAD_ID=""` → `count_distinct_nodes_in_checkpoints` 恒回 0；若主路径也少节点，整体仍 exit 0 假绿 | **high** | cascade | (1) E2E 顶部 `set -euo pipefail`；(2) E2E §Step 1 `grep -qE` 不匹配立即 `exit 1`，不进 §Step 2；(3) helper-1/2 见空 `thread_id` 显式 echo `0` / `""` 而不抛 silent 错误；(4) §Step 2 在调用 helpers 前断言 `[ -n "$THREAD_ID" ]`，否则诊断行 + exit 1 |
| **R-HELPERS-MISSING** | `sprints/w8-langgraph-acceptance/helpers.sh` 文件路径漂移 / 提交丢失 → `source` 失败 → 后续 helper 函数 unbound → set -e 导致随机 exit 1，无法判别"红证据"还是"脚手架坏" | medium | scaffold | (1) E2E 首行守卫 `[ -f sprints/w8-langgraph-acceptance/helpers.sh ] \|\| { echo "FAIL: helpers.sh missing"; exit 2; }`；(2) source 后立即断言 `[ "${W8_ACCEPTANCE_HELPERS_LOADED:-0}" = "1" ] \|\| exit 2`；(3) 红证据校验脚本同样守卫 (`grep -F "W8_ACCEPTANCE_HELPERS_LOADED"`)；**exit 2 ≠ exit 1**：脚手架坏要主理人修，而非误判产品红 |
| **R-LANGGRAPH-SCHEMA-DRIFT** | `langgraph_checkpoints` 表 `metadata` jsonb 字段在 LangGraph 版本升级时重命名（如 `source` → `step_source`） → COALESCE 三路全 NULL → fallback distinct=0；若主路径也未 emit，整体假红 | medium | schema | (1) helper-3 `dump_checkpoint_metadata_sample`：`FALLBACK_ROWCOUNT > 0 && DISTINCT_FALLBACK == 0` 时打印 `jsonb_pretty(metadata)` + `jsonb_pretty(channel_values)` 全文便于人检；(2) §Step 2 与 E2E 双处都跑此判定；(3) 任何 LangGraph 升级 PR 必须更新 helper-1/2 的 COALESCE 表达式 |
| **R-PR-NOT-LINKED-TO-INITIATIVE** | `executor.runHarnessInitiativeRouter` 落 `dev_records` 时未把 `tasks.task_id` 串到 `payload->>'parent_initiative_id'='${INITIATIVE_ID}'` → §Step 3 SELECT 拿不到 PR_URL → 直接 exit 1 误判 W8 失败（即便 health PR 实际已 merge） | medium | data-link | (1) §Step 3 + E2E §Step 3 SELECT 用双路兜底：`task_id IN (子任务集合)` **OR** `pr_url LIKE '%harness%'`；(2) 任一兜底命中后仍走完 `gh pr view state=MERGED` + `gh pr diff name-only` + `git show origin/main` 三重校验，确保不会拿到无关 PR 假绿；(3) Risk Register 此项明确登记后续修复方向（executor 关联，独立 PR 处理，不阻塞 W8 验证） |
| **R-BRAIN-OLD-IMAGE** | staging Brain 容器在 PR merge 前已启动（旧镜像无 /health handler）→ §Step 5 curl 永远 404；若 retry 不带时序判定，sleep 重试也无意义 | medium | timing | helper-4 `wait_for_brain_with_pr_merge`：(1) curl 失败 → 取 `gh pr view --json mergedAt` 与 `docker inspect StartedAt`；(2) `started_ts < merged_ts` → sleep 10 重试 ≤3 轮（容器在重启拉新镜像）；(3) `started_ts >= merged_ts` 仍 404 → 立即 exit 1 + 打印两时间戳（新镜像里就没 handler，重试无用） |
| **R-WATCHDOG-OVERDUE** | `initiative_runs` 行 `phase='done'` 但 `failure_reason='watchdog_overdue'`（W3 watchdog 兜底超时打的标）→ §Step 4 仅校验 phase=done 会假绿 | medium | semantics | §Step 4 在断言 phase=done 前先校验 `failure_reason != 'watchdog_overdue'`，并打印 `deadline_at - completed_at` 秒差值；负值（即 completed_at > deadline_at）也立即 exit 1 |
| **R-DUPLICATE-INITIATIVE-RUN** | 同一 `initiative_id` 多次重派（W1 attemptN+1 行为）→ `initiative_runs` 出现 `:1` `:2` 多行；裸 SELECT 可能取错 attempt | low | concurrency | 所有 `initiative_runs` SELECT 强制 `ORDER BY created_at DESC LIMIT 1` + `created_at > NOW() - interval '60 minutes'` 时间窗口；§Step 1 thread_id 正则 `:[0-9]+$` 兼容多 attempt |
| **R-SLEEP-MASKING** | 在 §Step 2 节点缺失时 sleep + retry 等节点出现 → 把"节点真没 emit"误判为"暂时未到"；最终把超时假装成红证据外的状态 | low | flake-mask | R1 修复：§Step 2 缺失节点立即打印 PRIMARY_SET + FALLBACK_SET + MISSING + THREAD_ID 完整诊断行后 exit 1，**禁止 sleep + retry**；helper-4 仅在 `brain.StartedAt < pr.mergedAt` 这一**有时序根因**的场景才允许有限次 sleep（≤3 轮） |

**风险登记总数**: 8 ≥ 7（满足 Reviewer 阈值）。每条风险都对应到合同里至少一处具体代码 / 验证命令，Reviewer 可逐条 grep 核对。

---

## 唯一交付测试文件路径（统一）

为消除 Reviewer 指出的"PRD 写 `tests/integration/harness-health.test.ts`、合同 Workstream 表写 `tests/ws2/harness-health-integration.test.ts`"歧义，本合同显式规定：

| 角色 | 路径 | 何时存在 | 谁写入 |
|---|---|---|---|
| **唯一最终交付测试** | `tests/integration/harness-health.test.ts` | 合并到 main | Generator（commit 2）从 `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` 复制内容 |
| **GAN 红证据 scaffold** | `sprints/w8-langgraph-acceptance/tests/ws2/harness-health-integration.test.ts` | 仅在 sprint 分支 | Proposer（round 1）；commit 1 阶段保留为审计 |
| **GAN 红证据 scaffold（WS1）** | `sprints/w8-langgraph-acceptance/tests/ws1/harness-health-endpoint.test.ts` | 仅在 sprint 分支 | Proposer（round 1） |

**规则**：所有 PRD / 合同 / DoD / task-plan 指代"集成测试文件"时，唯一路径 = `tests/integration/harness-health.test.ts`。Sprint dir 下的 `tests/ws{N}/*.test.ts` 仅用于 GAN 红证据校验（vitest 跑见下文），不进 main。

## Initiative
- **initiative_id**: `w8-langgraph-acceptance-20260507`
- **task_type**: `harness_initiative`
- **journey_type**: `autonomous`
- **journey_type_reason**: 仅改 packages/brain/，Brain 单进程内 LangGraph 自驱的"管家闭环"端到端验收。

---

## 共享 Shell Helpers（处理 R4：消除 fallback SQL 粘贴漂移）

为彻底消除"在合同两处粘贴等价 SQL"的漂移风险，本轮把 4 个 helper 抽到独立可被 source 的真实文件：

**SSOT 路径**：`sprints/w8-langgraph-acceptance/helpers.sh`（本轮 commit 落盘，含全部函数实现）

| 函数 | 责任 | 调用方 |
|---|---|---|
| `count_distinct_nodes_in_checkpoints <thread_id> [window]` | psql 计数 langgraph_checkpoints COALESCE 三路 distinct nodeName | Step 2 + E2E §Step 2 |
| `list_distinct_nodes_in_checkpoints <thread_id> [window]` | psql 取 fallback 集合（逗号分隔字母序） | Step 2 + E2E §Step 2 |
| `dump_checkpoint_metadata_sample <thread_id>` | jsonb_pretty(metadata) + jsonb_pretty(channel_values) sample（R2） | Step 2 + E2E §Step 2 |
| `wait_for_brain_with_pr_merge <url> <pr_num> [container]` | curl /health；失败比对 mergedAt vs StartedAt；started<merged → sleep 10 重试≤3轮；started≥merged 仍 404 → exit 1（R3） | Step 5 + E2E §Step 5 |

**调用约定**（所有验证命令统一）：
```bash
source sprints/w8-langgraph-acceptance/helpers.sh
# 然后调用 helper 函数，禁止内联同等 SQL
```

> 函数实现详见 `sprints/w8-langgraph-acceptance/helpers.sh`（SSOT）。本合同不再重复粘贴函数体；任何调用方与 SSOT 不一致 → Reviewer 判 R4 未修复。

---

## Golden Path

[入口] 派发 `harness_initiative` 任务 → [Step 1] Brain dispatch 入队 + executor 启动 LangGraph stream → [Step 2] 14 节点全程 emit `graph_node_update` 事件 → [Step 3] 阶段 B 产出 health-endpoint PR 并 merge → [Step 4] 阶段 C final_evaluate + report 写终态 → [出口] `GET /api/brain/harness/health` 在 staging 返回 200，`initiative_runs.phase='done'`。

---

### Step 1: Brain dispatch 接收并启动 LangGraph

**可观测行为**: Initiative 任务从 `queued` 转入 `in_progress`，executor 计算出 `thread_id=harness-initiative:w8-langgraph-acceptance-20260507:1`（W1 版本化）并把它写入 `initiative_runs.thread_id`，`initiative_runs.phase` 落到 `A_planning` 或更后阶段（不再是 NULL）。

**验证命令**:
```bash
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

**验证命令**（依赖共享 helpers，严禁内联粘贴 SQL — R4）：
```bash
INITIATIVE_ID="w8-langgraph-acceptance-20260507"
WINDOW="60 minutes"

# 引入共享 helpers
source sprints/w8-langgraph-acceptance/helpers.sh  # helper-1..4 的实现

# ---- 主路径：task_events 表 ----
DISTINCT_PRIMARY=$(psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
" | tr -d ' ')

PRIMARY_SET=$(psql "$DB" -At -c "
  SELECT string_agg(DISTINCT payload->>'nodeName', ',' ORDER BY payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
")

# ---- Fallback 路径：langgraph_checkpoints 表（helper-1/2 复用，R4） ----
THREAD_ID=$(psql "$DB" -At -c "
  SELECT thread_id FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
   ORDER BY created_at DESC LIMIT 1
")

# R5 / R-CASCADE-FAILURE：THREAD_ID 为空意味着 Step 1 没把 thread_id 写进 initiative_runs；
#   此时调 helper-1/2 必回 0 / ""，会让"主路径少节点 + fallback=0"伪装成红证据；必须立即 abort，
#   交由 Step 1 失败先暴露根因，禁止把根因藏进 Step 2 的"双路均不足"。
if [ -z "$THREAD_ID" ]; then
  echo "FAIL Step 2: THREAD_ID 为空 (initiative_runs 未写)，cascade 异常 — abort 不评估 fallback"
  echo "[Step 2 诊断] PRIMARY=$DISTINCT_PRIMARY (set=$PRIMARY_SET)"
  echo "[Step 2 诊断] WINDOW=$WINDOW INITIATIVE_ID=$INITIATIVE_ID"
  exit 1
fi

DISTINCT_FALLBACK=$(count_distinct_nodes_in_checkpoints "$THREAD_ID" "$WINDOW")
FALLBACK_SET=$(list_distinct_nodes_in_checkpoints "$THREAD_ID" "$WINDOW")

echo "[Step 2 诊断] PRIMARY=$DISTINCT_PRIMARY FALLBACK=$DISTINCT_FALLBACK"
echo "[Step 2 诊断] PRIMARY_SET=$PRIMARY_SET"
echo "[Step 2 诊断] FALLBACK_SET=$FALLBACK_SET"

# ---- R2 兜底：fallback 表行存在但 distinct=0（即 COALESCE 三路全 NULL） → dump metadata 全文 ----
FALLBACK_ROWCOUNT=0
if [ -n "$THREAD_ID" ]; then
  FALLBACK_ROWCOUNT=$(psql "$DB" -At -c "
    SELECT count(*) FROM langgraph_checkpoints WHERE thread_id='${THREAD_ID}'
  " | tr -d ' ')
fi
if [ "$FALLBACK_ROWCOUNT" -gt 0 ] && [ "$DISTINCT_FALLBACK" -eq 0 ]; then
  echo "[Step 2 R2 兜底] langgraph_checkpoints 有 $FALLBACK_ROWCOUNT 行但 distinct=0；schema 漂移嫌疑，dump 样本："
  dump_checkpoint_metadata_sample "$THREAD_ID"
fi

# ---- 至少一条路径满足 ≥ 14 ----
if [ "$DISTINCT_PRIMARY" -lt 14 ] && [ "$DISTINCT_FALLBACK" -lt 14 ]; then
  echo "FAIL Step 2: 主路径与 fallback 双路均 < 14"
  echo "             PRIMARY=$DISTINCT_PRIMARY (set=$PRIMARY_SET)"
  echo "             FALLBACK=$DISTINCT_FALLBACK (set=$FALLBACK_SET)"
  exit 1
fi

# ---- 必现节点逐个核（R1：诊断行后 exit 1，不 sleep 重试） ----
NEED_NODES="prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance retry terminal_fail final_evaluate report"
MISSING=""
for NODE in $NEED_NODES; do
  IN_PRIMARY=0; IN_FALLBACK=0
  echo "$PRIMARY_SET"  | tr ',' '\n' | grep -Fxq "$NODE" && IN_PRIMARY=1
  echo "$FALLBACK_SET" | tr ',' '\n' | grep -Fxq "$NODE" && IN_FALLBACK=1
  if [ "$IN_PRIMARY" -eq 0 ] && [ "$IN_FALLBACK" -eq 0 ]; then
    MISSING="$MISSING $NODE"
  fi
done

if [ -n "$MISSING" ]; then
  # R1：完整诊断行后立即 exit 1，禁止 sleep 重试掩盖
  echo "FAIL Step 2: 缺失节点（主路径与 fallback 集合均无）"
  echo "[Step 2 诊断] MISSING_NODES=${MISSING# }"
  echo "[Step 2 诊断] PRIMARY_SET={${PRIMARY_SET}}"
  echo "[Step 2 诊断] FALLBACK_SET={${FALLBACK_SET}}"
  echo "[Step 2 诊断] THREAD_ID=$THREAD_ID  WINDOW=$WINDOW"
  exit 1
fi

echo "OK Step 2: 14 节点全部至少在 PRIMARY 或 FALLBACK 出现"
```

**硬阈值**:
- 主路径 `task_events.count(DISTINCT payload->>'nodeName') >= 14` **或** Fallback `langgraph_checkpoints` 里去重后的 `nodeName` 数 ≥ 14（窗口 60 分钟）
- 14 个节点（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task / run_sub_task / evaluate / advance / retry / terminal_fail / final_evaluate / report）至少在两路其一存在
- 时间窗口 `created_at > NOW() - interval '60 minutes'` 防造假
- **R1 — 缺失时立即 exit 1，打印 PRIMARY_SET + FALLBACK_SET + MISSING + THREAD_ID 完整诊断行；禁止 sleep 重试掩盖**
- **R2 — fallback 行存在但 distinct=0（COALESCE 三路全 NULL）→ 自动 dump 一条 metadata jsonb 全文**
- **R4 — 复用 `count_distinct_nodes_in_checkpoints` / `list_distinct_nodes_in_checkpoints` / `dump_checkpoint_metadata_sample`，禁止内联 SQL**

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

# 暴露 PR_NUM 供 Step 5 重启时序兜底使用
export W8_PR_NUM="$PR_NUM"
```

**硬阈值**:
- `dev_records.pr_url IS NOT NULL` 且 60 分钟内创建
- `gh pr view --json state` 返回 `MERGED`
- PR diff name-only 含 `packages/brain/src/routes/harness.js`
- `origin/main` 当前 HEAD 上 harness.js 含正则 `router\.get\(\s*['"]/health['"]`
- 导出 `W8_PR_NUM` 供 Step 5 `wait_for_brain_with_pr_merge` 使用（R3）

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

**验证命令**（处理 R3：Brain 重启时序兜底，复用 helper-4）：
```bash
# staging 端口 5222；scripts/harness-e2e-up.sh 已起环境且会重启 Brain 拉新 PR
# Step 3 已 export W8_PR_NUM
source sprints/w8-langgraph-acceptance/helpers.sh
STAGING_BRAIN="${STAGING_BRAIN:-http://localhost:5222}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-staging}"

[ -n "${W8_PR_NUM:-}" ] || { echo "FAIL Step 5: 未取到 W8_PR_NUM（Step 3 应已 export）"; exit 1; }

# helper-4 内部：curl /health → 失败时比对 mergedAt vs StartedAt → started<merged 才 sleep 10 重试，最多 3 轮
RESP=$(wait_for_brain_with_pr_merge "$STAGING_BRAIN" "$W8_PR_NUM" "$BRAIN_CONTAINER")

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
- **R3 — curl 失败时必须先比对 `gh pr view --json mergedAt` 与 `docker inspect $BRAIN_CONTAINER --format '{{.State.StartedAt}}'`**：
  - `started_ts < merged_ts` → `sleep 10` 重试，最多 3 轮
  - `started_ts >= merged_ts` 但仍非 200 → 立即 `exit 1` 并打印两时间戳（这是新镜像里就没 handler，重试无意义）
  - 3 轮重试仍 404 → `exit 1` 并打印两时间戳

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`

**完整验证脚本**（**完全复用** `sprints/w8-langgraph-acceptance/helpers.sh`，禁止内联 fallback SQL — R4 / R6 / R5）：
```bash
#!/usr/bin/env bash
# Cascade 防御（R5 / R-CASCADE-FAILURE）：
#   set -e        — 任何命令失败立即退出，cascade 不被静默吞
#   set -u        — 引用未定义变量直接抛错（防 helper 函数变量未传时假装 0）
#   set -o pipefail — 管道里任意段失败都向外传递（如 psql | tr 链路）
set -euo pipefail

# ---------------------------------------------------------------------------
# R6 / R-HELPERS-MISSING 守卫：脚手架文件缺失时 exit 2（≠ exit 1 红证据），
# 让主理人立刻知道"是脚手架坏"而非"产品红"。
# ---------------------------------------------------------------------------
HELPERS_PATH="sprints/w8-langgraph-acceptance/helpers.sh"
if [ ! -f "$HELPERS_PATH" ]; then
  echo "FAIL: $HELPERS_PATH missing — scaffold broken, NOT a red evidence"
  exit 2
fi

INITIATIVE_ID="w8-langgraph-acceptance-20260507"
DB="${DB:-postgresql://localhost/cecelia}"
STAGING_BRAIN="${STAGING_BRAIN:-http://localhost:5222}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-staging}"
WINDOW="60 minutes"

# 强制引入共享 helpers，避免两处粘贴漂移（R4）
# shellcheck source=sprints/w8-langgraph-acceptance/helpers.sh
source "$HELPERS_PATH"

# R6：source 成功后断言哨兵变量被设置（防 helpers.sh 被截断 / 错版本）
if [ "${W8_ACCEPTANCE_HELPERS_LOADED:-0}" != "1" ]; then
  echo "FAIL: helpers.sh sourced 但 W8_ACCEPTANCE_HELPERS_LOADED 未置 1 — scaffold broken"
  exit 2
fi

echo "==> Step 1: initiative_runs.thread_id 已写入"
THREAD_ID=$(psql "$DB" -At -c "
  SELECT thread_id FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
   ORDER BY created_at DESC LIMIT 1
")

# R5 / R-CASCADE-FAILURE：Step 1 任何形态失败 → 立即 exit 1，**禁止**继续走 Step 2 让 fallback 计数恒 0 假绿
if [ -z "$THREAD_ID" ]; then
  echo "FAIL Step 1: initiative_runs.thread_id 为空 — Step 2 fallback 必假，立即 abort cascade"
  echo "[Step 1 诊断] initiative_id=$INITIATIVE_ID  WINDOW=$WINDOW"
  exit 1
fi
echo "$THREAD_ID" | grep -qE "^harness-initiative:${INITIATIVE_ID}:[0-9]+$" \
  || { echo "FAIL Step 1: thread_id=$THREAD_ID 不匹配 ^harness-initiative:${INITIATIVE_ID}:[0-9]+\$"; exit 1; }

echo "==> Step 2: 14 distinct nodeName（task_events 主路径 + langgraph_checkpoints fallback）"
DISTINCT_PRIMARY=$(psql "$DB" -At -c "
  SELECT count(DISTINCT payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
" | tr -d ' ')
PRIMARY_SET=$(psql "$DB" -At -c "
  SELECT string_agg(DISTINCT payload->>'nodeName', ',' ORDER BY payload->>'nodeName')
    FROM task_events
   WHERE event_type='graph_node_update'
     AND payload->>'initiativeId'='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
")

# helper-1/2 复用（R4）— Step 1 已断言 THREAD_ID 非空，cascade 不会到此假装 0（R5）
DISTINCT_FALLBACK=$(count_distinct_nodes_in_checkpoints "$THREAD_ID" "$WINDOW")
FALLBACK_SET=$(list_distinct_nodes_in_checkpoints "$THREAD_ID" "$WINDOW")

echo "    PRIMARY=$DISTINCT_PRIMARY  FALLBACK=$DISTINCT_FALLBACK"
echo "    PRIMARY_SET=$PRIMARY_SET"
echo "    FALLBACK_SET=$FALLBACK_SET"

# R2 兜底
FALLBACK_ROWCOUNT=0
if [ -n "$THREAD_ID" ]; then
  FALLBACK_ROWCOUNT=$(psql "$DB" -At -c "
    SELECT count(*) FROM langgraph_checkpoints WHERE thread_id='${THREAD_ID}'
  " | tr -d ' ')
fi
if [ "$FALLBACK_ROWCOUNT" -gt 0 ] && [ "$DISTINCT_FALLBACK" -eq 0 ]; then
  echo "[E2E R2 兜底] langgraph_checkpoints 有 $FALLBACK_ROWCOUNT 行但 distinct=0；schema 漂移嫌疑，dump："
  dump_checkpoint_metadata_sample "$THREAD_ID"
fi

if [ "$DISTINCT_PRIMARY" -lt 14 ] && [ "$DISTINCT_FALLBACK" -lt 14 ]; then
  echo "FAIL Step 2: 主路径与 fallback 双路均 < 14"
  echo "             PRIMARY=$DISTINCT_PRIMARY (set=$PRIMARY_SET)"
  echo "             FALLBACK=$DISTINCT_FALLBACK (set=$FALLBACK_SET)"
  exit 1
fi

# R1：缺失节点诊断行 + exit 1，禁止 sleep 重试
NEED_NODES="prep planner parsePrd ganLoop inferTaskPlan dbUpsert pick_sub_task run_sub_task evaluate advance retry terminal_fail final_evaluate report"
MISSING=""
for NODE in $NEED_NODES; do
  IN_PRIMARY=0; IN_FALLBACK=0
  echo "$PRIMARY_SET"  | tr ',' '\n' | grep -Fxq "$NODE" && IN_PRIMARY=1
  echo "$FALLBACK_SET" | tr ',' '\n' | grep -Fxq "$NODE" && IN_FALLBACK=1
  if [ "$IN_PRIMARY" -eq 0 ] && [ "$IN_FALLBACK" -eq 0 ]; then
    MISSING="$MISSING $NODE"
  fi
done
if [ -n "$MISSING" ]; then
  echo "FAIL Step 2: 缺失节点（主路径与 fallback 均无）"
  echo "[E2E 诊断] MISSING_NODES=${MISSING# }"
  echo "[E2E 诊断] PRIMARY_SET={${PRIMARY_SET}}"
  echo "[E2E 诊断] FALLBACK_SET={${FALLBACK_SET}}"
  echo "[E2E 诊断] THREAD_ID=$THREAD_ID  WINDOW=$WINDOW"
  exit 1
fi

echo "==> Step 3: PR merged + main 上含 health handler（R7 / R-PR-NOT-LINKED-TO-INITIATIVE 双路兜底）"
# R7：dev_records.task_id 可能未被 executor 串到 parent_initiative_id（独立修复方向已登记）；
#     此处用 task_id IN (...) OR pr_url LIKE '%harness%' 双路；
#     兜底命中后仍走 gh pr diff name-only + git show origin/main 双确认避免拿到无关 PR 假绿
PR_URL=$(psql "$DB" -At -c "
  SELECT pr_url FROM dev_records
   WHERE pr_url IS NOT NULL
     AND created_at > NOW() - interval '${WINDOW}'
     AND ( task_id IN (
             SELECT id FROM tasks WHERE payload->>'parent_initiative_id'='${INITIATIVE_ID}'
           )
        OR pr_url LIKE '%harness%' )
   ORDER BY created_at DESC LIMIT 1
")
[ -n "$PR_URL" ] || { echo "FAIL Step 3: no PR linked to initiative ${INITIATIVE_ID} via task_id or pr_url~harness"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
[ -n "$PR_NUM" ] || { echo "FAIL Step 3: PR_URL 无尾部数字 ($PR_URL)"; exit 1; }

STATE=$(gh pr view "$PR_NUM" --json state -q .state)
[ "$STATE" = "MERGED" ] || { echo "FAIL Step 3: PR #$PR_NUM state=$STATE != MERGED"; exit 1; }

# 双确认 1：PR diff 必触及目标文件（防止 LIKE '%harness%' 误捞无关 PR）
gh pr diff "$PR_NUM" --name-only | grep -qE '^packages/brain/src/routes/harness\.js$' \
  || { echo "FAIL Step 3: PR #$PR_NUM diff 未触及 packages/brain/src/routes/harness.js"; exit 1; }

# 双确认 2：main HEAD 上 harness.js 必含 /health handler（防止 PR 已 merge 但被后续 PR 回滚）
git fetch origin main >/dev/null
git show origin/main:packages/brain/src/routes/harness.js | grep -qE "router\.get\(\s*['\"]/health['\"]" \
  || { echo "FAIL Step 3: origin/main HEAD 上 harness.js 不含 GET /health handler"; exit 1; }

echo "==> Step 4: 先校验 failure_reason != watchdog_overdue + deadline_at - completed_at 差值"
IFS=$'\t' read -r PHASE FAILURE_REASON DEADLINE_AT COMPLETED_AT DIFF_SEC <<< "$(psql "$DB" -At -F$'\t' -c "
  SELECT phase,
         COALESCE(failure_reason, ''),
         deadline_at,
         completed_at,
         EXTRACT(EPOCH FROM (deadline_at - completed_at))::int
    FROM initiative_runs
   WHERE initiative_id='${INITIATIVE_ID}'
     AND created_at > NOW() - interval '${WINDOW}'
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
     AND created_at > NOW() - interval '${WINDOW}'
   ORDER BY created_at DESC LIMIT 1
")"
[ "$PHASE2" = "done" ] && [ "$COMPLETED" = "1" ] && [ "$NOFAIL" = "1" ] \
  || { echo "FAIL Step 4: phase=$PHASE2 completed=$COMPLETED nofail=$NOFAIL"; exit 1; }

echo "==> Step 5: staging health 端点 + body shape（helper-4 内嵌 mergedAt vs StartedAt 兜底）"
# R5：Step 3 已校验 PR_NUM 非空，此处不再重复，但显式断言一遍以阻断 cascade 漂移
[ -n "${PR_NUM:-}" ] || { echo "FAIL Step 5: PR_NUM 为空 — Step 3 cascade 异常"; exit 1; }
RESP=$(wait_for_brain_with_pr_merge "$STAGING_BRAIN" "$PR_NUM" "$BRAIN_CONTAINER")
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

# R6 / R-HELPERS-MISSING：红证据校验脚本同样区分 exit 1（红证据）vs exit 2（脚手架坏）
[ -f sprints/w8-langgraph-acceptance/helpers.sh ] || { echo "FAIL: helpers.sh missing — scaffold broken"; exit 2; }
grep -qF "W8_ACCEPTANCE_HELPERS_LOADED=1" sprints/w8-langgraph-acceptance/helpers.sh \
  || { echo "FAIL: helpers.sh 不含哨兵变量 W8_ACCEPTANCE_HELPERS_LOADED — scaffold corrupted"; exit 2; }

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

---

## Round 4 反馈映射（自检）

| Reviewer 项 | 修复位置 | 关键变化 | Risk Register 对应 |
|---|---|---|---|
| **R5 / R-CASCADE-FAILURE** Step 1 thread_id 未写入导致 Step 2 fallback 假装 0 | E2E 顶部 + §Step 1 + §Step 2（合同 + E2E 双处） | E2E `set -euo pipefail`；§Step 1 `[ -z "$THREAD_ID" ] → exit 1` 立即 abort；§Step 2 在 helper 调用前再断言一次 THREAD_ID 非空 | R-CASCADE-FAILURE (high) |
| **R6 / R-HELPERS-MISSING** helpers.sh 文件丢失或路径漂移 | E2E 首行 + 红证据校验脚本 | E2E 首行 `[ -f $HELPERS_PATH ] \|\| exit 2`；source 后断言 `W8_ACCEPTANCE_HELPERS_LOADED=1`；红证据脚本同样守卫；**exit 2 ≠ exit 1** 区分脚手架坏与产品红 | R-HELPERS-MISSING (medium) |
| **R7 / R-PR-NOT-LINKED-TO-INITIATIVE** dev_records.task_id 未串 parent_initiative_id | §Step 3 + E2E §Step 3 | SELECT 双路兜底 `task_id IN (...) OR pr_url LIKE '%harness%'`；命中后必走 `gh pr diff name-only` + `git show origin/main` 双确认避免误绿；executor 关联修复独立登记 | R-PR-NOT-LINKED-TO-INITIATIVE (medium) |
| **R8** risk_registered ≥ 7（cascade + helpers + schema-drift 必含） | 顶部新增 §Risk Register | 8 项风险登记，覆盖 cascade / helpers / schema-drift / pr-link / brain-restart / watchdog / 重派 / sleep 掩盖；每条都对应合同里至少一处具体代码 | 全部 8 项 |

---

## Round 3 反馈映射（自检）

| Reviewer 项 | 修复位置 | 关键变化 |
|---|---|---|
| **R1** 缺失节点诊断 + exit 1，禁止 sleep 重试掩盖 | Step 2 验证命令 + E2E §Step 2 | `MISSING` 不为空 → 打印 PRIMARY_SET / FALLBACK_SET / MISSING / THREAD_ID 后 `exit 1`；不再含任何 `sleep + retry` 用于"等节点出现" |
| **R2** fallback COALESCE 三路全 NULL 时 dump metadata 全文 | Step 2 + E2E + helper-3 | `FALLBACK_ROWCOUNT > 0 && DISTINCT_FALLBACK == 0` → 调用 `dump_checkpoint_metadata_sample` 打印 jsonb_pretty(metadata) + jsonb_pretty(channel_values) |
| **R3** Step 5 `curl /health` 老镜像兜底 | Step 5 + E2E + helper-4 | 失败时 `gh pr view --json mergedAt` vs `docker inspect StartedAt`；started < merged → sleep 10 重试 ≤3 轮；started ≥ merged 仍 404 → 立即 exit 1（重试无意义）；3 轮仍失败 → exit 1 + 打印两时间戳 |
| **R4** Step 2 fallback SQL 抽 shell 函数复用 | 顶部 §共享 Shell Helpers + Step 2 + E2E | 新增 `count_distinct_nodes_in_checkpoints` / `list_distinct_nodes_in_checkpoints` / `dump_checkpoint_metadata_sample` / `wait_for_brain_with_pr_merge` 4 个 helper；Step 2 与 E2E 双处用 `source sprints/w8-langgraph-acceptance/helpers.sh` 引入，禁止内联 SQL |
