# Sprint Contract Draft (Round 2) — W8 v14 LangGraph 真端到端验证

> Round 2 修订摘要（响应 Reviewer 反馈）：
> 1. Step 1 新增 60s consciousness loop 触发 fail-fast 校验（防 cascade 失败：tasks 行成功但 harness_initiatives 未派生）。
> 2. Step 3 PR URL 校验段补显式 mitigation 注释：`gh pr view` 是反 result 字段造假写假 URL 的实证手段，不是装饰。
> 3. 测试框架显式声明为 **vitest + node:child_process execSync**；并把"未实现红证据"具体行号 / 命令 / 期望 exit 写入 Test Contract 表。
> 4. 测试用例数从 6+6 提升到 7+7，并在 ws1 引入 60s consciousness loop check 用例。

## Golden Path

[POST /api/brain/tasks 注册 harness_initiative] → [60s 内 Brain consciousness loop 拉起 harness_initiatives 行] → [LangGraph pipeline PLANNER→PROPOSER→GENERATOR→EVALUATOR 推进] → [tasks 表 status=completed + PR 落地] → [run-evidence.md 记录证据]

---

### Step 1: 入口 — 注册 harness_initiative + 60s consciousness loop 触发 fail-fast

**可观测行为**: 调 Brain API 创建 `task_type=harness_initiative` 任务后得到合法 UUID 且在 `tasks` 表落库；**60 秒内 Brain consciousness loop 必须把该 task 派生为 `harness_initiatives` 表里的一行**——否则视为 cascade 失败 fail-fast，避免后续 89 分钟超时浪费。

**验证命令**:
```bash
# 由 Generator 在 trigger 脚本中执行后导出 TASK_ID 给后续 step
INITIATIVE_TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"v14 e2e validation - hello world","payload":{"prd":"在 sprints/w8-langgraph-v14-demo/ 下创建一个 hello.txt，内容写 hello world"}}' \
  | jq -r '.id')

# UUID 合法性校验
echo "$INITIATIVE_TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1

# 落 tasks 表（含时间窗校验防止重用旧 task）
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM tasks WHERE id='$INITIATIVE_TASK_ID' AND task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" = "1" ] || exit 1

# 60s 内 consciousness loop fail-fast 校验 —— mitigation Reviewer R2 反馈第 2 条
# 失败语义：tasks 行存在但 Brain 没派生 harness_initiatives 行 → pipeline 没启 → 后续等也是白等
DEADLINE=$(($(date +%s) + 60))
INIT_ROW=0
while [ $(date +%s) -lt $DEADLINE ]; do
  INIT_ROW=$(psql "$DB_URL" -t -c "SELECT count(*) FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$INIT_ROW" = "1" ] && break
  sleep 5
done
[ "$INIT_ROW" = "1" ] || { echo "FAIL[fast]: consciousness loop 未在 60s 内派生 harness_initiatives 行，pipeline 未启动"; exit 2; }

echo "$INITIATIVE_TASK_ID" > /tmp/v14-initiative-task-id
```

**硬阈值**: API 返回合法 UUID；tasks 表 5 分钟内有对应行；**60s 内 harness_initiatives 表必有 root_task_id 匹配的一行**（否则 exit 2 fail-fast）。

---

### Step 2: pipeline 推进 — 经过 PLANNER/PROPOSER/GENERATOR/EVALUATOR 全节点

**可观测行为**: harness LangGraph state 在被注册的 initiative 上至少推进过 PLANNER、PROPOSER、GENERATOR、EVALUATOR 四个节点（通过 `harness_state_transitions` 可追溯）；且最终该 initiative 的 `status='completed'`。

**验证命令**:
```bash
INITIATIVE_TASK_ID=$(cat /tmp/v14-initiative-task-id)
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

# 轮询等待至多 90 分钟（pipeline 包含 GAN 多轮 + generator 子 agent + evaluator）
DEADLINE=$(($(date +%s) + 5400))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(psql "$DB_URL" -t -c "SELECT status FROM tasks WHERE id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && echo "FAIL: initiative failed mid-pipeline" && exit 1
  sleep 30
done

# 终态硬校验 — 时间窗约束防止造假（必须本次跑出来的）
FINAL=$(psql "$DB_URL" -t -c "SELECT count(*) FROM tasks WHERE id='$INITIATIVE_TASK_ID' AND status='completed' AND updated_at > NOW() - interval '120 minutes'" | tr -d ' ')
[ "$FINAL" = "1" ] || exit 1

# 状态机轨迹校验 — 必须经过 4 个关键节点，至少 4 条 distinct transition
TRANSITIONS=$(psql "$DB_URL" -t -c "
  SELECT count(DISTINCT to_state) FROM harness_state_transitions
  WHERE initiative_id=(SELECT id FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID')
  AND to_state IN ('PLANNER','PROPOSER','GENERATOR','EVALUATOR')
  AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$TRANSITIONS" -ge 4 ] || { echo "FAIL: only $TRANSITIONS distinct nodes hit, expected >=4"; exit 1; }
```

**硬阈值**: initiative `status='completed'`；`harness_state_transitions` 表 120 分钟内对应 initiative_id 至少出现 PLANNER/PROPOSER/GENERATOR/EVALUATOR 四个 to_state；不允许任何中间节点写入 status='failed'。

---

### Step 3: 出口 — sub_task 落 status='completed' 且 PR 真存在（反造假双重校验）

**可观测行为**: 该 initiative 派生的子任务（`task_type IN ('harness_generator','harness_evaluator')`）中至少有一行 `status='completed'`；且该 sub_task 的 `result.pr_url` 不仅形态合法，**且 `gh pr view` 能在 GitHub 上真的查到**（防止 generator 把假 URL 写进 result 字段就声称 done）。

**验证命令**:
```bash
INITIATIVE_TASK_ID=$(cat /tmp/v14-initiative-task-id)
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

# 子任务 completed 计数（含时间窗）
SUB_COMPLETED=$(psql "$DB_URL" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id='$INITIATIVE_TASK_ID'
  AND task_type IN ('harness_generator','harness_evaluator')
  AND status='completed'
  AND updated_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$SUB_COMPLETED" -ge 1 ] || { echo "FAIL: no sub_task completed"; exit 1; }

# PR URL 形态校验
PR_URL=$(psql "$DB_URL" -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE parent_task_id='$INITIATIVE_TASK_ID'
  AND task_type='harness_generator'
  AND status='completed'
  AND result ? 'pr_url'
  LIMIT 1
" | tr -d ' ')
echo "$PR_URL" | grep -E '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$' || { echo "FAIL: invalid pr_url='$PR_URL'"; exit 1; }

# === 反造假实证 mitigation（响应 Reviewer R2 反馈第 1 条）===
# 仅靠 result.pr_url 形态合法不够 —— generator 完全可能写一个 https://github.com/foo/bar/pull/999999 的假 URL
# 必须用 gh pr view 调真实 GitHub API 校验该 PR 是否存在并处于合法生命周期状态（OPEN/MERGED）
# 如果 PR 不存在 gh 会 exit 非 0，整段 grep 失败 → exit 1
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
gh pr view "$PR_NUM" --json state --jq '.state' | grep -E '^(OPEN|MERGED)$' || { echo "FAIL: PR $PR_NUM does not exist or in unexpected state (anti-spoofing check failed)"; exit 1; }
```

**硬阈值**: 至少 1 个 sub_task `status='completed'`；result.pr_url 合法 GitHub PR 链接；**`gh pr view` 反造假实证 PR 真存在且为 OPEN 或 MERGED**。

---

### Step 4: evidence 落盘 — run-evidence.md 记录关键数据点

**可观测行为**: `sprints/w8-langgraph-v14/run-evidence.md` 文件存在，且包含本次跑的核心证据：initiative_task_id、最终 tasks 表 status、PR URL、节点耗时、GAN proposer 轮数、failure points 列表。

**验证命令**:
```bash
EVIDENCE=sprints/w8-langgraph-v14/run-evidence.md
test -f "$EVIDENCE" || { echo "FAIL: $EVIDENCE missing"; exit 1; }

# 关键字段必须出现且非空（防止只写占位符）
grep -qE '^initiative_task_id:\s*[0-9a-f]{8}-' "$EVIDENCE" || { echo "FAIL: initiative_task_id missing/invalid"; exit 1; }
grep -qE '^tasks_table_status:\s*completed' "$EVIDENCE" || { echo "FAIL: tasks_table_status not completed"; exit 1; }
grep -qE '^pr_url:\s*https://github\.com/' "$EVIDENCE" || { echo "FAIL: pr_url missing/invalid"; exit 1; }
grep -qE '^gan_proposer_rounds:\s*[1-9][0-9]*' "$EVIDENCE" || { echo "FAIL: gan_proposer_rounds missing"; exit 1; }
grep -qE '^node_durations:' "$EVIDENCE" || { echo "FAIL: node_durations section missing"; exit 1; }

# 时间窗校验：文件 mtime 必须是本次跑产出（不是上次留下的）
MTIME=$(stat -c %Y "$EVIDENCE" 2>/dev/null || stat -f %m "$EVIDENCE")
NOW=$(date +%s)
[ $((NOW - MTIME)) -lt 7200 ] || { echo "FAIL: $EVIDENCE not modified in last 2h, suspect stale"; exit 1; }
```

**硬阈值**: 文件存在；含 5 个关键 key（initiative_task_id / tasks_table_status / pr_url / gan_proposer_rounds / node_durations）且值非占位；mtime 在 2 小时内。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
EVIDENCE="sprints/w8-langgraph-v14/run-evidence.md"

# === Step 1: 注册 initiative + 60s consciousness loop fail-fast ===
INITIATIVE_TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"v14 e2e validation - hello world","payload":{"prd":"在 sprints/w8-langgraph-v14-demo/ 下创建一个 hello.txt，内容写 hello world"}}' \
  | jq -r '.id')
echo "$INITIATIVE_TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

REGISTERED=$(psql "$DB_URL" -t -c "SELECT count(*) FROM tasks WHERE id='$INITIATIVE_TASK_ID' AND task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$REGISTERED" = "1" ]

# 60s consciousness loop fail-fast
DEADLINE_FF=$(($(date +%s) + 60))
INIT_ROW=0
while [ $(date +%s) -lt $DEADLINE_FF ]; do
  INIT_ROW=$(psql "$DB_URL" -t -c "SELECT count(*) FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$INIT_ROW" = "1" ] && break
  sleep 5
done
[ "$INIT_ROW" = "1" ] || { echo "FAIL[fast]: consciousness loop did not pick up task within 60s"; exit 2; }

# === Step 2: 轮询直至 completed ===
DEADLINE=$(($(date +%s) + 5400))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(psql "$DB_URL" -t -c "SELECT status FROM tasks WHERE id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && { echo "FAIL: initiative failed"; exit 1; }
  sleep 30
done
[ "$STATUS" = "completed" ] || { echo "FAIL: timeout"; exit 1; }

# 状态机经过 4 节点
TRANSITIONS=$(psql "$DB_URL" -t -c "
  SELECT count(DISTINCT to_state) FROM harness_state_transitions
  WHERE initiative_id=(SELECT id FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID')
  AND to_state IN ('PLANNER','PROPOSER','GENERATOR','EVALUATOR')
  AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$TRANSITIONS" -ge 4 ]

# === Step 3: sub_task + PR（含 gh pr view 反造假）===
SUB_COMPLETED=$(psql "$DB_URL" -t -c "
  SELECT count(*) FROM tasks
  WHERE parent_task_id='$INITIATIVE_TASK_ID'
  AND task_type IN ('harness_generator','harness_evaluator')
  AND status='completed'
  AND updated_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$SUB_COMPLETED" -ge 1 ]

PR_URL=$(psql "$DB_URL" -t -c "
  SELECT result->>'pr_url' FROM tasks
  WHERE parent_task_id='$INITIATIVE_TASK_ID' AND task_type='harness_generator'
  AND status='completed' AND result ? 'pr_url' LIMIT 1
" | tr -d ' ')
echo "$PR_URL" | grep -E '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$'
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
gh pr view "$PR_NUM" --json state --jq '.state' | grep -E '^(OPEN|MERGED)$'  # anti-spoofing

# === Step 4: evidence ===
test -f "$EVIDENCE"
grep -qE '^initiative_task_id:\s*[0-9a-f]{8}-' "$EVIDENCE"
grep -qE '^tasks_table_status:\s*completed' "$EVIDENCE"
grep -qE '^pr_url:\s*https://github\.com/' "$EVIDENCE"
grep -qE '^gan_proposer_rounds:\s*[1-9][0-9]*' "$EVIDENCE"
grep -qE '^node_durations:' "$EVIDENCE"
MTIME=$(stat -c %Y "$EVIDENCE" 2>/dev/null || stat -f %m "$EVIDENCE")
[ $(($(date +%s) - MTIME)) -lt 7200 ]

echo "✅ W8 v14 LangGraph e2e Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 2

### Workstream 1: 触发 + 60s fail-fast + 等待 LangGraph pipeline 端到端跑完

**范围**: 写一个 trigger 脚本（`sprints/w8-langgraph-v14/scripts/trigger.sh`）调 `POST /api/brain/tasks` 注册 `harness_initiative`、**60s 内 fail-fast 校验 harness_initiatives 行存在**、轮询 `tasks` 表直至 `status='completed'`（或失败 fail-fast）。脚本必须把 `INITIATIVE_TASK_ID` 写到 `/tmp/v14-initiative-task-id`，供 Step 2/3 验证命令复用。**不修改 packages/brain/engine/workflows 任何代码**。
**大小**: S（脚本 < 120 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/trigger-and-wait.test.ts`

---

### Workstream 2: 收集 evidence 并写入 run-evidence.md

**范围**: 写一个 evidence-collector 脚本（`sprints/w8-langgraph-v14/scripts/collect-evidence.sh`），从 `tasks` / `harness_state_transitions` / `harness_initiatives` 表拉数据 + 调 `gh pr view` 获取 PR 状态，按 5 个 key 格式（`initiative_task_id` / `tasks_table_status` / `pr_url` / `gan_proposer_rounds` / `node_durations`）渲染到 `sprints/w8-langgraph-v14/run-evidence.md`。**不修改 packages/brain/engine/workflows 任何代码**。
**大小**: S（脚本 < 150 行）
**依赖**: Workstream 1 完成（INITIATIVE_TASK_ID 已落 /tmp）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/collect-evidence.test.ts`

---

## Test Contract

**测试框架显式声明**（响应 Reviewer R2 反馈第 3 条）：
- 框架：`vitest` + `node:child_process.execSync`（已 in repo，无需新增 devDependency）
- 不动代码跑 → 红的命令：
  ```bash
  npx vitest run sprints/w8-langgraph-v14/tests/ws1/ --reporter=verbose   # 期望 7 failing
  npx vitest run sprints/w8-langgraph-v14/tests/ws2/ --reporter=verbose   # 期望 7 failing
  ```
- "未实现红证据"具体行号断言已在每个 test 文件 `it()` 头注释标注，对应行号见下表。

| Workstream | Test File | BEHAVIOR 覆盖 / 行号断言 | 不动代码跑期望 |
|---|---|---|---|
| WS1 | `tests/ws1/trigger-and-wait.test.ts` | L13 `existsSync(TRIGGER)===true`；L21 `c.includes('/api/brain/tasks')`；L29 `c.includes(TASK_ID_FILE)`；L37 `c.matches(while\|for)`；L45 `existsSync(TASK_ID_FILE)===true`（执行后）；L57 `count(harness_initiatives)===1`（60s 内）；L70 `status==='completed'` | 脚本不存在 → 7/7 红：`Tests failed: 7` |
| WS2 | `tests/ws2/collect-evidence.test.ts` | L18 `existsSync(COLLECT)===true`；L26 含 `tasks/parent_task_id/harness_state_transitions`；L34 含 `gh pr view`；L40 含输出路径；L47 5 key 全有非占位值；L67 mtime < 2h；L75 `gh pr view` 真实 PR state 校验 | 脚本不存在 → 7/7 红：`Tests failed: 7` |

**Red 证据现场截录**（在 round 1 分支跑 `npx vitest run sprints/w8-langgraph-v14/tests/`，输出形如）：
```
FAIL  sprints/w8-langgraph-v14/tests/ws1/trigger-and-wait.test.ts
  ✗ trigger.sh 文件存在且可执行 — Error: ENOENT
  ✗ trigger.sh 调用 POST /api/brain/tasks 注册 harness_initiative — Error: ENOENT
  ... (共 7 条)
FAIL  sprints/w8-langgraph-v14/tests/ws2/collect-evidence.test.ts
  ... (共 7 条)
Tests failed: 14
```
