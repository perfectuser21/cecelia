# Sprint Contract Draft (Round 1)

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

**验证命令**:
```bash
# 期望：status 已离开 pending（pending/in_progress/completed/failed 都可，关键是不被卡住）
TASK_STATUS=$(curl -fs "localhost:5221/api/brain/tasks/${TASK_ID}" | jq -r '.status')
[ "$TASK_STATUS" != "pending" ] || { echo "FAIL: tick 未拾取 task"; exit 1; }
echo "STATUS=${TASK_STATUS}"

# 期望：harness 调度日志含本 initiative 派发条目（最近 30 min 内）
curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=20" | \
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

**验证命令**:
```bash
# 期望：PRD 在 main 上存在（Planner 已 push 到 main 由 brain 接合，或在专属 planner_branch）
git fetch origin main 2>/dev/null
git show "origin/main:sprints/w8-langgraph-v11/sprint-prd.md" > /tmp/sprint-prd-check.md
# 期望：PRD 长度 ≥ 1000 字节（防止空文件假绿）
[ "$(wc -c < /tmp/sprint-prd-check.md)" -ge 1000 ] || { echo "FAIL: PRD 内容过短"; exit 1; }

# 期望：planner stdout 不含 push 噪音 token（H9 生效）
PLANNER_STDOUT=$(curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=planner&limit=1" | \
  jq -r '.records[0].stdout // ""')
echo "$PLANNER_STDOUT" | grep -qE "Cloning into|^remote: |Writing objects" && \
  { echo "FAIL: planner stdout 含 push 噪音"; exit 1; }
echo "OK: planner stdout 静默 ($(echo -n "$PLANNER_STDOUT" | wc -c) bytes)"
```

**硬阈值**:
- sprint-prd.md 在 origin/main 可拉取，size ≥ 1000 bytes
- planner stdout 不匹配 `(Cloning into|^remote: |Writing objects)` 任一 token

---

### Step 3: Proposer/Reviewer GAN 收敛产出 contract + task-plan

**可观测行为**: 至少 1 条 propose_branch 形如 `cp-harness-propose-r{N}-*` 推到 origin；最终一轮（APPROVED）分支上能 `git show` 出 `contract-draft.md`、`contract-dod-ws*.md`、`task-plan.json`。

**验证命令**:
```bash
git fetch origin "+refs/heads/cp-harness-propose-*:refs/remotes/origin/cp-harness-propose-*" 2>/dev/null
PROPOSE_BRANCHES=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | wc -l | tr -d ' ')
[ "$PROPOSE_BRANCHES" -ge 1 ] || { echo "FAIL: 没有 propose_branch"; exit 1; }
echo "PROPOSE_BRANCHES=${PROPOSE_BRANCHES}"

# 期望：harness_runs 表里本 initiative 至少 1 个 GAN 轮次记录，最后一轮 verdict=APPROVED 或 force-APPROVED
LAST_VERDICT=$(curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=contract_review&limit=10" | \
  jq -r '[.records[] | .verdict // .stdout] | last // ""')
echo "$LAST_VERDICT" | grep -qE "APPROVED" || { echo "FAIL: GAN 未 APPROVED"; exit 1; }

# 期望：APPROVED 分支上 task-plan.json 存在
LATEST_PROPOSE=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | sort -V | tail -1 | tr -d ' ')
git show "${LATEST_PROPOSE}:sprints/w8-langgraph-v11/task-plan.json" | jq -e '.tasks | length >= 1'
```

**硬阈值**:
- ≥1 propose_branch 已 push
- 最后一轮 contract_review verdict 含 "APPROVED"
- task-plan.json `.tasks` 数组 ≥1 条

---

### Step 4: Layer 3 generator 在自己的 task worktree 推码（H7 stdout tee + PR #2851 logical_task_id 注入）

**可观测行为**: Brain `tasks` 表为本 initiative 的每个 ws{N} 创建 sub_task（task_type='harness_generator' 或同义），每个 sub_task 关联一个 task worktree 分支；STDOUT_FILE 捕获 generator 的完整 SKILL 输出（行数 > 阈值，非空）。

**验证命令**:
```bash
# 期望：本 initiative 至少 1 个 generator sub_task
SUB_COUNT=$(curl -fs "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20" | \
  jq -r '.tasks | length')
[ "$SUB_COUNT" -ge 1 ] || { echo "FAIL: 没有 generator sub_task"; exit 1; }
echo "SUB_COUNT=${SUB_COUNT}"

# 期望：每个 sub_task 关联的 dev_record 含 stdout 字段长度 ≥ 200（H7 tee 生效证据）
SUB_TASK_IDS=$(curl -fs "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20" | \
  jq -r '.tasks[].id')
for sid in $SUB_TASK_IDS; do
  STDOUT_LEN=$(curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${sid}&stage=generator&limit=1" | \
    jq -r '.records[0].stdout // "" | length')
  [ "$STDOUT_LEN" -ge 200 ] || { echo "FAIL: sub_task ${sid} stdout 长度 ${STDOUT_LEN} < 200"; exit 1; }
done
echo "OK: 全部 generator sub_task stdout ≥ 200 bytes"

# 期望：每个 sub_task 推送的分支远端可见（worktree 隔离生效）
for sid in $SUB_TASK_IDS; do
  BRANCH=$(curl -fs "localhost:5221/api/brain/tasks/${sid}" | jq -r '.payload.branch_name // .result.branch // empty')
  [ -n "$BRANCH" ] || { echo "FAIL: sub_task ${sid} 无 branch"; exit 1; }
  git ls-remote --exit-code origin "${BRANCH}" >/dev/null 2>&1 || \
    { echo "FAIL: sub_task ${sid} 分支 ${BRANCH} 未推到 origin"; exit 1; }
done
```

**硬阈值**:
- ≥1 generator sub_task 存在
- 每个 sub_task 的 generator stdout ≥ 200 bytes（H7 tee 生效，非截断）
- 每个 sub_task 的 branch 在 origin 可见（worktree push 成功）

---

### Step 5: Layer 4 evaluator 切到 generator worktree 执行（H8）+ absorption_policy 状态诚实（H10）

**可观测行为**: evaluator 阶段的 dev_record 含 `cwd` 或 `pwd` 字段指向 generator 的 task worktree 路径（不是 main 仓路径）；若本轮触发 absorption_policy，状态字段为 `applied` 或 `not_applied`，**不出现"假装 applied 但实际 not_applied"**（H10）。

**验证命令**:
```bash
# 期望：evaluator dev_record 含 generator worktree 路径痕迹（H8 生效）
EVAL_RECORDS=$(curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=evaluator&limit=10")
echo "$EVAL_RECORDS" | jq -e '.records | length >= 1' >/dev/null || \
  { echo "FAIL: 无 evaluator 记录"; exit 1; }

# 找到 evaluator 跑的 cwd（worktree 路径标志：含 .worktrees/ 或 sub_task_id 片段）
EVAL_CWD=$(echo "$EVAL_RECORDS" | jq -r '.records[0].cwd // .records[0].metadata.cwd // ""')
echo "$EVAL_CWD" | grep -qE "\.worktrees/|/worktree-" || \
  { echo "FAIL: evaluator cwd=${EVAL_CWD} 未指向 worktree（H8 未生效）"; exit 1; }

# 期望：absorption_policy 状态字段诚实（H10 生效）
# 如果本轮触发了 absorption_policy，状态必须是合法值之一；如果根本没触发，跳过
ABSORB_STATE=$(echo "$EVAL_RECORDS" | jq -r '[.records[].absorption_policy_status // empty] | last // "absent"')
case "$ABSORB_STATE" in
  applied|not_applied|absent) echo "OK: absorption_policy=${ABSORB_STATE}";;
  *) echo "FAIL: 非法 absorption_policy 状态=${ABSORB_STATE}"; exit 1;;
esac
```

**硬阈值**:
- ≥1 evaluator dev_record 存在
- evaluator cwd 字段含 `.worktrees/` 或 `/worktree-` 片段（H8 worktree 切换生效）
- absorption_policy 状态 ∈ {applied, not_applied, absent}（H10 三态合法）

---

### Step 6: 终态写回 — tasks.status 终态 + result JSON 完整 + 无 stuck/404

**可观测行为**: 本 initiative 在 `tasks` 表 `status='completed'`（PRD 期望）或 `status='failed'`（终态也算链路通），`completed_at IS NOT NULL`，`result` JSON 含 `branch` 与 `final_verdict`（或同义字段）。Brain harness 调度日志在最近 30 min 内：(a) 没有此 initiative 关联的孤儿 in_progress sub_task；(b) 没有 callback 404 错误。

**验证命令**:
```bash
# 期望：tasks 行进入终态
TASK_JSON=$(curl -fs "localhost:5221/api/brain/tasks/${TASK_ID}")
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
ORPHAN=$(curl -fs "localhost:5221/api/brain/tasks?parent_task_id=${TASK_ID}&status=in_progress&limit=20" | \
  jq -r '.tasks | length')
[ "$ORPHAN" -eq 0 ] || { echo "FAIL: ${ORPHAN} 个孤儿 in_progress sub_task"; exit 1; }

# 期望：最近 30 min 无 callback 404
CB_404=$(curl -fs "localhost:5221/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | \
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

echo "=== W8 v11 真端到端验证 — initiative=${TASK_ID} ==="

# Step 1: tick 已拾取
TASK_STATUS=$(curl -fs "${BRAIN}/api/brain/tasks/${TASK_ID}" | jq -r '.status')
[ "$TASK_STATUS" != "pending" ] || { echo "❌ Step1: tick 未拾取"; exit 1; }
DEV_REC_COUNT=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | jq -r '.records | length')
[ "$DEV_REC_COUNT" -ge 1 ] || { echo "❌ Step1: 无 dev_record"; exit 1; }
echo "✅ Step1: status=${TASK_STATUS}, dev_records=${DEV_REC_COUNT}"

# Step 2: planner PRD + stdout 静默（H9）
git fetch origin main 2>/dev/null
git show "origin/main:sprints/w8-langgraph-v11/sprint-prd.md" > /tmp/sprint-prd-check.md
[ "$(wc -c < /tmp/sprint-prd-check.md)" -ge 1000 ] || { echo "❌ Step2: PRD 过短"; exit 1; }
PLANNER_STDOUT=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=planner&limit=1" | \
  jq -r '.records[0].stdout // ""')
echo "$PLANNER_STDOUT" | grep -qE "Cloning into|^remote: |Writing objects" && \
  { echo "❌ Step2: planner stdout 含 push 噪音（H9 失效）"; exit 1; }
echo "✅ Step2: PRD ok, planner stdout 静默"

# Step 3: GAN APPROVED + task-plan.json
git fetch origin "+refs/heads/cp-harness-propose-*:refs/remotes/origin/cp-harness-propose-*" 2>/dev/null
PROPOSE_CNT=$(git branch -r | grep -cE "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}")
[ "$PROPOSE_CNT" -ge 1 ] || { echo "❌ Step3: 无 propose_branch"; exit 1; }
LAST_VERDICT=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=contract_review&limit=10" | \
  jq -r '[.records[] | .verdict // .stdout] | last // ""')
echo "$LAST_VERDICT" | grep -qE "APPROVED" || { echo "❌ Step3: GAN 未 APPROVED"; exit 1; }
LATEST_PROPOSE=$(git branch -r | grep -E "origin/cp-harness-propose-r[0-9]+-${TASK_ID:0:8}" | sort -V | tail -1 | tr -d ' ')
git show "${LATEST_PROPOSE}:sprints/w8-langgraph-v11/task-plan.json" | jq -e '.tasks | length >= 1' >/dev/null
echo "✅ Step3: ${PROPOSE_CNT} propose_branches, GAN APPROVED, task-plan ok"

# Step 4: generator sub_task + stdout ≥ 200 + branch 在 origin（H7）
SUB_TASKS=$(curl -fs "${BRAIN}/api/brain/tasks?parent_task_id=${TASK_ID}&task_type=harness_generator&limit=20")
SUB_COUNT=$(echo "$SUB_TASKS" | jq -r '.tasks | length')
[ "$SUB_COUNT" -ge 1 ] || { echo "❌ Step4: 无 generator sub_task"; exit 1; }
for sid in $(echo "$SUB_TASKS" | jq -r '.tasks[].id'); do
  STDOUT_LEN=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${sid}&stage=generator&limit=1" | \
    jq -r '.records[0].stdout // "" | length')
  [ "$STDOUT_LEN" -ge 200 ] || { echo "❌ Step4: ${sid} stdout=${STDOUT_LEN} < 200（H7 失效）"; exit 1; }
  BRANCH=$(curl -fs "${BRAIN}/api/brain/tasks/${sid}" | jq -r '.payload.branch_name // .result.branch // empty')
  [ -n "$BRANCH" ] || { echo "❌ Step4: ${sid} 无 branch"; exit 1; }
  git ls-remote --exit-code origin "${BRANCH}" >/dev/null 2>&1 || \
    { echo "❌ Step4: ${sid} branch ${BRANCH} 未推 origin"; exit 1; }
done
echo "✅ Step4: ${SUB_COUNT} sub_tasks, 全部 stdout ≥ 200 + branch 在 origin"

# Step 5: evaluator worktree（H8）+ absorption_policy 诚实（H10）
EVAL_RECORDS=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&stage=evaluator&limit=10")
echo "$EVAL_RECORDS" | jq -e '.records | length >= 1' >/dev/null || { echo "❌ Step5: 无 evaluator record"; exit 1; }
EVAL_CWD=$(echo "$EVAL_RECORDS" | jq -r '.records[0].cwd // .records[0].metadata.cwd // ""')
echo "$EVAL_CWD" | grep -qE "\.worktrees/|/worktree-" || \
  { echo "❌ Step5: evaluator cwd=${EVAL_CWD} 未指向 worktree（H8 失效）"; exit 1; }
ABSORB_STATE=$(echo "$EVAL_RECORDS" | jq -r '[.records[].absorption_policy_status // empty] | last // "absent"')
case "$ABSORB_STATE" in applied|not_applied|absent) ;; *) echo "❌ Step5: 非法 absorption_policy=${ABSORB_STATE}"; exit 1;; esac
echo "✅ Step5: H8 worktree=${EVAL_CWD}, H10 absorption=${ABSORB_STATE}"

# Step 6: 终态 + 无 stuck + 无 404
TASK_JSON=$(curl -fs "${BRAIN}/api/brain/tasks/${TASK_ID}")
STATUS=$(echo "$TASK_JSON" | jq -r '.status')
[[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] || { echo "❌ Step6: status=${STATUS} 非终态"; exit 1; }
COMPLETED_AT=$(echo "$TASK_JSON" | jq -r '.completed_at // empty')
[ -n "$COMPLETED_AT" ] || { echo "❌ Step6: completed_at 空"; exit 1; }
echo "$TASK_JSON" | jq -e '.result.branch // .result.final_branch' >/dev/null || { echo "❌ Step6: result.branch 缺失"; exit 1; }
echo "$TASK_JSON" | jq -e '.result.final_verdict // .result.verdict' >/dev/null || { echo "❌ Step6: result.final_verdict 缺失"; exit 1; }
ORPHAN=$(curl -fs "${BRAIN}/api/brain/tasks?parent_task_id=${TASK_ID}&status=in_progress&limit=20" | jq -r '.tasks | length')
[ "$ORPHAN" -eq 0 ] || { echo "❌ Step6: ${ORPHAN} 孤儿 in_progress"; exit 1; }
CB_404=$(curl -fs "${BRAIN}/api/brain/dev-records?logical_task_id=${TASK_ID}&limit=50" | \
  jq -r '[.records[] | .stdout // .stderr // "" | select(test("callback.*404|404.*callback"; "i"))] | length')
[ "$CB_404" -eq 0 ] || { echo "❌ Step6: ${CB_404} 条 callback 404"; exit 1; }
echo "✅ Step6: status=${STATUS}, completed_at=${COMPLETED_AT}, no orphan, no 404"

echo ""
echo "✅✅✅ W8 v11 Golden Path 端到端验证通过 ✅✅✅"
```

**通过标准**: 脚本 exit 0；任一 Step ❌ 即 FAIL。

---

## Workstreams

workstream_count: 2

### Workstream 1: Pipeline-trace 验证脚本（H7/H8/H9/H10 痕迹检查）

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-pipeline-trace.sh` 实现 Step 1-5 的痕迹查询脚本：拉取 Brain `tasks` / `dev-records` API，断言 H7（generator stdout ≥ 200 bytes）、H9（planner stdout 无 push 噪音）、H8（evaluator cwd 指向 worktree）、H10（absorption_policy 状态合法）四项痕迹同时成立。脚本 exit 0 = 全部痕迹齐全。

**大小**: M（约 100-180 行 bash + 5-8 个 Brain API 查询断言）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/pipeline-trace.test.ts`

---

### Workstream 2: 终态写回验证脚本

**范围**: 在 `sprints/w8-langgraph-v11/scripts/verify-terminal-state.sh` 实现 Step 6 的终态查询脚本：断言 initiative task `status ∈ {completed, failed}`、`completed_at` 非空、`result` JSON 含 `branch` + `final_verdict`、无孤儿 in_progress sub_task、最近 30 min 无 callback 404。脚本 exit 0 = 终态写回正确且无 stuck。

**大小**: S（约 60-100 行 bash）

**依赖**: Workstream 1 完成后（先确认链路痕迹再确认终态）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/terminal-state.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/pipeline-trace.test.ts` | (1) 脚本可执行存在且 chmod +x; (2) Brain API 200 时脚本断言通过; (3) generator stdout < 200 bytes 时脚本 exit 1; (4) planner stdout 含 "Cloning into" 时 exit 1; (5) evaluator cwd 不含 worktree 标志时 exit 1; (6) absorption_policy 非法状态时 exit 1 | WS1 → 6 failures（脚本未创建即所有 it 块 fail） |
| WS2 | `tests/ws2/terminal-state.test.ts` | (1) 脚本可执行存在; (2) status='completed' + 字段完整时 exit 0; (3) status='in_progress'（非终态）时 exit 1; (4) result.branch 缺失时 exit 1; (5) 存在孤儿 in_progress sub_task 时 exit 1; (6) dev_record 含 callback 404 时 exit 1 | WS2 → 6 failures（脚本未创建即所有 it 块 fail） |
