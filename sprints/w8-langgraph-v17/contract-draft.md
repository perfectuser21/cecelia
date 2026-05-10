# Sprint Contract Draft (Round 1)

## Golden Path

[Brain 入库 task_type=harness_initiative pending]
  → [tick loop 5s 拾取 → executor 路由 harness_initiative]
  → [planner 节点产 PRD → proposer GAN 多轮 + reviewer 收敛]
  → [proposer 节点末尾 contract-verify.verifyProposerOutput 验 origin propose_branch 真存在]
  → [fan-out 子任务，每子任务走 H11 harnessSubTaskWorktreePath 协议]
  → [generator 子任务在隔离 worktree 写 docs/learnings/w8-langgraph-v17-e2e.md 并 push 子分支到 origin]
  → [generator 节点末尾 contract-verify 验子分支上目标文件真存在]
  → [evaluator 节点切到子任务 worktree 跑 DoD + 开 PR（OPEN 即合规）]
  → [子任务 callback 回写 tasks 子行 status=completed]
  → [主 initiative graph 收齐子任务后，executor 把主 task 行 status=completed 且 result.pr_url=<合法 GitHub PR URL>]

---

### Step 1: Brain 入库 harness initiative 任务并被 tick loop 拾取

**可观测行为**: 一条新 `tasks` 行 `task_type='harness_initiative'`、`status='pending'` 入库后，5 ~ 30 秒内被 Brain tick loop 拾取并转为 `status='in_progress'`，且分配了 `executor_started_at`。

**验证命令**:
```bash
# 等 30s 看 status 是否离开 pending
sleep 30
psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$INIT_TASK_ID' AND task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' \n'
# 期望：in_progress 或 completed（绝不允许 pending）
```

**硬阈值**: 30 秒内离开 `pending`；`tasks.status ∈ {in_progress, completed}`；`tasks.created_at > NOW() - 5min` 防造假。

---

### Step 2: Proposer 节点末尾 contract-verify 真验 propose_branch 存在于 origin

**可观测行为**: 主 initiative 执行过程中，proposer 节点完成后产生一个 `cp-harness-propose-r{N}-{taskId8}` 形态的 propose_branch，且 `git ls-remote origin` 能查到。如果 push 失败，contract-verify 会 throw `ContractViolation` 触发节点级 retry，而不是放过假绿灯。

**验证命令**:
```bash
# 从 dev_records 或 brain logs 拿 propose_branch（Brain 在执行时记录）
PROPOSE_BR=$(psql "$DB" -t -c "SELECT payload->>'propose_branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type='harness_contract_propose' AND created_at > NOW() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' \n')
[ -n "$PROPOSE_BR" ] || { echo "no propose_branch recorded"; exit 1; }
git ls-remote --exit-code --heads origin "$PROPOSE_BR" || { echo "propose_branch missing on origin"; exit 1; }
```

**硬阈值**: `propose_branch` 字段非空；`git ls-remote --exit-code` 返回 0；时间窗口约束 `created_at > NOW() - 30min` 防止吃旧 round。

---

### Step 3: 子任务 worktree 走 H11 协议（taskId 短也不爆）

**可观测行为**: fan-out 出来的子任务（task_type=`harness_workstream` 或派生类型）在执行时，worktree 路径形如 `worktrees/task-{init8}-{logicalId}`（H11 `harnessSubTaskWorktreePath`），不再触发 `taskId must be ≥8 chars` 报错。Brain alerts 表近 30 分钟无该 ERROR。

**验证命令**:
```bash
# 任何 ≥8 chars 报错都意味着 H11 没生效
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE created_at > NOW() - interval '30 minutes' AND (message ILIKE '%taskId must be%' OR message ILIKE '%≥8 chars%' OR message ILIKE '%>=8 chars%')" | tr -d ' \n')
[ "$COUNT" = "0" ] || { echo "H11 wtKey contract violated: $COUNT alerts"; exit 1; }
```

**硬阈值**: count = 0 严格相等；时间窗口 30 分钟。

---

### Step 4: Generator 子任务推 learnings 文件到子分支并通过 contract-verify

**可观测行为**: generator 子任务推到 origin 的子任务分支上含 `docs/learnings/w8-langgraph-v17-e2e.md`；contract-verify 真去 fetch 该分支并 `git cat-file` 验文件 blob 存在；任何缺失会触发 retry。

**验证命令**:
```bash
SUBTASK_BR=$(psql "$DB" -t -c "SELECT payload->>'branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type IN ('harness_workstream','harness_generate') AND status='completed' AND created_at > NOW() - interval '30 minutes' LIMIT 1" | tr -d ' \n')
[ -n "$SUBTASK_BR" ] || { echo "no completed sub_task branch"; exit 1; }
git fetch origin "$SUBTASK_BR" --depth=1
git cat-file -e "origin/$SUBTASK_BR:docs/learnings/w8-langgraph-v17-e2e.md" || { echo "learnings file missing on sub_task branch"; exit 1; }
# 防造假：文件首行必须是预期 title
FIRST_LINE=$(git show "origin/$SUBTASK_BR:docs/learnings/w8-langgraph-v17-e2e.md" | head -1)
echo "$FIRST_LINE" | grep -q "W8 v17 LangGraph" || { echo "first line wrong: $FIRST_LINE"; exit 1; }
```

**硬阈值**: 子任务分支非空；`git cat-file -e` exit 0；首行包含 `W8 v17 LangGraph`；时间窗口 30 分钟。

---

### Step 5: Evaluator 在子任务 worktree 跑 DoD 并开 GitHub PR

**可观测行为**: evaluator 节点切到 H11 子任务 worktree（H8）拉对应分支跑 DoD，并通过 `gh pr create` 在 GitHub 开 PR；PR 状态 OPEN 即合规，diff 仅含 `sprints/w8-langgraph-v17/` 与 `docs/learnings/w8-langgraph-v17-e2e.md`。

**验证命令**:
```bash
PR_URL=$(psql "$DB" -t -c "SELECT result->>'pr_url' FROM tasks WHERE id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes'" | tr -d ' \n')
echo "$PR_URL" | grep -E '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$' || { echo "pr_url invalid: $PR_URL"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
PR_STATE=$(gh pr view "$PR_NUM" --json state --jq '.state')
[ "$PR_STATE" = "OPEN" ] || [ "$PR_STATE" = "MERGED" ] || { echo "PR state $PR_STATE not OPEN/MERGED"; exit 1; }
# diff 范围必须仅在 sprints/v17 与 docs/learnings/v17，不允许蹭运行时代码
gh pr diff "$PR_NUM" --name-only | grep -vE '^(sprints/w8-langgraph-v17/|docs/learnings/w8-langgraph-v17-e2e\.md)' && { echo "PR touched out-of-scope files"; exit 1; } || true
```

**硬阈值**: `pr_url` 匹配 GitHub URL 严格正则；PR state ∈ {OPEN, MERGED}；diff 范围严格白名单；时间窗口 60 分钟。

---

### Step 6: 主 initiative 行 status=completed 由 Brain 自动写入

**可观测行为**: 主 initiative `tasks` 行最终 `status='completed'`，`result` JSON 含合法 `pr_url`；从入库到 completed 全程无 `manual SQL` / 无 `force kill docker` / 无 `delete from checkpoints` / 无 stuck 90min 超时；30 分钟 wall clock 内闭环。

**验证命令**:
```bash
# 总耗时不得超 30 分钟
WALL_SEC=$(psql "$DB" -t -c "SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) FROM tasks WHERE id='$INIT_TASK_ID' AND status='completed' AND created_at > NOW() - interval '60 minutes'" | tr -d ' \n')
[ -n "$WALL_SEC" ] || { echo "main task not completed"; exit 1; }
awk -v s="$WALL_SEC" 'BEGIN{exit !(s<=1800)}' || { echo "wall clock exceeded 30min: ${WALL_SEC}s"; exit 1; }
# 必须 result.pr_url 非空
PR=$(psql "$DB" -t -c "SELECT result->>'pr_url' FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
[ -n "$PR" ] || { echo "result.pr_url empty"; exit 1; }
# brain_alerts 表无 manual_sql / force_kill / delete_checkpoints 类告警
DIRTY=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%manual SQL%' OR message ILIKE '%force kill%' OR message ILIKE '%delete from checkpoints%' OR message ILIKE '%stuck%')" | tr -d ' \n')
[ "$DIRTY" = "0" ] || { echo "dirty intervention alerts: $DIRTY"; exit 1; }
```

**硬阈值**: `tasks.status='completed'` 严格相等；`updated_at - created_at ≤ 1800s`；`result->>'pr_url'` 非空；`brain_alerts` 干预类告警 count=0；所有查询带 60 分钟时间窗口防造假。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v17"
LEARNINGS="docs/learnings/w8-langgraph-v17-e2e.md"

# === 0. 准备：必须能 ping Brain，gh 已认证 ===
curl -fsS localhost:5221/api/brain/context > /dev/null || { echo "Brain 5221 down"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated"; exit 1; }

# === 1. 注入真实 harness initiative 任务（payload 指向本 sprint）===
INIT_TASK_ID=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_initiative",
    "status": "pending",
    "payload": {
      "sprint_dir": "'"$SPRINT_DIR"'",
      "deliverable": "'"$LEARNINGS"'",
      "skeleton": true,
      "noop_pr": true,
      "title": "W8 v17 walking skeleton e2e"
    }
  }' | jq -r '.id')
[ -n "$INIT_TASK_ID" ] && [ "$INIT_TASK_ID" != "null" ] || { echo "task insert failed"; exit 1; }
export INIT_TASK_ID DB
echo "INIT_TASK_ID=$INIT_TASK_ID"

# === 2. 轮询主 task 终态，最长 30 分钟 ===
DEADLINE=$(($(date +%s) + 1800))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
  case "$STATUS" in
    completed) echo "main task completed"; break ;;
    failed|cancelled) echo "FATAL: task ended in $STATUS"; exit 1 ;;
    *) sleep 20 ;;
  esac
done
[ "$STATUS" = "completed" ] || { echo "TIMEOUT waiting for completed (last status=$STATUS)"; exit 1; }

# === 3. Step 1: 拾取证据（已 completed 即过 in_progress）===
PICKED=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id='$INIT_TASK_ID' AND status='completed' AND created_at > NOW() - interval '60 minutes'" | tr -d ' \n')
[ "$PICKED" = "1" ] || { echo "Step 1 failed: pickup window check"; exit 1; }

# === 4. Step 2: propose_branch 真存在 origin ===
PROPOSE_BR=$(psql "$DB" -t -c "SELECT payload->>'propose_branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type='harness_contract_propose' AND created_at > NOW() - interval '60 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' \n')
[ -n "$PROPOSE_BR" ] || { echo "Step 2 failed: no propose_branch"; exit 1; }
git ls-remote --exit-code --heads origin "$PROPOSE_BR" >/dev/null || { echo "Step 2 failed: propose_branch not on origin"; exit 1; }

# === 5. Step 3: 无 wtKey 报错 ===
WT_BAD=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE created_at > NOW() - interval '60 minutes' AND (message ILIKE '%taskId must be%' OR message ILIKE '%≥8 chars%' OR message ILIKE '%>=8 chars%')" | tr -d ' \n')
[ "$WT_BAD" = "0" ] || { echo "Step 3 failed: H11 wtKey violations=$WT_BAD"; exit 1; }

# === 6. Step 4: 子任务分支上 learnings 文件真存在 ===
SUBTASK_BR=$(psql "$DB" -t -c "SELECT payload->>'branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type IN ('harness_workstream','harness_generate') AND status='completed' AND created_at > NOW() - interval '60 minutes' LIMIT 1" | tr -d ' \n')
[ -n "$SUBTASK_BR" ] || { echo "Step 4 failed: no completed subtask branch"; exit 1; }
git fetch origin "$SUBTASK_BR" --depth=1 >/dev/null
git cat-file -e "origin/$SUBTASK_BR:$LEARNINGS" || { echo "Step 4 failed: learnings missing"; exit 1; }
git show "origin/$SUBTASK_BR:$LEARNINGS" | head -1 | grep -q "W8 v17 LangGraph" || { echo "Step 4 failed: title wrong"; exit 1; }

# === 7. Step 5: PR 在 GitHub 可见且 diff 在白名单内 ===
PR_URL=$(psql "$DB" -t -c "SELECT result->>'pr_url' FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
echo "$PR_URL" | grep -qE '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$' || { echo "Step 5 failed: pr_url=$PR_URL"; exit 1; }
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
PR_STATE=$(gh pr view "$PR_NUM" --json state --jq '.state')
[ "$PR_STATE" = "OPEN" ] || [ "$PR_STATE" = "MERGED" ] || { echo "Step 5 failed: PR state=$PR_STATE"; exit 1; }
OOS=$(gh pr diff "$PR_NUM" --name-only | grep -vE '^(sprints/w8-langgraph-v17/|docs/learnings/w8-langgraph-v17-e2e\.md)' || true)
[ -z "$OOS" ] || { echo "Step 5 failed: PR out-of-scope files: $OOS"; exit 1; }

# === 8. Step 6: 总耗时 ≤ 30min + 无干预告警 ===
WALL_SEC=$(psql "$DB" -t -c "SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
awk -v s="$WALL_SEC" 'BEGIN{exit !(s<=1800)}' || { echo "Step 6 failed: wall clock=${WALL_SEC}s"; exit 1; }
DIRTY=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%manual SQL%' OR message ILIKE '%force kill%' OR message ILIKE '%delete from checkpoints%' OR message ILIKE '%stuck%')" | tr -d ' \n')
[ "$DIRTY" = "0" ] || { echo "Step 6 failed: dirty intervention=$DIRTY"; exit 1; }

echo "✅ W8 v17 Golden Path 验证通过 — wall_clock=${WALL_SEC}s pr=$PR_URL"
```

**通过标准**: 脚本 exit 0；轮询不超过 30 分钟；中途任何 Step 失败立即 exit 1 并打印根因。

---

## Workstreams

workstream_count: 1

### Workstream 1: walking skeleton learnings doc

**范围**: 在 `docs/learnings/w8-langgraph-v17-e2e.md` 写一份 walking skeleton 实证文档，含必填占位字段（run_date / node_durations / gan_proposer_rounds / pr_url / 任务定位 / DoD 列表），由 generator 子任务推到子分支。**不修改任何运行时代码**（packages/brain | packages/engine | packages/workflows 零变更）。

**大小**: S（< 100 行 — 单个 markdown 文件）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/learnings-doc.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/learnings-doc.test.ts` | 文件存在 / 首行标题 / 必填字段全 / sprint 自指 / DoD 列表非空 | WS1 → 5 failures（文件未生成时全红） |
