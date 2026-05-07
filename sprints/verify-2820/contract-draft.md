# Sprint Contract Draft (Round 2)

## 变量

合同中所有验证命令引用以下变量；Evaluator 必须在执行前 export 全部值（缺失即报错退出）：

| 变量 | 取值方式 | 示例 |
|---|---|---|
| `TASK_ID` | Brain 派发 harness_initiative 任务时 prompt 注入的 task_id（UUID） | `c5d80a6f-5ee4-4044-b031-ebcffaac61ce` |
| `TASK_ID_SHORT` | `$(echo "$TASK_ID" \| cut -c1-8)`，propose/review 分支命名约定的前 8 位 | `c5d80a6f` |
| `SPRINT_DIR` | Planner 写 sprint-prd.md 的目录，prompt 注入 | `sprints/verify-2820` |
| `PLANNER_BRANCH` | Planner 提交 sprint-prd.md 所在分支，prompt 注入 | `main` |
| `PROPOSE_ROUND` | 当前 GAN 轮次（整数，从 1 开始），prompt 注入 | `2` |
| `PROPOSE_BRANCH` | `cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}`，由 Proposer push 到 origin；Evaluator 用 `git ls-remote --heads origin "cp-harness-propose-r${PROPOSE_ROUND}-*" \| awk '{print $2}' \| sed 's\|refs/heads/\|\|' \| head -1` 兜底解析 | `cp-harness-propose-r2-c5d80a6f` |
| `DB` | PostgreSQL 连接串，缺省 `postgresql://localhost/cecelia`（本 Sprint 不依赖 DB） | — |

E2E 验收脚本顶部 `: "${VAR:?required}"` 已强制全部变量；Step 2/3 单独执行时也必须先 export。

---

## Golden Path

[Brain Tick 派发 harness_initiative] → [Planner 写 sprint-prd.md] → [Proposer 写 task-plan.json 并 push] → [inferTaskPlanNode git show + parseTaskPlan] → [state.taskPlan.tasks 非空 → graph 推进到 dbUpsert]

---

### Step 1: Planner 产出 sprint-prd.md

**可观测行为**: Planner 在 `${SPRINT_DIR}/sprint-prd.md` 落盘并 commit 到 `${PLANNER_BRANCH}`，内容含 `## journey_type:` 标注行（4 个合法枚举之一）。

**验证命令**:
```bash
git fetch origin "${PLANNER_BRANCH}" --quiet
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" \
  | grep -E "^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$" \
  || { echo "❌ sprint-prd.md 缺 journey_type"; exit 1; }
```

**硬阈值**: exit 0 且至少 1 行匹配 `## journey_type:` + 4 个合法枚举之一。

---

### Step 2: Proposer 产出 task-plan.json，schema 完整通过 parseTaskPlan

**可观测行为**: Proposer 把 `${SPRINT_DIR}/task-plan.json` commit 到 `${PROPOSE_BRANCH}` 并 push 到 origin；JSON 内容必须能通过生产代码 `parseTaskPlan` 全部 schema 校验（initiative_id 字段存在、tasks[] 非空、每个 task 含 task_id/title/scope/dod[]/files[]/depends_on[]/complexity∈{S,M,L}/estimated_minutes∈[20,60]）。

**验证命令**:
```bash
node scripts/harness/verify-task-plan.mjs \
  --branch="${PROPOSE_BRANCH}" \
  --sprint-dir="${SPRINT_DIR}" \
  --mode=schema
```

**硬阈值**: exit 0，stdout 含 `✅ schema OK，tasks=N` 且 N≥1；任何 schema 字段缺失会让 parseTaskPlan 抛错→脚本 die→exit 1。

---

### Step 3: inferTaskPlanNode 真实节点解析成功，graph 不进 stateHasError → END

**可观测行为**: 给定 `state.ganResult.propose_branch=$PROPOSE_BRANCH`、`state.task.payload.sprint_dir=$SPRINT_DIR`、`state.worktreePath=$(pwd)`，调用 `inferTaskPlanNode(state)` 返回 `{ taskPlan: { tasks: [...] } }`，**不返回** `{ error }`；返回的 taskPlan.tasks 长度等于 propose 分支上 task-plan.json 的 tasks 长度。

**验证命令**:
```bash
node scripts/harness/verify-task-plan.mjs \
  --branch="${PROPOSE_BRANCH}" \
  --sprint-dir="${SPRINT_DIR}" \
  --mode=infer
```

**硬阈值**: exit 0，stdout 含 `✅ inferTaskPlanNode OK，tasks=N` 且 N≥1；脚本内部断言 `delta.error === undefined` && `delta.taskPlan.tasks.length >= 1`，任何一项不满足直接 exit 1。

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

TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="${PROPOSE_BRANCH:-}"
if [ -z "$PROPOSE_BRANCH" ]; then
  PROPOSE_BRANCH=$(git ls-remote --heads origin "cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}" \
    | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
fi
[ -n "$PROPOSE_BRANCH" ] || { echo "❌ propose 分支未 push"; exit 1; }
export PROPOSE_BRANCH

# ── 1. Planner 产出校验 ──
git fetch origin "${PLANNER_BRANCH}" --quiet
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" \
  | grep -qE "^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$" \
  || { echo "❌ Step1 fail: sprint-prd.md 缺 journey_type"; exit 1; }
echo "✅ Step1: sprint-prd.md OK"

# ── 2. Proposer 产出 schema 校验 ──
node scripts/harness/verify-task-plan.mjs \
  --branch="${PROPOSE_BRANCH}" \
  --sprint-dir="${SPRINT_DIR}" \
  --mode=schema \
  || { echo "❌ Step2 fail: schema 校验异常"; exit 1; }
echo "✅ Step2: task-plan.json schema OK"

# ── 3. inferTaskPlanNode 真实节点调用 ──
node scripts/harness/verify-task-plan.mjs \
  --branch="${PROPOSE_BRANCH}" \
  --sprint-dir="${SPRINT_DIR}" \
  --mode=infer \
  || { echo "❌ Step3 fail: inferTaskPlanNode 异常"; exit 1; }
echo "✅ Step3: inferTaskPlanNode OK"

# ── 4. WS1 端到端测试套件（红→绿） ──
npx vitest run "${SPRINT_DIR}/tests/ws1/infer-task-plan-e2e.test.ts" --reporter=default \
  || { echo "❌ Step4 fail: vitest 套件未全 passed"; exit 1; }
echo "✅ Step4: vitest WS1 全 passed"

echo "✅ Golden Path 全部通过"
```

**通过标准**: 脚本 `exit 0`，stdout 含四条 `✅ StepN` 行。

---

## Workstreams

workstream_count: 1

### Workstream 1: 端到端验证 task-plan.json 经由 inferTaskPlanNode 闭环

**范围**: 本验证型 Sprint 的全部产出 — sprint-prd.md（Planner 已产出）+ task-plan.json（Proposer 产出，schema 完整）+ scripts/harness/verify-task-plan.mjs（验证脚本，Step 2/3/E2E 共用）+ tests/ws1/ 测试套件（4 条 BEHAVIOR：(a) sprint-prd.md 含 journey_type 标注；(b) task-plan.json 经 parseTaskPlan 全字段通过；(c) inferTaskPlanNode 合法分支返回 `{ taskPlan }`、无 error；(d) inferTaskPlanNode 缺失分支返回 `{ error }` 且字符串含 `task-plan.json failed`）。
**大小**: S（< 100 行新增代码，纯文档 + JSON + 1 个验证脚本 + 1 个测试文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/infer-task-plan-e2e.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/infer-task-plan-e2e.test.ts` | (1) propose 分支有合法 task-plan.json 时 inferTaskPlanNode 返回 `{ taskPlan }`、`error` 字段缺席；(2) propose 分支不存在 task-plan.json 时 inferTaskPlanNode 返回 `{ error }` 且 error 字符串含 `task-plan.json failed` 子串 | WS1 → 2 failures（task-plan.json 文件未生成 / fixture 未就位）|

**未实现/未就位状态下的红断言定位**：

```
运行: npx vitest run sprints/verify-2820/tests/ws1/infer-task-plan-e2e.test.ts
预期红断言:
  - case (1) 第 93 行: expect(delta.error).toBeUndefined() — fixture 未就位时 delta.error 非空 → FAIL
  - case (2) 第 109 行: expect(delta.error).toMatch(/task-plan\.json failed/) — propose 分支不存在时返回的 error 字符串
未实现状态下 vitest exit code = 1，符合 red-test 要求
```

辅助断言（同文件，配套覆盖 schema 与 ARTIFACT）：
- 第 94 行: `expect(delta.taskPlan).toBeDefined()` — 合法分支返回 taskPlan
- 第 96 行: `expect(delta.taskPlan.tasks.length).toBeGreaterThanOrEqual(1)` — tasks 非空
- 第 107 行: `expect(delta.error).toBeDefined()` — 缺失分支必返回 error
- 第 110 行: `expect(delta.taskPlan).toBeUndefined()` — 缺失分支不应返回 taskPlan

Green 阶段（task-plan.json 已 push、fixture 已就位）所有 4 个 it() 块全 passed，vitest exit code = 0；E2E 脚本 Step 4 即依赖该 exit code。
