# Sprint Contract Draft (Round 2) — W32 Walking Skeleton P1 终验 round 4

> **Round 2 修订摘要**（按 Round 1 Reviewer 反馈逐条对应）：
> - **R1 issue 1 — Oracle 完整性 (8→9)**：Step 4 + contract-dod-ws1 BEHAVIOR 5 新增 `keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]` 严等校验，跟 dispatch/recent 的 `keys == ["count","events"]` 严等同构。
> - **R1 issue 2 — risk_registered (3 分)**：本文件末新增 `## Risk Registry` 段，登记 5 类已知风险（Brain 不可达 / 内层 Initiative 120min 未收敛 / 内层 verdict=FAIL 误判 P1 / 并发 Initiative 污染 B3 / B5 HOL skipped→dispatched 未出现）+ 每项 mitigation/降级路径。
> - **R1 issue 3 — behavior_count_position (5 分)**：contract-dod-ws1 BEHAVIOR 5 升级为含 keys 严等的完整 schema oracle（不再只 has(K) 漏校验新字段），4 类 BEHAVIOR 场景（schema 字段值 / keys 完整性 / 禁用字段反向 / error path）每类 ≥ 2 条覆盖。
>

> **PR-G 验收承诺**：本合同字段名严格字面照搬 PRD `## Response Schema` 段：
> - `GET /api/brain/tasks/{id}` 成功响应 keys 字面必填 = `id`/`task_type`/`status`/`thread_id`/`parent_task_id`/`result`/`last_heartbeat_at`（字面，**禁用** `state`/`task_state`/`phase`/`stage`）
> - `status` 字面值集合 = `{pending, in_progress, completed, failed, skipped}`（**禁用** `done`/`complete`/`success`/`running`/`active`）
> - `GET /api/brain/dispatch/recent` 顶层 keys 字面 = `["count", "events"]`（**禁用** 多 key 少 key 或重命名 `event_list`/`items`/`data`/`payload`）
> - `event_type` 字面值集合 = `{dispatched, skipped, completed, failed, reaped}`（**禁用** `dispatch`/`send`/`out`/`error`）
> - dispatch/recent query 字面名 = `initiative_id` + `limit`（**禁用** `iid`/`task`/`task_id`/`root_id`/`max`/`count`/`n`）
> - `GET /api/brain/fleet/slots` 字段字面 = `total_slots`/`in_use`/`in_progress_task_count`（**禁用** `used`/`busy`/`active`/`running_count`/`task_count`）
> - `POST /api/brain/tasks` 错误体 keys 字面 = `["error"]`（**禁用** `message`/`msg`/`reason`/`detail`）
>
> Proposer 自查 checklist（v7.5/v7.6 死规则）：
> 1. PRD 4 endpoints 字面字段名 → contract 全部用 jq -e 字面 codify ✓
> 2. PRD `status` 5 字面枚举 → contract `jq -e '[<all-values>] | inside([...])'` 反向检查也覆盖 ✓
> 3. PRD `event_type` 5 字面枚举 → contract `jq -e '.events | map(.event_type) | all(. == "dispatched" or ...)'` ✓
> 4. PRD 禁用字段清单 → contract 仅在反向 `has("X") | not` 出现 ✓
> 5. `dispatch/recent` schema 完整性 → contract `jq -e 'keys == ["count","events"]'` ✓
> 6. `fleet/slots` 不变量 `in_use === in_progress_task_count` → contract jq -e codify ✓
> 7. 7 oracle (a-g) 每条对应 ≥ 1 条合同 Step + ≥ 1 条 [BEHAVIOR]，合计 contract-dod-ws1.md ≥ 4 条 [BEHAVIOR]（v7.6 阈值）✓

---

## Golden Path

[运维者通过 `POST /api/brain/tasks` 创建 `task_type=harness_initiative` 最简 PRD 任务]
→ [Brain dispatcher 拾起 → planner 阶段产出 sprint-prd.md → reportNode 回写 status=completed → 调度 harness_propose 子任务]
→ [proposer → reviewer (GAN APPROVED) → generator (TDD 双 commit) 5 阶段在**同一 LangGraph thread_id** 下顺序贯通]
→ [evaluator 阶段：`lookupHarnessThread` 命中已存在 thread → evaluate_contract 在同一 graph state 内跑 → verdict 回写 root Initiative result]
→ [出口：root Initiative `status=completed` + `result.verdict ∈ {PASS,FAIL}` + 5 阶段子任务 thread_id 全等 + dispatch_events ≥ 5 + 无 zombie + slot 一致 + HOL 不死锁 + heartbeat 不误杀，全部 7 oracle (a-g) PASS]
→ [产物：`sprints/w32-walking-skeleton-p1-v4/verify-p1.sh` 验证脚本 + `sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md` 终验报告（含 verdict + 7 oracle 实测值）]

---

### Step 1: 入口 — `POST /api/brain/tasks` 创建 harness_initiative

**可观测行为**: HTTP 201，body 字面 schema = `{id:<uuid>, task_type:"harness_initiative", status:"pending"}`，顶层 keys 不含 `state`/`phase`/`stage` 等禁用名。

**验证命令**:
```bash
# 前置：Brain 已运行（不在本 Step 内启停，依赖运维环境）
curl -fs localhost:5221/api/brain/context > /dev/null || { echo "FAIL: Brain 不可达"; exit 1; }

# 创建最简 harness_initiative（PRD 含简单 echo 类内容，不依赖外部资源）
TS=$(date +%s)
RESP=$(curl -fs -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 inner test ${TS}: echo hello world playground\",\"priority\":5}")

# 1. 必填字段字面
INIT_ID=$(echo "$RESP" | jq -re '.id') || { echo "FAIL: 响应缺 id"; exit 1; }
echo "$RESP" | jq -e '.task_type == "harness_initiative"' || { echo "FAIL: task_type 字面不等"; exit 1; }
echo "$RESP" | jq -e '.status == "pending"' || { echo "FAIL: 初始 status 字面应为 pending"; exit 1; }

# 2. 字段值类型
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 非字符串"; exit 1; }

# 3. 禁用顶层 key 反向不存在
for k in state task_state phase stage; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "FAIL: 禁用字段 $k 出现"; exit 1; }
done

echo "INITIATIVE_ID=$INIT_ID"
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 201；`id` 是非空 string；`task_type === "harness_initiative"` 字面；`status === "pending"` 字面；禁用键 `state`/`task_state`/`phase`/`stage` 反向不存在。

---

### Step 2: 入口反向 — 错误 body 返 HTTP 400 + `{error}` schema

**可观测行为**: 缺 `task_type` 的 POST 返 HTTP 400，body 顶层 keys 字面 = `["error"]`，`error` 字段类型为 string，禁用 `message`/`msg`/`reason`/`detail` 不存在。

**验证命令**:
```bash
CODE=$(curl -s -o /tmp/w32-err.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" -d '{"prd":"missing task_type"}')
[ "$CODE" = "400" ] || { echo "FAIL: 缺 task_type 应返 400，实际 $CODE"; exit 1; }

jq -e '.error | type == "string"' /tmp/w32-err.json || { echo "FAIL: error 字段缺失或非 string"; exit 1; }
for k in message msg reason detail; do
  jq -e "has(\"$k\") | not" /tmp/w32-err.json > /dev/null || { echo "FAIL: 错误体含禁用字段 $k"; exit 1; }
done

echo "✅ Step 2 通过"
```

**硬阈值**: HTTP 400；`.error` 为非空 string；`message`/`msg`/`reason`/`detail` 全部不存在。

---

### Step 3: 系统处理 — 5 阶段在同一 thread_id 下贯通完成（B9/B10 oracle b）

**可观测行为**: 等待 root Initiative 达到终态后，`SELECT thread_id FROM tasks WHERE id=$INIT_ID OR parent_task_id=$INIT_ID OR root_task_id=$INIT_ID` 返回的所有非空 thread_id 完全相同（distinct count = 1），且涵盖 planner/proposer/reviewer/generator/evaluator 5 类 task_type。

**验证命令**:
```bash
# 假设 INITIATIVE_ID 由 Step 1 注入；轮询最长 120 min（5 阶段 × 默认 max ~24 min）
INITIATIVE_ID="${INITIATIVE_ID:?Step 1 必须先注入 INITIATIVE_ID}"
DEADLINE=$(( $(date +%s) + 7200 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(curl -fs "localhost:5221/api/brain/tasks/${INITIATIVE_ID}" | jq -re '.status')
  case "$STATUS" in
    completed|failed|skipped) break ;;
    pending|in_progress) sleep 30 ;;
    *) echo "FAIL: 未知 status 字面 $STATUS（不在 5 枚举内）"; exit 1 ;;
  esac
done

# B9/B10 oracle b：5 阶段子任务 thread_id 全等
THREAD_DISTINCT=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "
  SELECT count(DISTINCT thread_id)
  FROM tasks
  WHERE (id = '${INITIATIVE_ID}'
         OR parent_task_id = '${INITIATIVE_ID}'
         OR root_task_id  = '${INITIATIVE_ID}')
    AND thread_id IS NOT NULL")
[ "$THREAD_DISTINCT" = "1" ] || { echo "FAIL: thread_id 不连续，distinct=$THREAD_DISTINCT (期望 1)"; exit 1; }

# 5 阶段 task_type 全覆盖
STAGES_COVERED=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "
  SELECT count(DISTINCT task_type)
  FROM tasks
  WHERE (id = '${INITIATIVE_ID}'
         OR parent_task_id = '${INITIATIVE_ID}'
         OR root_task_id  = '${INITIATIVE_ID}')
    AND task_type IN ('harness_initiative','harness_propose','harness_review','harness_generate','harness_evaluate')")
[ "$STAGES_COVERED" = "5" ] || { echo "FAIL: 5 阶段未全覆盖，distinct task_type=$STAGES_COVERED"; exit 1; }

echo "✅ Step 3 通过 (thread distinct=1, stages=5)"
```

**硬阈值**: `SELECT count(DISTINCT thread_id) ... AND thread_id IS NOT NULL` === 1；`SELECT count(DISTINCT task_type)` === 5；status 必须收敛到 `completed`/`failed`/`skipped` 之一（不可永停在 `pending`/`in_progress`）。

---

### Step 4: 出口 — Initiative 终态 + verdict 写回（oracle a）

**可观测行为**: GET `/api/brain/tasks/{INITIATIVE_ID}` 返 HTTP 200，`status === "completed"`（字面，不接受 `done`/`complete`/`success`/`failed`/`skipped` 等其他枚举），`result.verdict ∈ {"PASS","FAIL"}` 字面之一（必须有 verdict 字段，不可为 null），且顶层 keys 含 `id`/`task_type`/`status`/`thread_id`/`parent_task_id`/`result`/`last_heartbeat_at` 全部字面。

**验证命令**:
```bash
RESP=$(curl -fs "localhost:5221/api/brain/tasks/${INITIATIVE_ID}")

# oracle a 核心：status 字面 == completed
echo "$RESP" | jq -e '.status == "completed"' || { echo "FAIL: status 字面应 completed，实际 $(echo $RESP | jq -r .status)"; exit 1; }

# verdict 字面属于 {PASS, FAIL}
echo "$RESP" | jq -e '.result.verdict == "PASS" or .result.verdict == "FAIL"' \
  || { echo "FAIL: result.verdict 不在 {PASS, FAIL} 字面集合"; exit 1; }

# R2 修订：schema 严等完整性 — 顶层 keys 排序后必须**完全等于** PRD 字面 7 字段集合
# 跟 dispatch/recent 的 `keys == ["count","events"]` 严等同构，捕获 generator 加新字段或 alias 漂移
echo "$RESP" | jq -e 'keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]' \
  || { echo "FAIL: tasks/{id} 顶层 keys 严等校验失败，实际 $(echo $RESP | jq -c 'keys | sort')"; exit 1; }

# response schema 必填字段字面均存在（含 null 允许） — 兼容性双校验
for k in id task_type status thread_id parent_task_id result last_heartbeat_at; do
  echo "$RESP" | jq -e "has(\"$k\")" > /dev/null || { echo "FAIL: 缺必填字段 $k"; exit 1; }
done

# 禁用 status 枚举不许出现
echo "$RESP" | jq -e '.status as $s | ["pending","in_progress","completed","failed","skipped"] | index($s) != null' \
  || { echo "FAIL: status 非 5 字面枚举之一"; exit 1; }

# 禁用响应字段名反向不存在
for k in state task_state phase stage; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "FAIL: 禁用字段 $k 出现"; exit 1; }
done

echo "✅ Step 4 通过 (status=completed, verdict=$(echo $RESP | jq -r .result.verdict))"
```

**硬阈值**: `.status == "completed"` 字面；`.result.verdict` ∈ `{"PASS","FAIL"}` 字面之一；**`keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]` 严等**（R2 新增 — Reviewer R1 要求）；7 个必填字段 has 全 true；4 个禁用字段 has 全 false。

---

### Step 5: 出口 — dispatch_events 完整可审计（oracle c，B6）

**可观测行为**: GET `/api/brain/dispatch/recent?initiative_id=${INITIATIVE_ID}&limit=50` 返 HTTP 200，顶层 keys 字面 == `["count","events"]`，`events` 是数组（不为 null），`count >= 5`，且 events 数组中至少 5 条 `event_type == "dispatched"`（每阶段至少 1 条 dispatch event）。

**验证命令**:
```bash
RESP=$(curl -fs "localhost:5221/api/brain/dispatch/recent?initiative_id=${INITIATIVE_ID}&limit=50")

# schema 完整性 — 顶层 keys 必须**完全等于** ["count", "events"]
echo "$RESP" | jq -e 'keys == ["count","events"]' \
  || { echo "FAIL: 顶层 keys 不等于 [count, events]，实际 $(echo $RESP | jq -c keys)"; exit 1; }

# events 必须是数组
echo "$RESP" | jq -e '.events | type == "array"' || { echo "FAIL: events 非数组"; exit 1; }

# count >= 5
COUNT=$(echo "$RESP" | jq -r '.count')
[ "$COUNT" -ge 5 ] || { echo "FAIL: count=$COUNT < 5"; exit 1; }

# event_type 枚举字面合规（5 字面集合内）
echo "$RESP" | jq -e '.events | all(.event_type as $t | ["dispatched","skipped","completed","failed","reaped"] | index($t) != null)' \
  || { echo "FAIL: 存在 event_type 不在 5 字面枚举内"; exit 1; }

# 禁用 event_type 反向
echo "$RESP" | jq -e '.events | all(.event_type != "dispatch" and .event_type != "send" and .event_type != "out" and .event_type != "error")' \
  || { echo "FAIL: 禁用 event_type 出现"; exit 1; }

# 至少 5 条 dispatched
DISPATCHED_COUNT=$(echo "$RESP" | jq -r '[.events[] | select(.event_type == "dispatched")] | length')
[ "$DISPATCHED_COUNT" -ge 5 ] || { echo "FAIL: dispatched 事件 $DISPATCHED_COUNT < 5"; exit 1; }

echo "✅ Step 5 通过 (count=$COUNT, dispatched>=5)"
```

**硬阈值**: `keys == ["count","events"]` 严等；`events` 是数组；`count >= 5`；`events.*.event_type` 全部 ∈ 5 字面枚举；`dispatched` 计数 >= 5。

---

### Step 6: 出口 — 无 zombie（oracle d，B2/B8）

**可观测行为**: 终态后，本 Initiative 及所有子任务中**不存在**仍处于 `status='in_progress'` 且 `last_heartbeat_at` 早于 `NOW() - interval '60 minutes'` 的记录（B8 60min 阈值，B2 reaper 不放过 zombie）。同时也不存在被 reaper 标记 zombie 后又被外部回报 completed 的 flip-flop 记录（B7 反向）。

**验证命令**:
```bash
# B2/B8 oracle：无超过 60min heartbeat 仍 in_progress 的 zombie
ZOMBIE_COUNT=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "
  SELECT count(*)
  FROM tasks
  WHERE (id = '${INITIATIVE_ID}'
         OR parent_task_id = '${INITIATIVE_ID}'
         OR root_task_id  = '${INITIATIVE_ID}')
    AND status = 'in_progress'
    AND last_heartbeat_at < NOW() - interval '60 minutes'")
[ "$ZOMBIE_COUNT" = "0" ] || { echo "FAIL: 发现 $ZOMBIE_COUNT 条 zombie 任务"; exit 1; }

# B7 反向：检查 dispatch_events 中无 reaped 又紧随 completed 的 flip-flop（生命周期中 reaped 后立刻 completed）
FLIPFLOP_COUNT=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "
  WITH ranked AS (
    SELECT de.task_id, de.event_type, de.created_at,
           LEAD(de.event_type) OVER (PARTITION BY de.task_id ORDER BY de.created_at) AS next_type
    FROM dispatch_events de
    JOIN tasks t ON t.id = de.task_id
    WHERE t.id = '${INITIATIVE_ID}'
       OR t.parent_task_id = '${INITIATIVE_ID}'
       OR t.root_task_id  = '${INITIATIVE_ID}'
  )
  SELECT count(*) FROM ranked WHERE event_type = 'reaped' AND next_type = 'completed'")
[ "$FLIPFLOP_COUNT" = "0" ] || { echo "FAIL: B7 反向：发现 $FLIPFLOP_COUNT 条 reaped→completed flip-flop"; exit 1; }

echo "✅ Step 6 通过 (zombie=0, flipflop=0)"
```

**硬阈值**: `SELECT count(*)` zombie 条件 === 0；`reaped → completed` flip-flop 计数 === 0。

---

### Step 7: 出口 — slot 一致 + HOL 不死锁（oracle e + f，B3 + B5）

**可观测行为**: GET `/api/brain/fleet/slots` 返字段字面 `total_slots`/`in_use`/`in_progress_task_count`，不变量 `in_use === in_progress_task_count`（B3）；且本 Initiative 整个生命周期内 `dispatch_events` 至少出现 1 次 `event_type='skipped'` 后紧跟另一任务 `event_type='dispatched'` 的序列（B5 HOL fix 生效证据，证明队首被跳过后队列没死锁，后续任务被派出）。

**验证命令**:
```bash
# B3 slot 一致性
RESP=$(curl -fs localhost:5221/api/brain/fleet/slots)
for k in total_slots in_use in_progress_task_count; do
  echo "$RESP" | jq -e "has(\"$k\")" > /dev/null || { echo "FAIL: fleet/slots 缺字段 $k"; exit 1; }
done
for k in used busy active running_count task_count; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "FAIL: 禁用字段 $k 出现"; exit 1; }
done
echo "$RESP" | jq -e '.in_use == .in_progress_task_count' \
  || { echo "FAIL: B3 不变量 in_use !== in_progress_task_count，分别为 $(echo $RESP | jq .in_use) / $(echo $RESP | jq .in_progress_task_count)"; exit 1; }

# B5 HOL 不死锁证据：dispatch_events 中存在 skipped 之后某任务被 dispatched 的序列
HOL_OK=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "
  WITH window AS (
    SELECT created_at FROM tasks WHERE id = '${INITIATIVE_ID}'
  ),
  evs AS (
    SELECT de.event_type, de.created_at
    FROM dispatch_events de, window w
    WHERE de.created_at >= w.created_at - interval '5 minutes'
      AND de.created_at <= w.created_at + interval '120 minutes'
    ORDER BY de.created_at
  ),
  with_lead AS (
    SELECT event_type, LEAD(event_type) OVER (ORDER BY created_at) AS next_evt FROM evs
  )
  SELECT EXISTS(SELECT 1 FROM with_lead WHERE event_type = 'skipped' AND next_evt = 'dispatched')")
[ "$HOL_OK" = "t" ] || { echo "FAIL: B5 未观察到 skipped→dispatched 序列（HOL fix 未生效或本 Initiative 期间无队列竞争）"; exit 1; }

echo "✅ Step 7 通过 (in_use==in_progress_task_count, HOL skipped→dispatched 观察到)"
```

**硬阈值**: `fleet/slots` 3 字段 has 全 true；5 个禁用字段 has 全 false；`in_use === in_progress_task_count`；`dispatch_events` 序列存在 `skipped → dispatched` 紧邻对。

---

### Step 8: 产物 — 终验报告写回 + 7 oracle 实测值（出口产物）

**可观测行为**: `sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md` 文件存在，含 `## Verdict: PASS|FAIL` 段、`## Oracle a-g 实测` 表格、`## Anomaly` 段（PASS 时此段为空）。如 verdict=FAIL，必须列出哪条 oracle 实测值偏离及定位的代码位置（不修复）。

**验证命令**:
```bash
REPORT=sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md
[ -f "$REPORT" ] || { echo "FAIL: 终验报告缺失"; exit 1; }

# 必含 Verdict 段（字面 PASS 或 FAIL）
grep -qE '^## Verdict: (PASS|FAIL)$' "$REPORT" || { echo "FAIL: 缺 ## Verdict: PASS|FAIL 段"; exit 1; }

# 必含 Oracle 段
grep -q '^## Oracle a-g 实测' "$REPORT" || { echo "FAIL: 缺 Oracle a-g 实测 段"; exit 1; }

# 必含 Anomaly 段
grep -q '^## Anomaly' "$REPORT" || { echo "FAIL: 缺 Anomaly 段"; exit 1; }

# 7 个 oracle 字面标识 a/b/c/d/e/f/g 全部出现
for oracle in a b c d e f g; do
  grep -qE "^\| ${oracle} \|" "$REPORT" || { echo "FAIL: Oracle 表格缺 ${oracle} 行"; exit 1; }
done

echo "✅ Step 8 通过"
```

**硬阈值**: 文件存在；`## Verdict: PASS` 或 `## Verdict: FAIL` 字面行存在；`## Oracle a-g 实测` 字面段存在；`## Anomaly` 字面段存在；7 个 oracle 字母 a-g 在表格中各占一行。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

# 前置：Brain 必须可达
curl -fs localhost:5221/api/brain/context > /dev/null || { echo "FAIL: Brain 不可达，无法执行 W32 终验"; exit 1; }

# 调用 generator 产出的 verify-p1.sh，它内部完成 Step 1-8
bash sprints/w32-walking-skeleton-p1-v4/verify-p1.sh

# 检查终验报告 verdict
REPORT=sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md
VERDICT=$(grep -E '^## Verdict: (PASS|FAIL)$' "$REPORT" | sed -E 's/## Verdict: //')
[ "$VERDICT" = "PASS" ] || { echo "❌ W32 终验 FAIL（详见 $REPORT）"; exit 1; }

echo "✅ W32 P1 终验 round 4 通过：5 阶段 thread 贯通 + 7 oracle 全 PASS"
```

**通过标准**: 脚本 exit 0；`p1-final-acceptance.md` 含 `## Verdict: PASS` 字面行。

---

## Workstreams

workstream_count: 1

### Workstream 1: 终验脚本 + 终验报告生成器

**范围**: 在 `sprints/w32-walking-skeleton-p1-v4/` 内产出两个文件：
1. `verify-p1.sh`：bash 脚本，依次执行：(a) POST `/api/brain/tasks` 创建内层 harness_initiative；(b) 错误 body 反向打 400 验证；(c) 轮询根任务 status 直到收敛（max 120 min）；(d) 调用 5 类 API（`tasks/{id}`/`dispatch/recent`/`fleet/slots`）+ 2 类直查 SQL（thread_id 连续性 / zombie 反向）采集 7 oracle (a-g) 实测值；(e) 渲染 `p1-final-acceptance.md`。
2. `p1-final-acceptance.md`（由 `verify-p1.sh` 生成）：含 `## Verdict: PASS|FAIL` / `## Oracle a-g 实测` 表格（7 行 a-g）/ `## Anomaly` 段。

**不在范围**：不改 `packages/brain/**` 任何代码；不改既有 endpoint 实现；不引入新数据库 schema。

**大小**: M（bash 脚本约 200-300 行 + 报告模板）
**依赖**: 无（直接基于 Brain 既有 API，B1-B10 已 merge 进 main）

**BEHAVIOR 覆盖**: `contract-dod-ws1.md` BEHAVIOR 段内嵌 manual:bash 命令（evaluator v1.1 直接跑，不经 vitest）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/verify-p1.test.ts` | verify-p1.sh 文件存在且可执行, harness_initiative 的 curl 段, 字面 query 名 initiative_id, in_use==in_progress_task_count 不变量断言, count(DISTINCT thread_id) 检查 thread 连续性, 60min zombie 反向检查, p1-final-acceptance.md 含 3 个必需段, 任何文件, 字面响应字段名, jq -e 正向断言里使用禁用字段名, 严等 7 字段集合字面, HOL primary check 失败时含 secondary 并发触发逻辑, 报告文件存在, 含字面 Verdict PASS 行, 含 Oracle a-g 实测 段, 含 Anomaly 段, 字母 a-g 各占表格一行, 禁用同义 oracle 命名 | 实现前 `verify-p1.sh` 不存在 → 静态结构断言抛错红；实现前 `p1-final-acceptance.md` 未产出 → existsSync 红；实现后字面字段名漂移或禁用字段出现 → toContain 红 |

---

## Risk Registry (R2 新增 — 补 Reviewer R1 risk_registered=3 分)

> 本 sprint 是验证型 sprint，不改 Brain 代码，但终验过程中可能遇到 5 类已知风险。每条登记 (a) 触发条件 (b) 检测信号 (c) 降级 / mitigation 路径 (d) 责任归属。

### R1: Brain API localhost:5221 不可达

- **触发**: evaluator 运行环境内 Brain 未启动 / 端口冲突 / Docker network 断
- **检测**: `curl -fs localhost:5221/api/brain/context` 返非 0
- **降级**: `verify-p1.sh` 在 Step 1 前置检查中 exit 1，evaluator 判 INFRA-FAIL（不计入 P1 verdict）；外层 harness 重试或登记 B11+ infra hole
- **责任**: 主理人 / Cecelia ops（不是本 sprint generator/evaluator 范畴）

### R2: 内层 harness_initiative 在 120min deadline 内未收敛

- **触发**: 内层 5 阶段总耗时 > 120min（generator agent 偶发慢 / 网络抖动 / Codex 排队）
- **检测**: Step 3 轮询循环 `while $(date +%s) -lt $DEADLINE` 退出后 `.status` 仍 `pending`/`in_progress`
- **降级**: `verify-p1.sh` 写 `## Verdict: FAIL` + `## Anomaly` 段记录 "inner Initiative timeout at stage X"，evaluator 据此判 P1 round 4 FAIL，登记 B11 timeout hole；不阻塞外层退出
- **责任**: 本 sprint generator 必须在 verify-p1.sh 实现该兜底逻辑（在 BEHAVIOR 6 已覆盖：脚本退出后 p1-final-acceptance.md 必须含 PASS 或 FAIL 字面）

### R3: 内层 verdict=FAIL 被误判为 P1 失败

- **触发**: 内层 Initiative 业务逻辑产生 verdict=FAIL（不影响管道贯通）
- **检测**: Step 4 `.result.verdict == "FAIL"` 但 5 阶段 thread / dispatch / slot / zombie / HOL 全部 oracle 通过
- **降级**: PRD `边界情况 e2` 明确：业务 verdict=FAIL 不影响 P1 终验本身。`verify-p1.sh` 渲染报告时区分 "Initiative 业务 verdict" 与 "P1 终验 verdict"；P1 verdict 仅看 a-g 7 oracle 是否全 PASS，不看内层业务 verdict
- **责任**: 本 sprint generator 必须在 verify-p1.sh 实现该分离（Step 4 验 `verdict ∈ {PASS,FAIL}` 仅校验**有 verdict 字段**，不据此决定 P1 verdict）

### R4: 并发 Initiative 污染 B3 slot 一致性

- **触发**: 终验期间其他 harness Initiative 同时在跑，`fleet/slots.in_use` 包含外部 Initiative 的 slot 占用
- **检测**: Step 7 `.in_use == .in_progress_task_count` 仍恒等（因为 in_progress_task_count 也包含外部），但若 generator 错把 in_use 跟"本 Initiative 子任务 in_progress 数"对比就会假阴
- **降级**: PRD `边界情况 e3` 明确：B3 oracle 是**全局**不变量 `in_use === in_progress_task_count`，不是"本 Initiative 子任务级"。Step 7 验证命令字面是 `.in_use == .in_progress_task_count`，不引入按 initiative_id 过滤的子查询；这本身就规避了并发污染
- **责任**: 本 sprint generator 严格按 Step 7 字面写脚本，禁止"按 initiative_id 子查询过滤再对比"

### R5: B5 HOL skipped→dispatched 序列未出现（无队列竞争）

- **触发**: 终验执行期间 dispatcher 队列从未发生过 "队首 skip → 后续 dispatch" 事件序列（系统负载低 / 没有并发任务竞争 slot）
- **检测**: Step 7 SQL `EXISTS(SELECT 1 FROM with_lead WHERE event_type='skipped' AND next_evt='dispatched')` 返 `f`
- **降级**: PRD 第 7 节 oracle f 明确："如果队列从头到尾没有跳过事件，跑一个并发场景补充验证"。`verify-p1.sh` 检测到 HOL_OK=f 时，必须**额外**触发一个 PUSH 任务（如 priority=0 + 高 slot 占用任务）人为制造队首跳过场景，再重测 HOL 序列；仍未出现才判 B5 oracle FAIL
- **责任**: 本 sprint generator 必须在 verify-p1.sh 实现该补充验证（Step 7 写"primary EXISTS check → 失败则触发并发场景 → secondary EXISTS check"两段逻辑）

---

### R2 修订 vs R1 对照表

| R1 Reviewer 关注点 | R1 得分 | R2 修复 | 修复位置 |
|---|---|---|---|
| verification_oracle_completeness | 8/10 | Step 4 + DoD BEHAVIOR 5 加 `keys \| sort` 严等 | contract-draft.md Step 4 / contract-dod-ws1.md BEHAVIOR 5 |
| risk_registered | 3/10 | 新增 Risk Registry 段，登记 R1-R5 五类风险 + mitigation | contract-draft.md 末段（本段）|
| behavior_count_position | 5/10 | BEHAVIOR 5 升级含 keys 严等，4 类场景覆盖位置正交化（schema 值 / keys 完整 / 禁用反向 / error path 各 ≥ 2 条）| contract-dod-ws1.md BEHAVIOR 段 |
| dod_machineability | 9/10 | 维持（已合格）| — |
| scope_match_prd | 8/10 | 维持（PRD 字段名全部字面引用）| — |
| test_is_red | 7/10 | vitest 加 keys 严等字面断言（脚本未实现 keys 严等行→红）| tests/ws1/verify-p1.test.ts |
| internal_consistency | 7/10 | Test Contract 表升级到 8 条 BEHAVIOR；Step 4 硬阈值与 BEHAVIOR 5 字面对齐 | contract-draft.md Test Contract 段 |
