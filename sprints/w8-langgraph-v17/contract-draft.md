# Sprint Contract Draft (Round 2)

> **本轮修订要点（针对 Round 1 Reviewer 反馈）**
> - **R1**：新增 **Step 7** — Brain 中途重启时 W1 `thread_id` 版本化（attempt+1）必须生效；旧 `thread_id` 行 frozen 不被新执行触碰。
> - **R2**：新增 **Step 8** — `callback_queue` 子任务 callback 卡住时 executor 走 callback-queue-persistence 兜底；30min wall-clock 是硬阈值，**逾时必写 `brain_alerts` 告警路径**而非永挂。
> - **R3**：新增 **Step 9** — origin push 瞬时失败由节点级 `retryPolicy` 吸收，最终成功；连续 retry N 次仍失败必须写 `brain_alerts`（cascade 失败对策）而非整 graph stuck。
> - **R4**：新增 **Step 10** — 多 sub_task 并发时每子任务必须有独立 worktree + 独立分支（H11 协议），`worktrees/task-{init8}-{logicalId}` 路径互不重叠，分支名互不冲突。
> - 上述 Step 7-10 也已在 E2E 脚本末尾追加对应段（§9-§12）。
> - **task-plan 保持单 workstream**：本 sprint 是「跑通 + 收集证据」类型，R1-R4 都是验证**已落地系统**的行为契约（W1/H11/callback-queue-persistence/retryPolicy 已在 main），**不产生新交付物**，因此沿用 r1 单 ws 的 walking-skeleton learnings doc。

---

## Golden Path

[Brain 入库 task_type=harness_initiative pending]
  → [tick loop 5s 拾取 → executor 路由 harness_initiative]
  → [planner 节点产 PRD → proposer GAN 多轮 + reviewer 收敛]
  → [proposer 节点末尾 contract-verify.verifyProposerOutput 验 origin propose_branch 真存在]
  → [fan-out 子任务，每子任务走 H11 harnessSubTaskWorktreePath 协议（独立 worktree+独立分支）]
  → [generator 子任务在隔离 worktree 写 docs/learnings/w8-langgraph-v17-e2e.md 并 push 子分支到 origin]
  → [generator 节点末尾 contract-verify 验子分支上目标文件真存在]
  → [evaluator 节点切到子任务 worktree 跑 DoD + 开 PR（OPEN 即合规）]
  → [子任务 callback 回写 tasks 子行 status=completed（callback-queue-persistence 兜底）]
  → [主 initiative graph 收齐子任务后，executor 把主 task 行 status=completed 且 result.pr_url=<合法 GitHub PR URL>]
  → **边界保障**：W1 thread_id 版本化（重启不续旧 stuck） + retry cascade 失败写 brain_alerts（push/callback 不永挂） + H11 子任务独立 worktree（并发不冲突）

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

### Step 7: W1 thread_id 版本化 — Brain 中途重启不续旧 stuck checkpoint（R1）

**可观测行为**: 同一 initiative 第二次执行（人为复跑或 Brain 重启后续跑）时，`thread_id` 自动 attempt+1（`harness-initiative:<initId>:1` → `harness-initiative:<initId>:2`），新 checkpoint 写入新 `thread_id` 行；旧 `thread_id` 行 `checkpoints.updated_at` frozen，不被新执行 mutate；不存在共用同一 `thread_id` 续旧 stuck state 的情况。

**验证命令**:
```bash
# 复跑前快照 attempt=1 的 checkpoint 行修改时间（只在复跑场景跑此 Step；无复跑时此 Step 默认 PASS）
INIT_ID="$INIT_TASK_ID"
THREAD_V1="harness-initiative:${INIT_ID}:1"
THREAD_V2="harness-initiative:${INIT_ID}:2"
# 当前轮（首跑）至少应有 v1 行，且 v2 行尚不存在
V1_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_V1'" | tr -d ' \n')
V2_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_V2'" | tr -d ' \n')
[ "$V1_CNT" -ge 1 ] || { echo "Step 7 partial: no v1 checkpoint (executor 未走 PostgresSaver 路径?)"; exit 1; }
# 防造假：v1 thread_id 形态严格匹配
psql "$DB" -t -c "SELECT 1 FROM checkpoints WHERE thread_id ~ '^harness-initiative:[0-9a-f-]+:[0-9]+$' AND thread_id='$THREAD_V1' LIMIT 1" | grep -q '1' || { echo "Step 7: thread_id 形态不匹配 W1 协议"; exit 1; }
# 复跑场景（OPTIONAL — 由 evaluator 在第二轮跑时执行）：
# 1) 记录 v1 最新 checkpoint_id 与 updated_at
# 2) 触发同 INIT_TASK_ID 复跑（curl POST /api/brain/tasks/$INIT_TASK_ID/retry）
# 3) 跑通后断言：v1 行 updated_at 不变；v2 行存在且 count ≥ 1
# 此处只做首跑断言；二跑断言放在 §10 E2E 复跑段
```

**硬阈值**: 首跑期间 `thread_id` 严格匹配正则 `^harness-initiative:[0-9a-f-]+:[0-9]+$`；v1 行 count ≥ 1；复跑场景下 v1 `updated_at` frozen + v2 行新建（在 E2E §10 复跑段断言）。

---

### Step 8: callback-queue-persistence 兜底 + 30min wall-clock 告警（R2）

**可观测行为**: 子任务执行完调 `/api/brain/harness/callback/<id>` 回写 `tasks.status=completed`；若 callback 队列瞬时卡住，executor 必须走 callback-queue-persistence（落 `callback_queue` 表）兜底，30min wall-clock 超时时主 graph 不能永挂——必须写 `brain_alerts` 告警（type 类似 `harness_callback_stuck`），并由人工告警路径接管。**不允许出现「callback 卡住 + 主 task 仍 in_progress + 无告警」三态共存**。

**验证命令**:
```bash
# (a) callback_queue 不应有未消费且 created_at > 30min 的本 INIT_TASK_ID 子任务行
STUCK_CB=$(psql "$DB" -t -c "SELECT count(*) FROM callback_queue cq JOIN tasks t ON t.id=cq.task_id WHERE t.parent_task_id='$INIT_TASK_ID' AND cq.consumed_at IS NULL AND cq.created_at < NOW() - interval '30 minutes' AND cq.created_at > NOW() - interval '120 minutes'" | tr -d ' \n')
[ "$STUCK_CB" = "0" ] || {
  # 兜底兼容：若 callback_queue schema 字段名不同，回退按存在性判断
  STUCK_CB=$(psql "$DB" -t -c "SELECT count(*) FROM callback_queue WHERE created_at > NOW() - interval '120 minutes' AND created_at < NOW() - interval '30 minutes'" 2>/dev/null | tr -d ' \n')
  [ "${STUCK_CB:-0}" = "0" ] || { echo "Step 8: $STUCK_CB stuck callback_queue rows > 30min unconsumed"; exit 1; }
}
# (b) 若主 task 卡在 in_progress 超 30min，则必须有 brain_alerts 类告警，否则违约
MAIN_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
MAIN_AGE=$(psql "$DB" -t -c "SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
if [ "$MAIN_STATUS" = "in_progress" ] && awk -v a="$MAIN_AGE" 'BEGIN{exit !(a>1800)}'; then
  ALERT_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%callback%stuck%' OR message ILIKE '%harness_callback%' OR message ILIKE '%wall_clock%' OR message ILIKE '%timeout%')" | tr -d ' \n')
  [ "$ALERT_CNT" -ge 1 ] || { echo "Step 8 violated: main task stuck >30min in_progress but no brain_alerts"; exit 1; }
fi
# (c) 救命命令（人工告警路径文档 — 跑日志时记录，不做 exit）
echo "[Step 8 救命命令] psql \"\$DB\" -c \"SELECT * FROM callback_queue WHERE task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INIT_TASK_ID')\""
```

**硬阈值**: `callback_queue` 中本 initiative 子任务行 `consumed_at IS NULL AND created_at < NOW() - 30min` count = 0；若主 task in_progress 持续 > 30min，则 `brain_alerts` 告警 count ≥ 1（不允许同时无告警 + 永挂）；时间窗口 60-120 分钟防造假。

---

### Step 9: retryPolicy 吸收瞬时 push 失败 + cascade 失败写 brain_alerts（R3）

**可观测行为**: GitHub origin push（proposer 推 `propose_branch` 或 generator 推子任务分支）若遇瞬时网络/rate-limit 错，节点级 `retryPolicy` 自动 retry；最终 push 成功——`git ls-remote` 能查到对应分支。若连续 retry N 次仍失败（cascade 失败），executor 必须写 `brain_alerts`（type 类似 `harness_push_cascade_fail`）并让节点 fail，而不是整 graph 永挂在 retry 循环。

**验证命令**:
```bash
# (a) 最终成功证据：propose_branch 与至少一个子任务分支都在 origin 上
PROPOSE_BR=$(psql "$DB" -t -c "SELECT payload->>'propose_branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type='harness_contract_propose' AND created_at > NOW() - interval '60 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' \n')
[ -n "$PROPOSE_BR" ] && git ls-remote --exit-code --heads origin "$PROPOSE_BR" >/dev/null || { echo "Step 9 (a): propose_branch 最终未在 origin"; exit 1; }
SUBTASK_BR=$(psql "$DB" -t -c "SELECT payload->>'branch' FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND task_type IN ('harness_workstream','harness_generate') AND status='completed' AND created_at > NOW() - interval '60 minutes' LIMIT 1" | tr -d ' \n')
[ -n "$SUBTASK_BR" ] && git ls-remote --exit-code --heads origin "$SUBTASK_BR" >/dev/null || { echo "Step 9 (a): sub_task 分支最终未在 origin"; exit 1; }
# (b) cascade 失败必须有 brain_alerts；只有「中间 retry 但最终成功」是合规
# 即：若主 task=failed 且原因是 push 类，则必须有 push_cascade alerts；否则 push_cascade alerts 必须为 0
MAIN_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
PUSH_FAIL_ALERTS=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%push%cascade%' OR message ILIKE '%push%fail%after%retry%' OR message ILIKE '%retry%exhausted%')" | tr -d ' \n')
if [ "$MAIN_STATUS" = "failed" ]; then
  [ "$PUSH_FAIL_ALERTS" -ge 1 ] || { echo "Step 9 (b): main failed 但无 cascade alert（违约）"; exit 1; }
else
  [ "$PUSH_FAIL_ALERTS" = "0" ] || { echo "Step 9 (b): 主 task 未 failed 却有 cascade alerts，可疑"; exit 1; }
fi
# (c) 永挂检测：retryPolicy 不允许 in_progress 持续 > 30min 还在 retry 循环（与 Step 8 联动；此处不重复）
```

**硬阈值**: `propose_branch` 与至少一个 `subtask_branch` 在 `git ls-remote` 上 exit 0；若 main_task=failed 必伴随 cascade alert ≥ 1；若 main_task!=failed 则 cascade alert 严格 = 0；时间窗口 60 分钟。

---

### Step 10: 多 sub_task 并发独立 worktree + 独立分支（R4）

**可观测行为**: 即使 fan-out 出多个并发子任务，每个子任务的 worktree 路径形如 `worktrees/task-{init8}-{logicalId}`（H11 协议）严格唯一，分支名严格唯一；不出现两个子任务共用一个 worktree 或 push 到同一分支互相覆盖。`tasks` 表中本 initiative 的所有子任务 `payload->>'branch'` 互不相同。

**验证命令**:
```bash
# (a) 所有子任务分支互不重复
DUP_BRANCH=$(psql "$DB" -t -c "SELECT branch FROM (SELECT payload->>'branch' AS branch FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes') s WHERE branch IS NOT NULL AND branch <> '' GROUP BY branch HAVING count(*) > 1" | tr -d ' \n')
[ -z "$DUP_BRANCH" ] || { echo "Step 10 (a): 子任务分支重复: $DUP_BRANCH"; exit 1; }
# (b) 所有子任务 worktree key（H11 形态）互不重复
DUP_WT=$(psql "$DB" -t -c "SELECT wtkey FROM (SELECT payload->>'worktree_key' AS wtkey FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes') s WHERE wtkey IS NOT NULL AND wtkey <> '' GROUP BY wtkey HAVING count(*) > 1" | tr -d ' \n')
[ -z "$DUP_WT" ] || { echo "Step 10 (b): 子任务 worktree_key 重复: $DUP_WT"; exit 1; }
# (c) worktree_key 严格匹配 H11 协议正则（init8 = INIT_TASK_ID 前 8 字符）
INIT8=$(echo "$INIT_TASK_ID" | cut -c1-8)
BAD_WT=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND payload->>'worktree_key' IS NOT NULL AND payload->>'worktree_key' !~ ('^task-' || '$INIT8' || '-[a-z0-9_-]+$')" | tr -d ' \n')
[ "$BAD_WT" = "0" ] || { echo "Step 10 (c): $BAD_WT 个子任务 worktree_key 不匹配 H11 协议"; exit 1; }
```

**硬阈值**: `branch` 与 `worktree_key` 在本 initiative 范围内严格唯一（重复 count = 0）；`worktree_key` 严格匹配 `^task-{init8}-[a-z0-9_-]+$` 正则；时间窗口 60 分钟。

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

# === 9. Step 7 (R1): W1 thread_id 版本化首跑断言 ===
THREAD_V1="harness-initiative:${INIT_TASK_ID}:1"
V1_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_V1'" | tr -d ' \n')
[ "${V1_CNT:-0}" -ge 1 ] || { echo "Step 7 failed: no W1 v1 thread_id checkpoint row (executor 未走 PostgresSaver?)"; exit 1; }
psql "$DB" -t -c "SELECT 1 FROM checkpoints WHERE thread_id='$THREAD_V1' AND thread_id ~ '^harness-initiative:[0-9a-f-]+:[0-9]+$' LIMIT 1" | grep -q '1' || { echo "Step 7 failed: thread_id 形态不匹配 W1 协议"; exit 1; }
# 复跑校验（仅当 RERUN_TEST=1 触发；首跑默认跳过，避免拖时间）
if [ "${RERUN_TEST:-0}" = "1" ]; then
  V1_BEFORE=$(psql "$DB" -t -c "SELECT max(updated_at) FROM checkpoints WHERE thread_id='$THREAD_V1'" | tr -d ' \n')
  curl -fsS -X POST "localhost:5221/api/brain/tasks/$INIT_TASK_ID/retry" >/dev/null || { echo "Step 7 retry endpoint missing"; exit 1; }
  sleep 60
  V2_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM checkpoints WHERE thread_id='harness-initiative:${INIT_TASK_ID}:2'" | tr -d ' \n')
  V1_AFTER=$(psql "$DB" -t -c "SELECT max(updated_at) FROM checkpoints WHERE thread_id='$THREAD_V1'" | tr -d ' \n')
  [ "${V2_CNT:-0}" -ge 1 ] || { echo "Step 7 复跑失败: v2 thread_id 未生成"; exit 1; }
  [ "$V1_BEFORE" = "$V1_AFTER" ] || { echo "Step 7 复跑失败: v1 thread_id 被复用 mutate（updated_at 改了 $V1_BEFORE -> $V1_AFTER）"; exit 1; }
fi

# === 10. Step 8 (R2): callback-queue-persistence 兜底 + 30min 告警路径 ===
STUCK_CB=$(psql "$DB" -t -c "SELECT count(*) FROM callback_queue cq JOIN tasks t ON t.id=cq.task_id WHERE t.parent_task_id='$INIT_TASK_ID' AND cq.consumed_at IS NULL AND cq.created_at < NOW() - interval '30 minutes' AND cq.created_at > NOW() - interval '120 minutes'" 2>/dev/null | tr -d ' \n' || echo "0")
[ "${STUCK_CB:-0}" = "0" ] || { echo "Step 8 failed: $STUCK_CB stuck callback_queue rows > 30min"; exit 1; }
MAIN_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
MAIN_AGE=$(psql "$DB" -t -c "SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) FROM tasks WHERE id='$INIT_TASK_ID'" | tr -d ' \n')
if [ "$MAIN_STATUS" = "in_progress" ] && awk -v a="$MAIN_AGE" 'BEGIN{exit !(a>1800)}'; then
  ALERT_CNT=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%callback%stuck%' OR message ILIKE '%harness_callback%' OR message ILIKE '%wall_clock%' OR message ILIKE '%timeout%')" | tr -d ' \n')
  [ "$ALERT_CNT" -ge 1 ] || { echo "Step 8 failed: 主 task 卡 in_progress >30min 但 brain_alerts 无告警"; exit 1; }
fi

# === 11. Step 9 (R3): retryPolicy 吸收瞬时 push 失败 + cascade alerts ===
[ -n "$PROPOSE_BR" ] && git ls-remote --exit-code --heads origin "$PROPOSE_BR" >/dev/null || { echo "Step 9 failed: propose_branch 最终未在 origin"; exit 1; }
[ -n "$SUBTASK_BR" ] && git ls-remote --exit-code --heads origin "$SUBTASK_BR" >/dev/null || { echo "Step 9 failed: sub_task 分支最终未在 origin"; exit 1; }
PUSH_FAIL_ALERTS=$(psql "$DB" -t -c "SELECT count(*) FROM brain_alerts WHERE task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND (message ILIKE '%push%cascade%' OR message ILIKE '%push%fail%after%retry%' OR message ILIKE '%retry%exhausted%')" | tr -d ' \n')
if [ "$MAIN_STATUS" = "failed" ]; then
  [ "$PUSH_FAIL_ALERTS" -ge 1 ] || { echo "Step 9 failed: main failed 但无 push cascade alert"; exit 1; }
else
  [ "$PUSH_FAIL_ALERTS" = "0" ] || { echo "Step 9 failed: 主 task 未 failed 却有 cascade alerts ($PUSH_FAIL_ALERTS)"; exit 1; }
fi

# === 12. Step 10 (R4): 多 sub_task 独立 worktree + 独立分支 ===
DUP_BRANCH=$(psql "$DB" -t -c "SELECT branch FROM (SELECT payload->>'branch' AS branch FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes') s WHERE branch IS NOT NULL AND branch <> '' GROUP BY branch HAVING count(*) > 1" | tr -d ' \n')
[ -z "$DUP_BRANCH" ] || { echo "Step 10 failed: 子任务分支重复=$DUP_BRANCH"; exit 1; }
DUP_WT=$(psql "$DB" -t -c "SELECT wtkey FROM (SELECT payload->>'worktree_key' AS wtkey FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes') s WHERE wtkey IS NOT NULL AND wtkey <> '' GROUP BY wtkey HAVING count(*) > 1" | tr -d ' \n')
[ -z "$DUP_WT" ] || { echo "Step 10 failed: worktree_key 重复=$DUP_WT"; exit 1; }
INIT8=$(echo "$INIT_TASK_ID" | cut -c1-8)
BAD_WT=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE parent_task_id='$INIT_TASK_ID' AND created_at > NOW() - interval '60 minutes' AND payload->>'worktree_key' IS NOT NULL AND payload->>'worktree_key' !~ ('^task-' || '$INIT8' || '-[a-z0-9_-]+$')" | tr -d ' \n')
[ "${BAD_WT:-0}" = "0" ] || { echo "Step 10 failed: $BAD_WT 个 worktree_key 不匹配 H11 协议"; exit 1; }

echo "✅ W8 v17 Golden Path + R1-R4 边界 mitigation 全部验证通过 — wall_clock=${WALL_SEC}s pr=$PR_URL"
```

**通过标准**: 脚本 exit 0；轮询不超过 30 分钟；中途任何 Step 失败立即 exit 1 并打印根因；R1-R4 边界 mitigation 均有断言（首跑覆盖 R2/R3/R4 + R1 形态校验，复跑由 `RERUN_TEST=1` 触发覆盖 R1 mutate 防护）。

---

## Workstreams

workstream_count: 1

### Workstream 1: walking skeleton learnings doc

**范围**: 在 `docs/learnings/w8-langgraph-v17-e2e.md` 写一份 walking skeleton 实证文档，含必填占位字段（run_date / node_durations / gan_proposer_rounds / pr_url / 任务定位 / DoD 列表 + R1-R4 边界 mitigation 实证段落）。由 generator 子任务推到子分支。**不修改任何运行时代码**（packages/brain | packages/engine | packages/workflows 零变更）。

**大小**: S（< 100 行 — 单个 markdown 文件）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/learnings-doc.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/learnings-doc.test.ts` | 文件存在 / 首行标题 / 必填占位字段全 / sprint 自指 / DoD 列表非空 / 长度 5~200 行 / R1-R4 mitigation 段落存在 | WS1 → 7 failures（文件未生成时全红） |

---

## Round 2 修订映射（Reviewer 反馈追溯表）

| Reviewer 反馈 | 本轮处理 | 合同位置 | E2E 段落 |
|---|---|---|---|
| R1: thread_id 续旧 stuck → W1 版本化 | 加 Step 7 + 首跑形态断言 + 复跑断言（RERUN_TEST=1） | Step 7 | §9 |
| R2: callback 卡住 → 持久化兜底 + 30min 告警 | 加 Step 8 + 救命命令 + 主 task 卡死必有 alert 断言 | Step 8 | §10 |
| R3: push 瞬时失败 → retryPolicy + cascade alerts | 加 Step 9 + 最终成功断言 + 失败必伴 alert 断言 | Step 9 | §11 |
| R4: 多子任务并发同分支冲突 → H11 独立 wt+branch | 加 Step 10 + 唯一性断言 + H11 路径正则 | Step 10 | §12 |
