# Sprint Contract Draft (Round 3) — W8 v14 LangGraph 真端到端验证

> Round 3 修订摘要（响应 Reviewer R2 → REVISION 反馈）：
> 1. **新增 `## Risks` 表格化矩阵** —— R1/R2/R3/R4/R5 五条风险显式登记，每条标 mitigation 锚点行号，与 Reviewer 格式建议对齐。
> 2. **R4 mitigation 强化（worktree 串扰）**：Step 4 evidence 新增必填字段 `evaluator_worktree_path`，要求渲染 H8 修复后实际 evaluator 切换到的 generator task worktree 路径（不再只是事后引用 PR #2854）。验证侧把"路径必须以 `task-` 开头且与 generator subtask 一致"加进 grep 校验。
> 3. **R5 mitigation 落地（codex 凭据缺失死循环）**：Step 2 新增 GENERATOR 节点停留 > 30min fail-fast 段——通过 `harness_state_transitions` 查最新一条 `to_state='GENERATOR'` 的 created_at，若距今 > 30min 且 initiative 仍未 completed → exit 3 fail-fast。trigger.sh 同步实现该检测。
> 4. ws1 测试 7 → 8（加 30min stall fail-fast 关键字断言）；ws2 测试 7 → 8（加 evaluator_worktree_path key 校验）。

## Risks

| ID | 风险 | 严重性 | Mitigation 锚点 |
|---|---|---|---|
| R1 | cascade 派生失败（tasks 行成功但 harness_initiatives 未派生） | high | Step 1 L37-44 60s fail-fast；trigger.sh 同步实现 |
| R2 | generator 假 PR URL 假阳性（result.pr_url 写假地址） | high | Step 3 L119-124 `gh pr view` 反造假；ws2 test L74-81 实证 |
| R3 | GAN 不收敛死循环 | med | Step 2 L65-69 status='failed' 检测；上游 PR #2834 force APPROVED |
| R4 | evaluator worktree 串扰（共享 initiative worktree → 状态污染） | med | H8（PR #2854）已修；Step 4 L143-150 evidence 必填 `evaluator_worktree_path` 字段（task- 前缀）固化为可观测证据 |
| R5 | codex agent 无 1Password 凭据 → generator spawn 阶段死循环 | med | Step 2 L72-86 `harness_state_transitions` GENERATOR 停留 > 30min 即 exit 3；PRD 假设 codex 容器有 1Password 注入 |

## Golden Path

[POST /api/brain/tasks 注册 harness_initiative] → [60s 内 Brain consciousness loop 拉起 harness_initiatives 行] → [LangGraph pipeline PLANNER→PROPOSER→GENERATOR→EVALUATOR 推进，GENERATOR 不超过 30min 停留] → [tasks 表 status=completed + PR 落地] → [run-evidence.md 含 evaluator_worktree_path 等 6 个 key]

---

### Step 1: 入口 — 注册 harness_initiative + 60s consciousness loop fail-fast

**可观测行为**: 调 Brain API 创建 `task_type=harness_initiative` 任务后得到合法 UUID 且在 `tasks` 表落库；**60 秒内 Brain consciousness loop 必须把该 task 派生为 `harness_initiatives` 表里的一行**——否则视为 cascade 失败 fail-fast，避免后续 89 分钟超时浪费。（对应 Risks R1）

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

# 60s 内 consciousness loop fail-fast 校验 —— mitigation Risks R1
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

### Step 2: pipeline 推进 — 经过 PLANNER/PROPOSER/GENERATOR/EVALUATOR 全节点（含 GENERATOR 停留 30min fail-fast）

**可观测行为**: harness LangGraph state 在被注册的 initiative 上至少推进过 PLANNER、PROPOSER、GENERATOR、EVALUATOR 四个节点（通过 `harness_state_transitions` 可追溯）；且最终该 initiative 的 `status='completed'`。**期间 GENERATOR 节点单次停留时间不得超过 30 分钟**（防 codex 凭据缺失死循环 — Risks R5）。

**验证命令**:
```bash
INITIATIVE_TASK_ID=$(cat /tmp/v14-initiative-task-id)
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
INITIATIVE_ID=$(psql "$DB_URL" -t -c "SELECT id FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID'" | tr -d ' ')

# 轮询等待至多 90 分钟（pipeline 包含 GAN 多轮 + generator 子 agent + evaluator）
DEADLINE=$(($(date +%s) + 5400))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(psql "$DB_URL" -t -c "SELECT status FROM tasks WHERE id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && echo "FAIL: initiative failed mid-pipeline" && exit 1

  # === Risks R5 mitigation: GENERATOR 停留 > 30min fail-fast ===
  # 语义：codex agent 容器无 1Password 凭据时会卡在 spawn-and-interrupt 死循环
  # 通过 harness_state_transitions 查最新一条进入 GENERATOR 的时间，若 > 30min 仍未离开 → exit 3
  GEN_STALL_MIN=$(psql "$DB_URL" -t -c "
    WITH gen_enter AS (
      SELECT created_at FROM harness_state_transitions
      WHERE initiative_id='$INITIATIVE_ID' AND to_state='GENERATOR'
      ORDER BY created_at DESC LIMIT 1
    ), gen_exit AS (
      SELECT created_at FROM harness_state_transitions
      WHERE initiative_id='$INITIATIVE_ID' AND from_state='GENERATOR'
        AND created_at > (SELECT created_at FROM gen_enter)
      ORDER BY created_at DESC LIMIT 1
    )
    SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - (SELECT created_at FROM gen_enter))) / 60, 0)
    WHERE NOT EXISTS (SELECT 1 FROM gen_exit) AND EXISTS (SELECT 1 FROM gen_enter)
  " | tr -d ' \n')
  if [ -n "$GEN_STALL_MIN" ] && awk -v v="$GEN_STALL_MIN" 'BEGIN{exit !(v+0 > 30)}'; then
    echo "FAIL[R5]: GENERATOR 节点停留 ${GEN_STALL_MIN} min > 30min，疑似 codex 凭据死循环"
    exit 3
  fi

  sleep 30
done

# 终态硬校验 — 时间窗约束防止造假（必须本次跑出来的）
FINAL=$(psql "$DB_URL" -t -c "SELECT count(*) FROM tasks WHERE id='$INITIATIVE_TASK_ID' AND status='completed' AND updated_at > NOW() - interval '120 minutes'" | tr -d ' ')
[ "$FINAL" = "1" ] || exit 1

# 状态机轨迹校验 — 必须经过 4 个关键节点，至少 4 条 distinct transition
TRANSITIONS=$(psql "$DB_URL" -t -c "
  SELECT count(DISTINCT to_state) FROM harness_state_transitions
  WHERE initiative_id='$INITIATIVE_ID'
  AND to_state IN ('PLANNER','PROPOSER','GENERATOR','EVALUATOR')
  AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$TRANSITIONS" -ge 4 ] || { echo "FAIL: only $TRANSITIONS distinct nodes hit, expected >=4"; exit 1; }
```

**硬阈值**:
- initiative `status='completed'`；
- `harness_state_transitions` 表 120 分钟内对应 initiative_id 至少出现 PLANNER/PROPOSER/GENERATOR/EVALUATOR 四个 to_state；
- 不允许任何中间节点写入 status='failed'；
- **GENERATOR 节点单次停留时间不得超过 30 分钟（exit 3 fail-fast — Risks R5）**。

---

### Step 3: 出口 — sub_task 落 status='completed' 且 PR 真存在（反造假双重校验）

**可观测行为**: 该 initiative 派生的子任务（`task_type IN ('harness_generator','harness_evaluator')`）中至少有一行 `status='completed'`；且该 sub_task 的 `result.pr_url` 不仅形态合法，**且 `gh pr view` 能在 GitHub 上真的查到**（防止 generator 把假 URL 写进 result 字段就声称 done — Risks R2）。

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

# === 反造假实证 mitigation（Risks R2）===
# 仅靠 result.pr_url 形态合法不够 —— generator 完全可能写一个 https://github.com/foo/bar/pull/999999 的假 URL
# 必须用 gh pr view 调真实 GitHub API 校验该 PR 是否存在并处于合法生命周期状态（OPEN/MERGED）
# 如果 PR 不存在 gh 会 exit 非 0，整段 grep 失败 → exit 1
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
gh pr view "$PR_NUM" --json state --jq '.state' | grep -E '^(OPEN|MERGED)$' || { echo "FAIL: PR $PR_NUM does not exist or in unexpected state (anti-spoofing check failed)"; exit 1; }
```

**硬阈值**: 至少 1 个 sub_task `status='completed'`；result.pr_url 合法 GitHub PR 链接；**`gh pr view` 反造假实证 PR 真存在且为 OPEN 或 MERGED**。

---

### Step 4: evidence 落盘 — run-evidence.md 记录 6 个关键 key（含 evaluator_worktree_path）

**可观测行为**: `sprints/w8-langgraph-v14/run-evidence.md` 文件存在，且包含本次跑的核心证据：initiative_task_id、最终 tasks 表 status、PR URL、节点耗时、GAN proposer 轮数、failure points 列表，**以及 evaluator 实际工作的 task worktree 路径**（H8 修复后 evaluator 切到 generator 的 task worktree，记录该路径作为 Risks R4 mitigation 的可观测证据，路径必须以 `task-` 前缀，对应 worktree 命名规范）。

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

# === Risks R4 mitigation: evaluator_worktree_path 必填 ===
# 失败语义：H8 改完后的真行为 = evaluator 切到 generator 的 task worktree（路径含 'task-' 前缀）
# 路径不出现 / 路径不含 task- 前缀 → 视为可观测证据缺失，无法证明 H8 实际生效
grep -qE '^evaluator_worktree_path:\s*\S*task-\S+' "$EVIDENCE" || { echo "FAIL[R4]: evaluator_worktree_path 缺失或非 task- 前缀（H8 worktree 串扰 mitigation 实证缺失）"; exit 1; }

# 时间窗校验：文件 mtime 必须是本次跑产出（不是上次留下的）
MTIME=$(stat -c %Y "$EVIDENCE" 2>/dev/null || stat -f %m "$EVIDENCE")
NOW=$(date +%s)
[ $((NOW - MTIME)) -lt 7200 ] || { echo "FAIL: $EVIDENCE not modified in last 2h, suspect stale"; exit 1; }
```

**硬阈值**: 文件存在；含 6 个关键 key（initiative_task_id / tasks_table_status / pr_url / gan_proposer_rounds / node_durations / **evaluator_worktree_path**）且值非占位；evaluator_worktree_path 路径必须含 `task-` 前缀；mtime 在 2 小时内。

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

# 60s consciousness loop fail-fast (R1)
DEADLINE_FF=$(($(date +%s) + 60))
INIT_ROW=0
while [ $(date +%s) -lt $DEADLINE_FF ]; do
  INIT_ROW=$(psql "$DB_URL" -t -c "SELECT count(*) FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$INIT_ROW" = "1" ] && break
  sleep 5
done
[ "$INIT_ROW" = "1" ] || { echo "FAIL[fast]: consciousness loop did not pick up task within 60s"; exit 2; }
INITIATIVE_ID=$(psql "$DB_URL" -t -c "SELECT id FROM harness_initiatives WHERE root_task_id='$INITIATIVE_TASK_ID'" | tr -d ' ')

# === Step 2: 轮询直至 completed（含 GENERATOR 30min fail-fast — R5）===
DEADLINE=$(($(date +%s) + 5400))
while [ $(date +%s) -lt $DEADLINE ]; do
  STATUS=$(psql "$DB_URL" -t -c "SELECT status FROM tasks WHERE id='$INITIATIVE_TASK_ID'" | tr -d ' ')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && { echo "FAIL: initiative failed"; exit 1; }

  GEN_STALL_MIN=$(psql "$DB_URL" -t -c "
    WITH gen_enter AS (
      SELECT created_at FROM harness_state_transitions
      WHERE initiative_id='$INITIATIVE_ID' AND to_state='GENERATOR'
      ORDER BY created_at DESC LIMIT 1
    ), gen_exit AS (
      SELECT created_at FROM harness_state_transitions
      WHERE initiative_id='$INITIATIVE_ID' AND from_state='GENERATOR'
        AND created_at > (SELECT created_at FROM gen_enter)
      ORDER BY created_at DESC LIMIT 1
    )
    SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - (SELECT created_at FROM gen_enter))) / 60, 0)
    WHERE NOT EXISTS (SELECT 1 FROM gen_exit) AND EXISTS (SELECT 1 FROM gen_enter)
  " | tr -d ' \n')
  if [ -n "$GEN_STALL_MIN" ] && awk -v v="$GEN_STALL_MIN" 'BEGIN{exit !(v+0 > 30)}'; then
    echo "FAIL[R5]: GENERATOR 节点停留 ${GEN_STALL_MIN} min > 30min"
    exit 3
  fi

  sleep 30
done
[ "$STATUS" = "completed" ] || { echo "FAIL: timeout"; exit 1; }

# 状态机经过 4 节点
TRANSITIONS=$(psql "$DB_URL" -t -c "
  SELECT count(DISTINCT to_state) FROM harness_state_transitions
  WHERE initiative_id='$INITIATIVE_ID'
  AND to_state IN ('PLANNER','PROPOSER','GENERATOR','EVALUATOR')
  AND created_at > NOW() - interval '120 minutes'
" | tr -d ' ')
[ "$TRANSITIONS" -ge 4 ]

# === Step 3: sub_task + PR（含 gh pr view 反造假 — R2）===
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

# === Step 4: evidence（6 key，含 evaluator_worktree_path — R4）===
test -f "$EVIDENCE"
grep -qE '^initiative_task_id:\s*[0-9a-f]{8}-' "$EVIDENCE"
grep -qE '^tasks_table_status:\s*completed' "$EVIDENCE"
grep -qE '^pr_url:\s*https://github\.com/' "$EVIDENCE"
grep -qE '^gan_proposer_rounds:\s*[1-9][0-9]*' "$EVIDENCE"
grep -qE '^node_durations:' "$EVIDENCE"
grep -qE '^evaluator_worktree_path:\s*\S*task-\S+' "$EVIDENCE"  # R4 mitigation
MTIME=$(stat -c %Y "$EVIDENCE" 2>/dev/null || stat -f %m "$EVIDENCE")
[ $(($(date +%s) - MTIME)) -lt 7200 ]

echo "✅ W8 v14 LangGraph e2e Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 2

### Workstream 1: trigger.sh — 注册 + 60s fail-fast + GENERATOR 30min stall 检测 + 等待 pipeline

**范围**: 写一个 trigger 脚本（`sprints/w8-langgraph-v14/scripts/trigger.sh`）调 `POST /api/brain/tasks` 注册 `harness_initiative`、**60s 内 fail-fast 校验 harness_initiatives 行存在（R1）**、轮询 `tasks` 表直至 `status='completed'`、**轮询过程中检测 GENERATOR 节点停留 > 30min 即 exit 3（R5）**。脚本必须把 `INITIATIVE_TASK_ID` 写到 `/tmp/v14-initiative-task-id`，供 Step 2/3 验证命令复用。**不修改 packages/brain/engine/workflows 任何代码**。
**大小**: S（脚本 < 160 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/trigger-and-wait.test.ts`

---

### Workstream 2: collect-evidence.sh — 渲染 6 key（含 evaluator_worktree_path）到 run-evidence.md

**范围**: 写一个 evidence-collector 脚本（`sprints/w8-langgraph-v14/scripts/collect-evidence.sh`），从 `tasks` / `harness_state_transitions` / `harness_initiatives` 表拉数据 + 调 `gh pr view` 校验 PR + **从 evaluator subtask 的 result/payload 字段或 transition metadata 读取 evaluator 实际 worktree 路径（R4 mitigation）**，按 6 个 key（`initiative_task_id` / `tasks_table_status` / `pr_url` / `gan_proposer_rounds` / `node_durations` / **`evaluator_worktree_path`**）渲染到 `sprints/w8-langgraph-v14/run-evidence.md`。**不修改 packages/brain/engine/workflows 任何代码**。
**大小**: S（脚本 < 180 行）
**依赖**: Workstream 1 完成（INITIATIVE_TASK_ID 已落 /tmp）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/collect-evidence.test.ts`

---

## Test Contract

**测试框架显式声明**：
- 框架：`vitest` + `node:child_process.execSync`（已 in repo，无需新增 devDependency）
- 不动代码跑 → 红的命令：
  ```bash
  npx vitest run sprints/w8-langgraph-v14/tests/ws1/ --reporter=verbose   # 期望 8 failing
  npx vitest run sprints/w8-langgraph-v14/tests/ws2/ --reporter=verbose   # 期望 8 failing
  ```
- "未实现红证据"具体行号断言已在每个 test 文件 `it()` 头注释标注，对应行号见下表。

| Workstream | Test File | BEHAVIOR 覆盖 / 行号断言 | 不动代码跑期望 |
|---|---|---|---|
| WS1 | `tests/ws1/trigger-and-wait.test.ts` | L14 `existsSync(TRIGGER)===true`；L22 `c.includes('/api/brain/tasks')`；L30 `c.includes(TASK_ID_FILE)`；L38 polling 关键字；L46 执行后 TASK_ID_FILE 含 UUID；L57 `harness_initiatives` 60s fail-fast 含 + 行已派生；L70 status==='completed'；**L80 GENERATOR 30min stall 关键字 + R5 mitigation 实证（R5）** | 脚本不存在 → 8/8 红：`Tests failed: 8` |
| WS2 | `tests/ws2/collect-evidence.test.ts` | L20 `existsSync(COLLECT)===true`；L28 含 tasks/parent_task_id/harness_state_transitions；L36 `gh pr view`；L42 evidence 路径硬编码；L50 6 key 全有非占位（含 evaluator_worktree_path）；L65 mtime < 2h；L75 gh pr view 反造假；**L86 evidence 中 evaluator_worktree_path 含 task- 前缀（R4）** | 脚本不存在 → 8/8 红：`Tests failed: 8` |

**Red 证据现场截录**（在 round 3 分支跑 `npx vitest run sprints/w8-langgraph-v14/tests/`，输出形如）：
```
FAIL  sprints/w8-langgraph-v14/tests/ws1/trigger-and-wait.test.ts
  ✗ trigger.sh 文件存在且可执行 — Error: ENOENT
  ... (共 8 条)
FAIL  sprints/w8-langgraph-v14/tests/ws2/collect-evidence.test.ts
  ... (共 8 条)
Tests failed: 16
```
