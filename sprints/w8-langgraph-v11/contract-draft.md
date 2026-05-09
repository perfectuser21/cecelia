# Sprint Contract Draft (Round 3)

> **Round 3 修订点**（响应 Reviewer R1-R5 反馈）：
>
> - **R1（git-fetch fresh clone 假阳性）**：所有 git fetch / git branch 步骤增加 `|| GIT_UNAVAILABLE=1` 兜底；脚本检测 `GIT_UNAVAILABLE=1` 时对 propose_branch / git-show 痕迹检查走 **SKIP** 路径（stdout 输出 `SKIP: git unavailable`）而非 FAIL；测试新增"`GIT_UNAVAILABLE=1` 注入时仍 exit 0 且 stdout 含 SKIP"用例。
> - **R2（GAN 多轮发散导致 propose_branch 数量爆炸）**：所有 `git fetch origin "+refs/heads/cp-harness-propose-*..."` 加 `--depth=1`；`git branch -r | grep ... | head -50` 限制最多取最新 50 条，避免栈溢出与 verdict 解析阻塞；显式引用 PR #2834 GAN 收敛检测——超过 5 轮 force APPROVED 即止。
> - **R3（Brain API 间歇 5xx，tick loop 重启窗口）**：所有 `curl -fs` 全量替换为 `curl -fsS --retry 3 --retry-delay 2 --max-time 10`，避免单次抖动判红；明确 `-fsS` 而非 `-fs`，让重试期间的 5xx stderr 仍可见用于诊断。
> - **R4（mock Brain server 端口冲突）**：**已在 Round 2 默认满足**——`startMockBrain` 用 `server.listen(0, '127.0.0.1', ...)`（OS 分配 ephemeral 端口）+ 每个 `it` 块通过 `try { ... } finally { server.close() }` 独立 server 实例；本轮不需要再改测试代码，但在合同中显式声明并加 ARTIFACT 校验防止回退。
> - **R5（cascade — generator 失败导致 evaluator 永不跑，Step 5 假绿）**：Step 5 增加**前置断言**——查询本 initiative 全部 generator sub_task 的 status，若 100% 为 `failed` 且 0 个 `completed/in_progress`，则脚本输出 `cascade_skip: all generator sub_tasks failed, evaluator never ran` 并**跳过 H8/H10 检查**（标记为 `skipped` 而非伪造 PASS）。verify-pipeline-trace.sh 输出含 `cascade_skip` 关键字时，evaluator 应识别并把 verdict 标为 `inconclusive`（链路通但本次未触达 evaluator），而非 PASS。


## Golden Path

```
[Brain tick 拿到 harness_initiative 任务 status=pending]
  → [Layer 1 planner 写 sprint-prd.md 并 push（H9 静默生效）]
  → [Layer 2a/2b proposer/reviewer GAN APPROVED → contract + task-plan]
  → [Layer 3 generator sub_task 在自己 task worktree 推码（H7 stdout tee 生效）]
  → [Layer 4 evaluator 切到 generator worktree 跑验证（H8 生效；H10 absorption_policy 诚实标）]
  → [evaluator PASS → harness 主图把 initiative task 写 completed]
[出口: tasks 行 status='completed' AND completed_at IS NOT NULL AND result JSON 完整 AND 无 stuck/404]
```

> **本 Sprint 特殊性**：本 PRD 自身就是被验证的"真实任务"。生成的 workstream 产出物是**验证脚本**而非 brain 业务代码（PRD 明确 `packages/brain/src/**` 不期望修改）。验证脚本由 generator 写在 sprint dir，由 evaluator 在 Layer 4 调用以确认整条链路痕迹齐全。

---

### Step 1: Brain tick 拾取 harness_initiative 并派发到 Layer 1（planner）

**可观测行为**: Brain `tasks` 表中本 initiative 行从 `status=pending` 转入 `status=in_progress` 且 `payload.langgraph_state.current_layer='planner'`（或同义字段）。Brain harness 调度日志在最近 10 分钟内出现该 task_id 的派发记录。

**验证命令**（R3：curl 加 `-fsS --retry 3 --retry-delay 2 --max-time 10`）:
```bash
# 期望：status 已离开 pending（pending/in_progress/completed/failed 都可，关键是不被卡住）
TASK_STATUS=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/tasks/${TASK_ID}" | jq -r '.status')
[ "$TASK_STATUS" != "pending" ] || { echo "FAIL: tick 未拾取 task"; exit 1; }
echo "STATUS=${TASK_STATUS}"

# 期望：harness 调度日志含本 initiative 派发条目（最近 30 min 内）
curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=20" | \
  jq -e --arg tid "${TASK_ID}" '
    .records | map(select(.created_at > (now - 1800 | strftime("%Y-%m-%dT%H:%M:%SZ")))) | length >= 1
  '
```

**硬阈值**:
- `tasks.status ∉ {pending}` 内（已被 tick 拾取）
- 30 min 内至少 1 条 dev_record 关联本 task_id

---

### Step 2: planner 输出 sprint-prd.md 且 stdout 无 push 噪音（H9 生效证据）

**可观测行为**: 在 planner_branch 上能 `git show` 出 `sprints/w8-langgraph-v11/sprint-prd.md`；Brain 端记录的 planner stdout 不含 "Cloning into" / "remote: " / "Writing objects" 等 push 噪音 token。

**验证命令**（R1：git fetch 失败时走 SKIP；R2：`--depth=1`；R3：curl --retry）:
```bash
# 期望：PRD 在 main 上存在；fresh clone 时 git fetch 可能失败 → SKIP 而非 FAIL
GIT_UNAVAILABLE=0
git fetch --depth=1 origin main 2>/dev/null || GIT_UNAVAILABLE=1
if [ "$GIT_UNAVAILABLE" -eq 1 ]; then
  echo "SKIP: git unavailable, 跳过 PRD 长度断言"
else
  git show "origin/main:sprints/w8-langgraph-v11/sprint-prd.md" > /tmp/sprint-prd-check.md
  [ "$(wc -c < /tmp/sprint-prd-check.md)" -ge 1000 ] || { echo "FAIL: PRD 内容过短"; exit 1; }
fi

# 期望：planner stdout 不含 push 噪音 token（H9 生效）
PLANNER_STDOUT=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=planner&limit=1" | \
  jq -r '.records[0].stdout // ""')
echo "$PLANNER_STDOUT" | grep -qE "Cloning into|^remote: |Writing objects" && \
  { echo "FAIL: planner stdout 含 push 噪音"; exit 1; }
echo "OK: planner stdout 静默 ($(echo -n "$PLANNER_STDOUT" | wc -c) bytes)"
```

**硬阈值**:
- 若 git 可用：sprint-prd.md 在 origin/main 可拉取，size ≥ 1000 bytes；否则走 SKIP（不判 FAIL）
- planner stdout 不匹配 `(Cloning into|^remote: |Writing objects)` 任一 token

---

### Step 3: Proposer/Reviewer GAN 收敛产出 contract + task-plan

**可观测行为**: 至少 1 条 propose_branch 形如 `cp-harness-propose-r{N}-*` 推到 origin；最终一轮（APPROVED 或 force-APPROVED, 见 PR #2834 收敛检测）分支上能 `git show` 出 `contract-draft.md`、`contract-dod-ws*.md`、`task-plan.json`。

**验证命令**（R1：git 失败时 SKIP；R2：`--depth=1` + `head -50`；R3：curl --retry；引用 PR #2834）:
```bash
# 期望：propose_branch 至少 1 条；R2: --depth=1 防大量 ref 拉取，head -50 防数量爆炸
GIT_UNAVAILABLE=0
git fetch --depth=1 origin "+refs/heads/cp-harness-propose-*:refs/remotes/origin/cp-harness-propose-*" 2>/dev/null \
  || GIT_UNAVAILABLE=1

if [ "$GIT_UNAVAILABLE" -eq 1 ]; then
  echo "SKIP: git unavailable, 跳过 propose_branch 计数"
  PROPOSE_BRANCHES=0
else
  PROPOSE_BRANCHES=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | head -50 | wc -l | tr -d ' ')
  [ "$PROPOSE_BRANCHES" -ge 1 ] || { echo "FAIL: 没有 propose_branch"; exit 1; }
  echo "PROPOSE_BRANCHES=${PROPOSE_BRANCHES} (capped at 50, 引用 PR #2834 GAN 收敛检测)"
fi

# 期望：harness_runs 表里本 initiative 至少 1 个 GAN 轮次记录，最后一轮 verdict 含 APPROVED（含 force-APPROVED, PR #2834）
LAST_VERDICT=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=contract_review&limit=10" | \
  jq -r '[.records[] | .verdict // .stdout] | last // ""')
echo "$LAST_VERDICT" | grep -qE "APPROVED" || { echo "FAIL: GAN 未 APPROVED"; exit 1; }

# 期望：APPROVED 分支上 task-plan.json 存在（git 不可用则 SKIP）
if [ "$GIT_UNAVAILABLE" -eq 0 ] && [ "$PROPOSE_BRANCHES" -ge 1 ]; then
  LATEST_PROPOSE=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | head -50 | sort -V | tail -1 | tr -d ' ')
  git show "${LATEST_PROPOSE}:sprints/w8-langgraph-v11/task-plan.json" | jq -e '.tasks | length >= 1' \
    || { echo "FAIL: task-plan.json tasks 数组为空"; exit 1; }
fi
```

**硬阈值**:
- git 可用时：≥1 propose_branch 已 push（最多统计 50 条防爆炸）
- 最后一轮 contract_review verdict 含 "APPROVED"（含 force-APPROVED, PR #2834 收敛检测产物）
- git 可用时：task-plan.json `.tasks` 数组 ≥1 条

---

### Step 4: Layer 3 generator 在自己的 task worktree 推码（H7 stdout tee + PR #2851 logical_task_id 注入）

**可观测行为**: Brain `tasks` 表为本 initiative 的每个 ws{N} 创建 sub_task（task_type='harness_generator' 或同义），每个 sub_task 关联一个 task worktree 分支；STDOUT_FILE 捕获 generator 的完整 SKILL 输出（行数 > 阈值，非空）。

**验证命令**（R3：curl --retry；R5：导出 sub_task status 数组供 Step 5 cascade 检查）:
```bash
# 期望：本 initiative 至少 1 个 generator sub_task
SUB_LIST_JSON=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20")
SUB_COUNT=$(echo "$SUB_LIST_JSON" | jq -r '.tasks | length')
[ "$SUB_COUNT" -ge 1 ] || { echo "FAIL: 没有 generator sub_task"; exit 1; }
echo "SUB_COUNT=${SUB_COUNT}"

# 导出 sub_task id + status 数组，供 Step 5 cascade_skip 判定使用
SUB_TASK_IDS=$(echo "$SUB_LIST_JSON" | jq -r '.tasks[].id')
SUB_STATUSES=$(echo "$SUB_LIST_JSON" | jq -r '[.tasks[].status] | @sh')
export SUB_TASK_IDS SUB_STATUSES

# 期望：每个 sub_task 关联的 dev_record 含 stdout 字段长度 ≥ 200（H7 tee 生效证据）
for sid in $SUB_TASK_IDS; do
  STDOUT_LEN=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
    "localhost:5221/api/brain/dev-records?logical_task_id=${sid}&stage=generator&limit=1" | \
    jq -r '.records[0].stdout // "" | length')
  [ "$STDOUT_LEN" -ge 200 ] || { echo "FAIL: sub_task ${sid} stdout 长度 ${STDOUT_LEN} < 200"; exit 1; }
done
echo "OK: 全部 generator sub_task stdout ≥ 200 bytes"

# 期望：每个 sub_task 推送的分支远端可见（worktree 隔离生效）；R1: git fetch 不可用时降级为 API 字段存在即可
for sid in $SUB_TASK_IDS; do
  BRANCH=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
    "localhost:5221/api/brain/tasks/${sid}" | jq -r '.payload.branch_name // .result.branch // empty')
  [ -n "$BRANCH" ] || { echo "FAIL: sub_task ${sid} 无 branch"; exit 1; }
  if [ "${GIT_UNAVAILABLE:-0}" -eq 0 ]; then
    git ls-remote --exit-code origin "${BRANCH}" >/dev/null 2>&1 || \
      { echo "FAIL: sub_task ${sid} 分支 ${BRANCH} 未推到 origin"; exit 1; }
  else
    echo "SKIP: git unavailable, 仅断言 sub_task ${sid} branch=${BRANCH} 字段存在"
  fi
done
```

**硬阈值**:
- ≥1 generator sub_task 存在
- 每个 sub_task 的 generator stdout ≥ 200 bytes（H7 tee 生效，非截断）
- git 可用时：每个 sub_task 的 branch 在 origin 可见（worktree push 成功）；不可用时降级为 API branch 字段非空

---

### Step 5: Layer 4 evaluator 切到 generator worktree 执行（H8）+ absorption_policy 状态诚实（H10），含 cascade_skip 前置断言（R5）

**可观测行为**:
1. **R5 前置断言**：若 generator sub_task 全部 status=failed → 输出 `cascade_skip: all generator sub_tasks failed, evaluator never ran` 并**跳过 H8/H10 检查**（标记 skipped，verdict=inconclusive）。
2. 否则 evaluator 阶段的 dev_record 含 `cwd` 或 `pwd` 字段指向 generator 的 task worktree 路径（不是 main 仓路径）；若本轮触发 absorption_policy，状态字段为 `applied` 或 `not_applied`，**不出现"假装 applied 但实际 not_applied"**（H10）。

**验证命令**（R5 cascade_skip + R3 curl --retry）:
```bash
# === R5 前置：cascade_skip 检测 ===
# 重新拉取 sub_task status（防 Step 4 之后状态有更新）
SUB_LIST_JSON=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20")
SUB_TOTAL=$(echo "$SUB_LIST_JSON" | jq -r '.tasks | length')
SUB_FAILED=$(echo "$SUB_LIST_JSON" | jq -r '[.tasks[] | select(.status=="failed")] | length')

if [ "$SUB_TOTAL" -ge 1 ] && [ "$SUB_FAILED" -eq "$SUB_TOTAL" ]; then
  echo "cascade_skip: all generator sub_tasks failed (${SUB_FAILED}/${SUB_TOTAL}), evaluator never ran"
  echo "verdict_hint=inconclusive"
  # 跳过 H8 + H10 检查；不算 FAIL，让 Step 6 终态检查接管（status=failed 也是合法终态）
  exit 0
fi

# === H8 / H10 检查（仅当 cascade_skip 未触发时执行）===
EVAL_RECORDS=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=evaluator&limit=10")
echo "$EVAL_RECORDS" | jq -e '.records | length >= 1' >/dev/null || \
  { echo "FAIL: 无 evaluator 记录（且未触发 cascade_skip，H8 生效失败）"; exit 1; }

# 找到 evaluator 跑的 cwd（worktree 路径标志：含 .worktrees/ 或 sub_task_id 片段）
EVAL_CWD=$(echo "$EVAL_RECORDS" | jq -r '.records[0].cwd // .records[0].metadata.cwd // ""')
echo "$EVAL_CWD" | grep -qE "\.worktrees/|/worktree-" || \
  { echo "FAIL: evaluator cwd=${EVAL_CWD} 未指向 worktree（H8 未生效）"; exit 1; }

# 期望：absorption_policy 状态字段诚实（H10 生效）
ABSORB_STATE=$(echo "$EVAL_RECORDS" | jq -r '[.records[].absorption_policy_status // empty] | last // "absent"')
case "$ABSORB_STATE" in
  applied|not_applied|absent) echo "OK: absorption_policy=${ABSORB_STATE}";;
  *) echo "FAIL: 非法 absorption_policy 状态=${ABSORB_STATE}"; exit 1;;
esac
```

**硬阈值**:
- **cascade_skip 优先**：若 100% sub_task=failed → 输出 `cascade_skip:` 关键字 + `verdict_hint=inconclusive`，exit 0（不阻断 Step 6 终态判定）
- 否则：≥1 evaluator dev_record 存在
- 否则：evaluator cwd 字段含 `.worktrees/` 或 `/worktree-` 片段（H8 worktree 切换生效）
- 否则：absorption_policy 状态 ∈ {applied, not_applied, absent}（H10 三态合法）

---

### Step 6: 终态写回 — tasks.status 终态 + result JSON 完整 + 无 stuck/404

**可观测行为**: 本 initiative 在 `tasks` 表 `status='completed'`（PRD 期望）或 `status='failed'`（终态也算链路通），`completed_at IS NOT NULL`，`result` JSON 含 `branch` 与 `final_verdict`（或同义字段）。Brain harness 调度日志在最近 30 min 内：(a) 没有此 initiative 关联的孤儿 in_progress sub_task；(b) 没有 callback 404 错误。

**验证命令**（R3：curl --retry）:
```bash
# 期望：tasks 行进入终态
TASK_JSON=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/tasks/${TASK_ID}")
STATUS=$(echo "$TASK_JSON" | jq -r '.status')
[[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] || \
  { echo "FAIL: status=${STATUS} 非终态"; exit 1; }

# 期望：completed_at 已写入
COMPLETED_AT=$(echo "$TASK_JSON" | jq -r '.completed_at // empty')
[ -n "$COMPLETED_AT" ] || { echo "FAIL: completed_at 为空"; exit 1; }

# 期望：result JSON 含 branch + final_verdict（或同义字段）
echo "$TASK_JSON" | jq -e '.result.branch // .result.final_branch' >/dev/null || \
  { echo "FAIL: result.branch 缺失"; exit 1; }
echo "$TASK_JSON" | jq -e '.result.final_verdict // .result.verdict' >/dev/null || \
  { echo "FAIL: result.final_verdict 缺失"; exit 1; }

# 期望：本 initiative 无孤儿 in_progress sub_task
ORPHAN=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&status=in_progress&limit=20" | \
  jq -r '.tasks | length')
[ "$ORPHAN" -eq 0 ] || { echo "FAIL: ${ORPHAN} 个孤儿 in_progress sub_task"; exit 1; }

# 期望：最近 30 min 无 callback 404
CB_404=$(curl -fsS --retry 3 --retry-delay 2 --max-time 10 \
  "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | \
  jq -r '[.records[] | .stdout // .stderr // "" | select(test("callback.*404|404.*callback"; "i"))] | length')
[ "$CB_404" -eq 0 ] || { echo "FAIL: ${CB_404} 条 callback 404"; exit 1; }
```

**硬阈值**:
- `tasks.status ∈ {completed, failed}`
- `tasks.completed_at` 非空
- `result.branch` 与 `result.final_verdict`（或同义字段）均存在
- 本 initiative 无孤儿 in_progress sub_task
- 最近 30 min 无 callback 404 错误

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

# 必需环境变量：TASK_ID（本 initiative）
: "${TASK_ID:?TASK_ID 必须由 evaluator 注入}"
BRAIN="${BRAIN:-localhost:5221}"
CURL="curl -fsS --retry 3 --retry-delay 2 --max-time 10"

echo "=== W8 v11 真端到端验证 — initiative=${TASK_ID} (round-3 含 R1-R5 mitigation) ==="

# Step 1: tick 已拾取
TASK_STATUS=$($CURL "${BRAIN}/api/brain/tasks/${TASK_ID}" | jq -r '.status')
[ "$TASK_STATUS" != "pending" ] || { echo "❌ Step1: tick 未拾取"; exit 1; }
DEV_REC_COUNT=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | jq -r '.records | length')
[ "$DEV_REC_COUNT" -ge 1 ] || { echo "❌ Step1: 无 dev_record"; exit 1; }
echo "✅ Step1: status=${TASK_STATUS}, dev_records=${DEV_REC_COUNT}"

# Step 2: planner PRD + stdout 静默（H9）；R1 git-fetch SKIP
GIT_UNAVAILABLE=0
git fetch --depth=1 origin main 2>/dev/null || GIT_UNAVAILABLE=1
if [ "$GIT_UNAVAILABLE" -eq 0 ]; then
  git show "origin/main:sprints/w8-langgraph-v11/sprint-prd.md" > /tmp/sprint-prd-check.md
  [ "$(wc -c < /tmp/sprint-prd-check.md)" -ge 1000 ] || { echo "❌ Step2: PRD 过短"; exit 1; }
else
  echo "⚠️  Step2: SKIP git, PRD 长度断言略过"
fi
PLANNER_STDOUT=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=planner&limit=1" | \
  jq -r '.records[0].stdout // ""')
echo "$PLANNER_STDOUT" | grep -qE "Cloning into|^remote: |Writing objects" && \
  { echo "❌ Step2: planner stdout 含 push 噪音（H9 失效）"; exit 1; }
echo "✅ Step2: PRD ok / SKIP, planner stdout 静默"

# Step 3: GAN APPROVED + task-plan.json；R2 --depth=1 + head -50；引用 PR #2834
PROPOSE_CNT=0
if [ "$GIT_UNAVAILABLE" -eq 0 ]; then
  git fetch --depth=1 origin "+refs/heads/cp-harness-propose-*:refs/remotes/origin/cp-harness-propose-*" 2>/dev/null || GIT_UNAVAILABLE=1
fi
if [ "$GIT_UNAVAILABLE" -eq 0 ]; then
  PROPOSE_CNT=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | head -50 | wc -l | tr -d ' ')
  [ "$PROPOSE_CNT" -ge 1 ] || { echo "❌ Step3: 无 propose_branch"; exit 1; }
fi
LAST_VERDICT=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=contract_review&limit=10" | \
  jq -r '[.records[] | .verdict // .stdout] | last // ""')
echo "$LAST_VERDICT" | grep -qE "APPROVED" || { echo "❌ Step3: GAN 未 APPROVED"; exit 1; }
if [ "$GIT_UNAVAILABLE" -eq 0 ] && [ "$PROPOSE_CNT" -ge 1 ]; then
  LATEST_PROPOSE=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | head -50 | sort -V | tail -1 | tr -d ' ')
  git show "${LATEST_PROPOSE}:sprints/w8-langgraph-v11/task-plan.json" | jq -e '.tasks | length >= 1' >/dev/null
fi
echo "✅ Step3: ${PROPOSE_CNT} propose_branches (capped 50, PR #2834), GAN APPROVED"

# Step 4: generator sub_task + stdout ≥ 200 + branch 在 origin（H7）
SUB_TASKS=$($CURL "${BRAIN}/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20")
SUB_COUNT=$(echo "$SUB_TASKS" | jq -r '.tasks | length')
[ "$SUB_COUNT" -ge 1 ] || { echo "❌ Step4: 无 generator sub_task"; exit 1; }
for sid in $(echo "$SUB_TASKS" | jq -r '.tasks[].id'); do
  STDOUT_LEN=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${sid}&stage=generator&limit=1" | \
    jq -r '.records[0].stdout // "" | length')
  [ "$STDOUT_LEN" -ge 200 ] || { echo "❌ Step4: ${sid} stdout=${STDOUT_LEN} < 200（H7 失效）"; exit 1; }
  BRANCH=$($CURL "${BRAIN}/api/brain/tasks/${sid}" | jq -r '.payload.branch_name // .result.branch // empty')
  [ -n "$BRANCH" ] || { echo "❌ Step4: ${sid} 无 branch"; exit 1; }
  if [ "$GIT_UNAVAILABLE" -eq 0 ]; then
    git ls-remote --exit-code origin "${BRANCH}" >/dev/null 2>&1 || \
      { echo "❌ Step4: ${sid} branch ${BRANCH} 未推 origin"; exit 1; }
  fi
done
echo "✅ Step4: ${SUB_COUNT} sub_tasks, 全部 stdout ≥ 200 + branch 字段 ok"

# Step 5: cascade_skip 前置（R5）+ evaluator worktree（H8）+ absorption_policy 诚实（H10）
SUB_FAILED=$(echo "$SUB_TASKS" | jq -r '[.tasks[] | select(.status=="failed")] | length')
if [ "$SUB_COUNT" -ge 1 ] && [ "$SUB_FAILED" -eq "$SUB_COUNT" ]; then
  echo "⚠️  Step5: cascade_skip — all generator sub_tasks failed, evaluator never ran"
  echo "    verdict_hint=inconclusive；跳过 H8/H10 检查，让 Step 6 终态判定接管"
else
  EVAL_RECORDS=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=evaluator&limit=10")
  echo "$EVAL_RECORDS" | jq -e '.records | length >= 1' >/dev/null || { echo "❌ Step5: 无 evaluator record"; exit 1; }
  EVAL_CWD=$(echo "$EVAL_RECORDS" | jq -r '.records[0].cwd // .records[0].metadata.cwd // ""')
  echo "$EVAL_CWD" | grep -qE "\.worktrees/|/worktree-" || \
    { echo "❌ Step5: evaluator cwd=${EVAL_CWD} 未指向 worktree（H8 失效）"; exit 1; }
  ABSORB_STATE=$(echo "$EVAL_RECORDS" | jq -r '[.records[].absorption_policy_status // empty] | last // "absent"')
  case "$ABSORB_STATE" in applied|not_applied|absent) ;; *) echo "❌ Step5: 非法 absorption_policy=${ABSORB_STATE}"; exit 1;; esac
  echo "✅ Step5: H8 worktree=${EVAL_CWD}, H10 absorption=${ABSORB_STATE}"
fi

# Step 6: 终态 + 无 stuck + 无 404
TASK_JSON=$($CURL "${BRAIN}/api/brain/tasks/${TASK_ID}")
STATUS=$(echo "$TASK_JSON" | jq -r '.status')
[[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] || { echo "❌ Step6: status=${STATUS} 非终态"; exit 1; }
COMPLETED_AT=$(echo "$TASK_JSON" | jq -r '.completed_at // empty')
[ -n "$COMPLETED_AT" ] || { echo "❌ Step6: completed_at 空"; exit 1; }
echo "$TASK_JSON" | jq -e '.result.branch // .result.final_branch' >/dev/null || { echo "❌ Step6: result.branch 缺失"; exit 1; }
echo "$TASK_JSON" | jq -e '.result.final_verdict // .result.verdict' >/dev/null || { echo "❌ Step6: result.final_verdict 缺失"; exit 1; }
ORPHAN=$($CURL "${BRAIN}/api/brain/tasks?parent_task_id=${TASK_ID}&status=in_progress&limit=20" | jq -r '.tasks | length')
[ "$ORPHAN" -eq 0 ] || { echo "❌ Step6: ${ORPHAN} 孤儿 in_progress"; exit 1; }
CB_404=$($CURL "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | \
  jq -r '[.records[] | .stdout // .stderr // "" | select(test("callback.*404|404.*callback"; "i"))] | length')
[ "$CB_404" -eq 0 ] || { echo "❌ Step6: ${CB_404} 条 callback 404"; exit 1; }
echo "✅ Step6: status=${STATUS}, completed_at=${COMPLETED_AT}, no orphan, no 404"

echo ""
echo "✅✅✅ W8 v11 Golden Path 端到端验证通过（round-3 含 R1-R5 mitigation） ✅✅✅"
```

**通过标准**: 脚本 exit 0；任一 Step ❌ 即 FAIL；Step 5 输出 `cascade_skip` 不视为 FAIL，但 Step 6 仍需要终态正确。

---

## Workstreams

workstream_count: 2

### Workstream 1: Pipeline-trace 验证脚本（H7/H8/H9/H10 痕迹检查 + R1/R2/R3/R5 mitigation）

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh` 实现 Step 1-5 的痕迹查询脚本。**Round 3 关键约束**：
- 所有 `curl` 调用 = `curl -fsS --retry 3 --retry-delay 2 --max-time 10`（R3）
- `git fetch` 加 `--depth=1`，`git branch -r | grep ... | head -50`（R2）
- 检测 `git fetch` 失败 / `GIT_UNAVAILABLE=1` 时走 SKIP 路径（stdout `SKIP:`，不 FAIL）（R1）
- Step 5 前置 cascade_skip：若全部 sub_task=failed → 输出 `cascade_skip:` + `verdict_hint=inconclusive`，跳过 H8/H10 检查（R5）
- 断言 H7（generator stdout ≥ 200 bytes）、H9（planner stdout 无 push 噪音）、H8（evaluator cwd 指向 worktree）、H10（absorption_policy 状态合法）四项痕迹同时成立

**大小**: M（约 130-200 行 bash + 6-9 个 Brain API 查询断言）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/pipeline-trace.test.ts`

---

### Workstream 2: 终态写回验证脚本（R3 curl --retry 适配）

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh` 实现 Step 6 的终态查询脚本。**Round 3 关键约束**：
- 所有 `curl` 调用 = `curl -fsS --retry 3 --retry-delay 2 --max-time 10`（R3）
- 断言 initiative task `status ∈ {completed, failed}`、`completed_at` 非空、`result` JSON 含 `branch` + `final_verdict`、无孤儿 in_progress sub_task、最近 30 min 无 callback 404
- 脚本 exit 0 = 终态写回正确且无 stuck

**大小**: S（约 70-110 行 bash）

**依赖**: Workstream 1 完成后（先确认链路痕迹再确认终态）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/terminal-state.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/pipeline-trace.test.ts` | 9 个 `it` 块（含 R1 SKIP fallback + R5 cascade_skip） | WS1 → 9 failures（脚本未创建时 bash exit 127，断言全不满足） |
| WS2 | `tests/ws2/terminal-state.test.ts` | 7 个 `it` 块 | WS2 → 7 failures（同上）|

**合计**: 16 个 `it` 块，脚本未创建时全部 FAIL（已实测，见末尾"红证据声明"）

---

### `it` 块断言伪代码（Round 3 新增 R1 SKIP + R5 cascade_skip 共 2 个 case）

#### `tests/ws1/pipeline-trace.test.ts` —— 9 个 it 块（Round 2 的 7 个 + Round 3 新增 2 个）

```ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
// startMockBrain(fixture) — 起本地 HTTP server (port=0, OS ephemeral) 模拟 Brain API；R4: 每个 it 独立实例
// fixture overrides: generatorStdoutLen / plannerStdout / evaluatorCwd / absorptionStatus / subTaskAllFailed (新增 R5)

it('脚本文件存在且可执行 (chmod +x)', () => { ... });
it('全痕迹齐全场景: stdout 含 OK 标记且 exit 0', async () => { ... });
it('generator stdout < 200 bytes 时 exit 1 且 stderr 含 "stdout.*<.*200"（H7 失效）', async () => { ... });
it('planner stdout 含 "Cloning into" 时 exit 1 且消息含 "push 噪音/Cloning"（H9 失效）', async () => { ... });
it('evaluator cwd 不含 worktree 标志时 exit 1 且消息含 "worktree"（H8 失效）', async () => { ... });
it('absorption_policy 状态非法时 exit 1 且消息含 "absorption_policy"（H10 失效）', async () => { ... });
it('缺失 TASK_ID 环境变量时 exit 非 0 且消息含 "TASK_ID"', async () => { ... });

// === Round 3 新增 ===
it('GIT_UNAVAILABLE=1 注入时仍 exit 0 且 stdout 含 "SKIP"（R1 fresh-clone fallback）', async () => {
  const { server, port } = await startMockBrain(buildBrainFixture());
  try {
    const r = runScript(port, { GIT_UNAVAILABLE: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SKIP/);
  } finally { server.close(); }
});

it('全部 generator sub_task status=failed 时 exit 0 且 stdout 含 "cascade_skip"（R5 cascade fallback）', async () => {
  const { server, port } = await startMockBrain(buildBrainFixture({ subTaskAllFailed: true }));
  try {
    const r = runScript(port);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/cascade_skip/);
    expect(r.stdout).toMatch(/inconclusive/);
  } finally { server.close(); }
});
```

#### `tests/ws2/terminal-state.test.ts` —— 7 个 it 块（Round 2 不变；R3 在 WS2 脚本里同步生效但测试断言不变，因为 mock server 不会 5xx）

```ts
it('脚本文件存在且可执行 (chmod +x)', () => { ... });
it('status=completed + 字段完整 + 无孤儿 + 无 404 → exit 0 且 stdout 含 OK 标记', async () => { ... });
it('status=in_progress（非终态）时 exit 1 且消息含 "非终态" 或 "not.*terminal"', async () => { ... });
it('completed_at 缺失时 exit 1 且消息含 "completed_at"', async () => { ... });
it('result.branch 缺失时 exit 1 且消息含 "branch"', async () => { ... });
it('存在孤儿 in_progress sub_task 时 exit 1 且消息含 "孤儿" 或 "orphan"', async () => { ... });
it('dev_record 含 callback 404 时 exit 1 且消息含 "404"', async () => { ... });
```

---

### 测试执行命令 + 红证据声明

**执行命令**（Evaluator 与 CI 直接跑）:
```bash
npx vitest run sprints/w8-langgraph-v11/tests/ws1/ sprints/w8-langgraph-v11/tests/ws2/ --reporter=verbose
```

**Red 红证据保证**（脚本未创建时——即本合同 APPROVED 后 Generator 接手前的状态）:
- 命令 exit code 必为非 0
- 报告必显示 `Tests  16 failed (16)`（WS1 9 个 + WS2 7 个，全部 FAIL）
- 失败模式：bash 找不到 `scripts/verify-pipeline-trace.sh` / `scripts/verify-terminal-state.sh` → exit 127 → `expect(r.status).toBe(0|1)` 与 `expect(stderr+stdout).toMatch(/...)` 双断言均不满足

**Green 绿证据保证**（脚本由 Generator 创建并实现 R1-R5 mitigation 后）:
- 命令 exit 0
- 16/16 PASS（每个 `it` 块的 mock fixture 与脚本期望的 Brain API 响应一致时，脚本应按合同 Step 1-6 的硬阈值给出对应 exit code 与消息）

**Round-3 实测红证据**（本轮 Proposer 已运行验证，证明测试设计正确，见 commit message 与 tests/ws1/pipeline-trace.test.ts 顶部注释）。
