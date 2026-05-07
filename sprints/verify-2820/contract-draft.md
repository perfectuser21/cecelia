# Sprint Contract Draft (Round 1)

## Golden Path

[Brain Tick 派发 harness_initiative] → [Planner 写 sprint-prd.md] → [Proposer 写 task-plan.json 并 push] → [inferTaskPlanNode git show + parseTaskPlan] → [state.taskPlan.tasks 非空 → graph 推进到 dbUpsert]

---

### Step 1: Planner 产出 sprint-prd.md

**可观测行为**: Planner 在 `${SPRINT_DIR}/sprint-prd.md` 落盘并 commit 到 PLANNER_BRANCH，内容含 `## journey_type:` 标注。

**验证命令**:
```bash
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" \
  | grep -E "^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$" \
  || { echo "❌ sprint-prd.md 缺 journey_type 行"; exit 1; }
```

**硬阈值**: exit 0 且至少 1 行匹配 `## journey_type:` + 4 个合法枚举之一。

---

### Step 2: Proposer 产出 task-plan.json 并 push 到 propose 分支

**可观测行为**: Proposer 把 `${SPRINT_DIR}/task-plan.json` commit 到 `cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}` 分支并 push 到 origin；JSON 内容必须能通过 `parseTaskPlan` 全部 schema 校验（initiative_id / tasks[] / 每个 task 含 task_id+title+scope+dod[]+files[]+depends_on[]+complexity∈{S,M,L}+estimated_minutes∈[20,60]）。

**验证命令**:
```bash
PROPOSE_BRANCH=$(git ls-remote --heads origin "cp-harness-propose-r${PROPOSE_ROUND}-*" \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
[ -n "$PROPOSE_BRANCH" ] || { echo "❌ propose 分支未 push"; exit 1; }

git fetch origin "$PROPOSE_BRANCH"
git show "origin/$PROPOSE_BRANCH:${SPRINT_DIR}/task-plan.json" > /tmp/task-plan.json \
  || { echo "❌ propose 分支无 task-plan.json"; exit 1; }

# parseTaskPlan schema 完整校验（不是简单 jq .tasks）
node -e '
  const fs = require("fs");
  const raw = fs.readFileSync("/tmp/task-plan.json", "utf8");
  // 复用生产代码的 parseTaskPlan，避免 schema 漂移
  import("./packages/brain/src/harness-dag.js").then(({ parseTaskPlan }) => {
    const plan = parseTaskPlan(raw);
    if (!Array.isArray(plan.tasks) || plan.tasks.length < 1) {
      console.error("❌ tasks 非空校验失败");
      process.exit(1);
    }
    console.log(`✅ parseTaskPlan 通过，tasks=${plan.tasks.length}`);
  }).catch(e => { console.error("❌", e.message); process.exit(1); });
'
```

**硬阈值**: parseTaskPlan 不抛异常，`tasks.length >= 1`，每个 task 通过完整 schema 校验。

---

### Step 3: inferTaskPlanNode 解析成功，graph 不进 stateHasError → END

**可观测行为**: 给定 `state.ganResult.propose_branch=$PROPOSE_BRANCH` 与 `state.task.payload.sprint_dir=sprints/verify-2820`，调用 `inferTaskPlanNode(state)` 返回 `{ taskPlan: {...} }`，**不返回** `{ error }`；返回的 taskPlan.tasks 长度等于 propose 分支上 task-plan.json 的 tasks 长度。

**验证命令**:
```bash
PROPOSE_BRANCH=$(git ls-remote --heads origin "cp-harness-propose-r${PROPOSE_ROUND}-*" \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)

node --input-type=module -e "
  import('./packages/brain/src/workflows/harness-initiative.graph.js').then(async ({ inferTaskPlanNode }) => {
    const state = {
      ganResult: { propose_branch: '$PROPOSE_BRANCH' },
      task: { payload: { sprint_dir: '${SPRINT_DIR}' } },
      worktreePath: process.cwd(),
      initiativeId: '${TASK_ID}',
    };
    const delta = await inferTaskPlanNode(state);
    if (delta.error) { console.error('❌ inferTaskPlanNode 返回 error:', delta.error); process.exit(1); }
    if (!delta.taskPlan || !Array.isArray(delta.taskPlan.tasks) || delta.taskPlan.tasks.length < 1) {
      console.error('❌ taskPlan.tasks 为空');
      process.exit(1);
    }
    console.log('✅ inferTaskPlanNode 解析 ' + delta.taskPlan.tasks.length + ' 个 task');
  }).catch(e => { console.error('❌', e.message); process.exit(1); });
"
```

**硬阈值**: exit 0，stdout 含 `✅ inferTaskPlanNode 解析`，且 `delta.error === undefined`，`delta.taskPlan.tasks.length >= 1`。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

: "${TASK_ID:?TASK_ID required}"
: "${SPRINT_DIR:?SPRINT_DIR required}"
: "${PLANNER_BRANCH:?PLANNER_BRANCH required}"
: "${PROPOSE_ROUND:?PROPOSE_ROUND required}"

# ── 1. Planner 产出校验 ──
git fetch origin "${PLANNER_BRANCH}" --quiet
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" \
  | grep -qE "^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$" \
  || { echo "❌ Step1 fail: sprint-prd.md 缺 journey_type"; exit 1; }
echo "✅ Step1: sprint-prd.md OK"

# ── 2. Proposer 产出校验（schema 完整） ──
PROPOSE_BRANCH=$(git ls-remote --heads origin "cp-harness-propose-r${PROPOSE_ROUND}-*" \
  | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
[ -n "$PROPOSE_BRANCH" ] || { echo "❌ Step2 fail: propose 分支不存在"; exit 1; }
git fetch origin "$PROPOSE_BRANCH" --quiet
git show "origin/$PROPOSE_BRANCH:${SPRINT_DIR}/task-plan.json" > /tmp/task-plan.json
node -e '
import("./packages/brain/src/harness-dag.js").then(({ parseTaskPlan }) => {
  const plan = parseTaskPlan(require("fs").readFileSync("/tmp/task-plan.json", "utf8"));
  if (plan.tasks.length < 1) process.exit(1);
  console.log("OK tasks=" + plan.tasks.length);
}).catch(e => { console.error(e.message); process.exit(1); })' \
  || { echo "❌ Step2 fail: parseTaskPlan 异常"; exit 1; }
echo "✅ Step2: task-plan.json schema OK"

# ── 3. inferTaskPlanNode 真实节点调用 ──
node --input-type=module -e "
  import('./packages/brain/src/workflows/harness-initiative.graph.js').then(async ({ inferTaskPlanNode }) => {
    const state = {
      ganResult: { propose_branch: '$PROPOSE_BRANCH' },
      task: { payload: { sprint_dir: '${SPRINT_DIR}' } },
      worktreePath: process.cwd(),
      initiativeId: '${TASK_ID}',
    };
    const delta = await inferTaskPlanNode(state);
    if (delta.error) { console.error('error:', delta.error); process.exit(1); }
    if (!delta.taskPlan || delta.taskPlan.tasks.length < 1) process.exit(1);
    console.log('OK ' + delta.taskPlan.tasks.length);
  }).catch(e => { console.error(e.message); process.exit(1); });
" || { echo "❌ Step3 fail: inferTaskPlanNode 异常"; exit 1; }
echo "✅ Step3: inferTaskPlanNode OK"

echo "✅ Golden Path 全部通过"
```

**通过标准**: 脚本 `exit 0`，stdout 含三条 `✅ StepN` 行。

---

## Workstreams

workstream_count: 1

### Workstream 1: 端到端验证 task-plan.json 经由 inferTaskPlanNode 闭环

**范围**: 本验证型 Sprint 的全部产出 — sprint-prd.md（Planner 已产出）+ task-plan.json（Proposer 产出，schema 完整）+ 测试用例（覆盖 inferTaskPlanNode 成功 + propose 分支无 task-plan.json 时返回 error 两条 BEHAVIOR）。
**大小**: S（< 100 行新增代码，纯文档 + JSON + 1 个测试文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/infer-task-plan-e2e.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/infer-task-plan-e2e.test.ts` | (1) propose 分支有合法 task-plan.json 时 inferTaskPlanNode 返回 `{ taskPlan }`、`error` 字段缺席；(2) propose 分支不存在 task-plan.json 时 inferTaskPlanNode 返回 `{ error }` 且 error 字符串含 `task-plan.json failed` 子串 | WS1 → 2 failures（task-plan.json 文件未生成 / fixture 未就位）|
