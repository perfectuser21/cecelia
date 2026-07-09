# 刀4阶段3：删除废弃 LangGraph 死图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 物理删除两个已废弃的 LangGraph 死图文件（`harness-task.graph.js` / `harness-initiative.graph.js`）及其全部死引用（6处运行时代码分支 + 1个僵尸smoke脚本 + 85个测试文件），不改变任何生产运行时行为（这些路径在 skill-relay 硬校验后本来就不可达）。

**Architecture:** 纯删除/裁剪任务，无新逻辑。执行顺序遵循"先删依赖方，后删被依赖方"——先处理引用死图的测试和运行时分支，最后删图文件本身，任何一步中断都不会让仓库进入"import 找不到文件"的坏状态。

**Tech Stack:** Node.js / vitest / Brain (Express + LangGraph 残留) / Docker

## Global Constraints

- 每步改动后必须能独立 `node --check` 通过（不引入语法错误的中间态）
- 所有删除对象已在设计文档 `docs/superpowers/specs/2026-07-09-dao4-stage3-delete-dead-graphs-design.md` 逐一核实为运行时不可达（`payload.orchestrator !== 'skill-relay'` 硬校验后物理走不到）
- 禁止修改本计划列出范围之外的任何文件
- 明确不动：`harness-gan.graph.js`、`walking-skeleton-1node.graph.js`、`harness-final-e2e.js`、`harness-utils`/`shared`/`heartbeat`

---

## 附录 A：73 个直接删除的测试文件（A类）

```
packages/brain/src/__tests__/harness-artifact-gate.test.js
packages/brain/src/__tests__/harness-b40-exclude-tests-dir.test.js
packages/brain/src/__tests__/harness-container-liveness.test.js
packages/brain/src/__tests__/harness-end-status-and-gate-deps.test.js
packages/brain/src/__tests__/harness-fixloop-terminal-abort.test.js
packages/brain/src/__tests__/harness-handoff-wiring.test.js
packages/brain/src/__tests__/harness-initiative-base-repo.test.js
packages/brain/src/__tests__/harness-infertaskplan-terminal.test.js
packages/brain/src/__tests__/harness-initiative-evaluate.test.js
packages/brain/src/__tests__/harness-initiative-terminal-flag.test.js
packages/brain/src/__tests__/harness-promote-wiring.test.js
packages/brain/src/__tests__/harness-report-self-merge-gate.test.js
packages/brain/src/__tests__/harness-serial-gate.test.js
packages/brain/src/__tests__/harness-report-merge-recheck.test.js
packages/brain/src/__tests__/harness-sprintdir-from-fs.test.js
packages/brain/src/__tests__/harness-subtask-verdict-passthrough.test.js
packages/brain/src/__tests__/harness-sprintdir-from-gitlog.test.js
packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js
packages/brain/src/__tests__/harness-task-verdict.test.js
packages/brain/src/__tests__/reportnode-spawn-staging-e2e.test.js
packages/brain/src/__tests__/slice3-report-postpromote.test.js
packages/brain/src/lib/__tests__/harness-thread-lookup.test.js
packages/brain/src/workflows/__tests__/await-callback-retry.test.js
packages/brain/src/workflows/__tests__/b21-merge-pr-auto.test.js
packages/brain/src/workflows/__tests__/b32-proposer-push-verify.test.js
packages/brain/src/workflows/__tests__/contract-gate-wiring.test.js
packages/brain/src/workflows/__tests__/fix-dispatch-keep-pr-url.test.js
packages/brain/src/workflows/__tests__/harness-evaluate-reentry-idem.test.js
packages/brain/src/workflows/__tests__/artifact-gate-fetch-refspec.test.js
packages/brain/src/workflows/__tests__/harness-callback-auth-rotation.test.js
packages/brain/src/workflows/__tests__/fix-dispatch-max-rounds.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b37.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b42.test.js
packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js
packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js
packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js
packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b36.test.js
packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
packages/brain/src/workflows/__tests__/harness-initiative.graph.xian-routing.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js
packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js
packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js
packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js
packages/brain/src/workflows/__tests__/harness-reporter-payload.test.js
packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js
packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js
packages/brain/src/workflows/__tests__/harness-langgraph-step-events.test.js
packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js
packages/brain/src/workflows/__tests__/harness-subthread-contract-binding.test.js
packages/brain/src/workflows/__tests__/harness-initiative.graph.test.js
packages/brain/src/workflows/__tests__/harness-pipeline-p2p3-fixes.test.js
packages/brain/src/workflows/__tests__/harness-task-evaluator-verdict.test.js
packages/brain/src/workflows/__tests__/harness-task-evaluator-merged-shortcircuit.test.js
packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js
packages/brain/src/workflows/__tests__/harness-task.graph.xian-spawn.test.js
packages/brain/src/workflows/__tests__/harness-task.graph.poll-ci-no-checks.test.js
packages/brain/src/workflows/__tests__/harness-spawn-fail-fast.test.js
packages/brain/src/workflows/__tests__/harness-subtask-error-diag.test.js
packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js
packages/brain/src/workflows/__tests__/harness-task.graph.permerge-staging.test.js
packages/brain/src/workflows/__tests__/runSubTaskNode-payload.test.js
packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js
packages/brain/src/workflows/__tests__/idempotency-guards.test.js
packages/brain/src/workflows/__tests__/harness-task.graph.test.js
packages/brain/src/workflows/__tests__/spawn-credentials.test.js
packages/brain/src/workflows/__tests__/runGanLoopNode-checkpointer.test.js
packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js
packages/brain/src/workflows/__tests__/ws2-planner-async.test.js
```

（缺失 `harness-max-fresh-starts.test.js` / `harness-orchestrator-lockdown.test.js` / `harness-resume-checkpoint-error-state.test.js` / `harness-line-context-wiring.test.js` / `p1-container-path.test.js` / `harness-sprint-subdir-detection.test.js` / `harness-pending-reviews.test.js` / `durability-config.test.js` / `harness-session-reconnect.integration.test.js` / `index.test.js` / `executor-xian-env-passthrough.test.js` / `harness-gan-async.test.js` / `harness-initiative-b39.test.js` —— 这 13 个是附录 B 的 B 类/无需改动文件，不在此删除列表。)

## 附录 B：12 个部分调整的测试文件（B类）+ 1 个确认无需改动

| 文件 | 需要删除的部分 | 需要保留的部分 |
|---|---|---|
| `__tests__/executor-xian-env-passthrough.test.js` | 无需改动（只在注释提及死图，不实际引用） | 全部保留 |
| `__tests__/harness-initiative-executor-writeback.test.js` | 顶部 `vi.mock('../workflows/harness-initiative.graph.js', ...)` 整行删除 | 其余全部（测 executor.js `triggerCeceliaRun`） |
| `__tests__/harness-line-context-wiring.test.js` | 删除 import/describe 中引用 `spawnNode`/`evaluateContractNode`（来自 harness-task.graph.js）的 describe 块 | 保留引用 `createGanContractNodes`/`runGanContractGraph`（harness-gan.graph.js）的 describe 块 |
| `__tests__/harness-max-fresh-starts.test.js` | 顶部 `vi.mock('../workflows/harness-initiative.graph.js', ...)` 相关 mock 声明删除（若仅作为依赖桩不再需要则整段删，若 executor.js 改动后仍需隔离依赖则保留但确认 mock 目标模块仍存在） | 测 `runHarnessInitiativeRouter` 的 test case 全保留 |
| `__tests__/harness-orchestrator-lockdown.test.js` | 检查是否有 test case 专门覆盖 executor.js 2906-3079 行（本计划 Task 3 会删除）的死代码块；若有则删除该 case | 测 `_driveHarnessInitiative` 硬校验（orchestrator!=='skill-relay' → terminal failed）的 case 全保留——这是活逻辑 |
| `__tests__/harness-resume-checkpoint-error-state.test.js` | 同 harness-max-fresh-starts：清理顶部对死图模块的 mock 声明 | 测 `runHarnessInitiativeRouter` 坏 checkpoint 检测/并发互斥的 case 全保留 |
| `__tests__/p1-container-path.test.js` | 删除 `describe('P1#6 harness-initiative.graph.js 显式 import crypto')` 整个 describe 块 | 保留 `describe('P1#3 getRepoRoot')`（测 executor.js，活） |
| `__tests__/harness-sprint-subdir-detection.test.js` | 删除引用 `parsePrdNode`（harness-initiative.graph.js）的 describe 块 | 保留引用 `defaultReadContractFile`（harness-gan.graph.js）的 describe 块 |
| `routes/__tests__/harness-pending-reviews.test.js` | 删除顶部 `vi.mock('../../workflows/harness-task.graph.js', ...)` 及 `buildTaskThreadId` mock；同步核对 approve/reject 的 resume 相关 test case（若断言依赖已删的 resume 分支行为则删除该 case，若只断言 HTTP 状态码/响应体则保留） | GET 路由相关 test case 全保留 |
| `workflows/__tests__/durability-config.test.js` | `FILES` 数组里删除 `harness-task.graph.js` / `harness-initiative.graph.js` 两项及对应 test case | 保留 `consciousness`/`dev-task`/`harness-gan` 三个 test case |
| `workflows/__tests__/harness-gan-async.test.js` | 无需改动（import 全部来自 harness-gan.graph.js，注释提及死图不影响） | 全部保留 |
| `workflows/__tests__/harness-initiative-b39.test.js` | 无需改动（不真实 import 死图，测的是 `readBrainResult`） | 全部保留 |
| `workflows/__tests__/harness-session-reconnect.integration.test.js` | 删除 `describe('planner session reconnect')`（import 自 harness-initiative.graph.js） | 保留 `describe('harness-gan.graph — GanContractState session_map')`（活） |
| `workflows/__tests__/index.test.js` | 删除 `describe('initializeWorkflows — harness-initiative')`（对应 workflows/index.js 里要删的注册分支）；删除顶部对应的 `vi.mock('../harness-initiative.graph.js', ...)` | 保留 `describe('initializeWorkflows()')` 测 dev-task 注册的部分 |

---

## Task 1: 删除 73 个 A 类死图单元测试

**Files:**
- Delete: 附录 A 列出的全部 73 个文件

**Interfaces:** 无（纯删除，不影响其他任务的接口）

- [ ] **Step 1: 批量删除附录A文件**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
git rm packages/brain/src/__tests__/harness-artifact-gate.test.js \
  packages/brain/src/__tests__/harness-b40-exclude-tests-dir.test.js \
  packages/brain/src/__tests__/harness-container-liveness.test.js \
  packages/brain/src/__tests__/harness-end-status-and-gate-deps.test.js \
  packages/brain/src/__tests__/harness-fixloop-terminal-abort.test.js \
  packages/brain/src/__tests__/harness-handoff-wiring.test.js \
  packages/brain/src/__tests__/harness-initiative-base-repo.test.js \
  packages/brain/src/__tests__/harness-infertaskplan-terminal.test.js \
  packages/brain/src/__tests__/harness-initiative-evaluate.test.js \
  packages/brain/src/__tests__/harness-initiative-terminal-flag.test.js \
  packages/brain/src/__tests__/harness-promote-wiring.test.js \
  packages/brain/src/__tests__/harness-report-self-merge-gate.test.js \
  packages/brain/src/__tests__/harness-serial-gate.test.js \
  packages/brain/src/__tests__/harness-report-merge-recheck.test.js \
  packages/brain/src/__tests__/harness-sprintdir-from-fs.test.js \
  packages/brain/src/__tests__/harness-subtask-verdict-passthrough.test.js \
  packages/brain/src/__tests__/harness-sprintdir-from-gitlog.test.js \
  packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js \
  packages/brain/src/__tests__/harness-task-verdict.test.js \
  packages/brain/src/__tests__/reportnode-spawn-staging-e2e.test.js \
  packages/brain/src/__tests__/slice3-report-postpromote.test.js \
  packages/brain/src/lib/__tests__/harness-thread-lookup.test.js \
  packages/brain/src/workflows/__tests__/await-callback-retry.test.js \
  packages/brain/src/workflows/__tests__/b21-merge-pr-auto.test.js \
  packages/brain/src/workflows/__tests__/b32-proposer-push-verify.test.js \
  packages/brain/src/workflows/__tests__/contract-gate-wiring.test.js \
  packages/brain/src/workflows/__tests__/fix-dispatch-keep-pr-url.test.js \
  packages/brain/src/workflows/__tests__/harness-evaluate-reentry-idem.test.js \
  packages/brain/src/workflows/__tests__/artifact-gate-fetch-refspec.test.js \
  packages/brain/src/workflows/__tests__/harness-callback-auth-rotation.test.js \
  packages/brain/src/workflows/__tests__/fix-dispatch-max-rounds.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b37.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b42.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b36.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative.graph.xian-routing.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b40.test.js \
  packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-idempotent.test.js \
  packages/brain/src/workflows/__tests__/harness-reporter-payload.test.js \
  packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js \
  packages/brain/src/workflows/__tests__/harness-langgraph-step-events.test.js \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js \
  packages/brain/src/workflows/__tests__/harness-subthread-contract-binding.test.js \
  packages/brain/src/workflows/__tests__/harness-initiative.graph.test.js \
  packages/brain/src/workflows/__tests__/harness-pipeline-p2p3-fixes.test.js \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-verdict.test.js \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-merged-shortcircuit.test.js \
  packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js \
  packages/brain/src/workflows/__tests__/harness-task.graph.xian-spawn.test.js \
  packages/brain/src/workflows/__tests__/harness-task.graph.poll-ci-no-checks.test.js \
  packages/brain/src/workflows/__tests__/harness-spawn-fail-fast.test.js \
  packages/brain/src/workflows/__tests__/harness-subtask-error-diag.test.js \
  packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js \
  packages/brain/src/workflows/__tests__/harness-task.graph.permerge-staging.test.js \
  packages/brain/src/workflows/__tests__/runSubTaskNode-payload.test.js \
  packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js \
  packages/brain/src/workflows/__tests__/idempotency-guards.test.js \
  packages/brain/src/workflows/__tests__/harness-task.graph.test.js \
  packages/brain/src/workflows/__tests__/spawn-credentials.test.js \
  packages/brain/src/workflows/__tests__/runGanLoopNode-checkpointer.test.js \
  packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js \
  packages/brain/src/workflows/__tests__/ws2-planner-async.test.js
```

- [ ] **Step 2: 确认删除数量**

```bash
git status --short | grep "^D" | wc -l
```
Expected: 73

- [ ] **Step 3: Commit**

```bash
git commit -m "test(harness): 删除73个仅测试已废弃LangGraph死图节点的单元测试

刀4阶段3 Task 1/6：这些测试的测试对象（图节点函数/图编译/图路由）
在 skill-relay 硬校验后已物理不可达，图文件本身将在 Task 4 删除。
每个文件已逐一核实测试对象来自 harness-task.graph.js 或
harness-initiative.graph.js 导出符号，无回归覆盖损失。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: 调整 12 个 B 类测试文件

**Files:** 附录 B 表格列出的 12 个文件（`executor-xian-env-passthrough.test.js`/`harness-gan-async.test.js`/`harness-initiative-b39.test.js` 三个确认无需改动，跳过）

**Interfaces:** 无

- [ ] **Step 1: 逐文件按附录B「需要删除的部分」列删除对应 describe/mock/test case**

对每个文件：
1. `Read` 文件全文
2. 定位附录B指定的 describe 块或 mock 声明（按 import 的符号名 `grep -n "spawnNode\|evaluateContractNode\|parsePrdNode"` 等定位边界）
3. 用 `Edit` 删除该 describe 块（含其 `describe(...) { ... }` 完整闭合）或 mock 声明整行
4. 确认删除后文件顶部 import 语句里不再有指向 `harness-task.graph.js` / `harness-initiative.graph.js` 的引用（若该文件删完后不再需要该 import，一并删除 import 行）

- [ ] **Step 2: 对每个改动文件跑该文件自己的测试确认仍能通过（此时死图文件还没删，import 还在，应该全绿）**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
npx vitest run packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js \
  packages/brain/src/__tests__/harness-line-context-wiring.test.js \
  packages/brain/src/__tests__/harness-max-fresh-starts.test.js \
  packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js \
  packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js \
  packages/brain/src/__tests__/p1-container-path.test.js \
  packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js \
  packages/brain/src/routes/__tests__/harness-pending-reviews.test.js \
  packages/brain/src/workflows/__tests__/durability-config.test.js \
  packages/brain/src/workflows/__tests__/harness-session-reconnect.integration.test.js \
  packages/brain/src/workflows/__tests__/index.test.js
```
Expected: 全部 PASS（此时图文件尚未删除，只是移除了对死分支的测试）

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js \
  packages/brain/src/__tests__/harness-line-context-wiring.test.js \
  packages/brain/src/__tests__/harness-max-fresh-starts.test.js \
  packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js \
  packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js \
  packages/brain/src/__tests__/p1-container-path.test.js \
  packages/brain/src/__tests__/harness-sprint-subdir-detection.test.js \
  packages/brain/src/routes/__tests__/harness-pending-reviews.test.js \
  packages/brain/src/workflows/__tests__/durability-config.test.js \
  packages/brain/src/workflows/__tests__/harness-session-reconnect.integration.test.js \
  packages/brain/src/workflows/__tests__/index.test.js
git commit -m "test(harness): 12个混合测试文件裁剪掉测死图分支的部分，保留测活代码的部分

刀4阶段3 Task 2/6：这些文件同时覆盖活代码（executor.js路由逻辑/
harness-gan.graph.js等）和死图分支，只删死图相关的describe/mock，
活代码覆盖不受影响。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: 删除 6 个运行时文件里的死分支

**Files:**
- Modify: `packages/brain/src/executor.js` (2906-3079行，先 grep 复核当前行号)
- Modify: `packages/brain/src/workflows/index.js` (L12 import + L31-33 registerWorkflow)
- Modify: `packages/brain/src/lib/harness-thread-lookup.js` (85-93/100-108/111-114/118-127行，保留54-131本体+74-83 walking-skeleton)
- Modify: `packages/brain/src/routes/harness-callback.js` (95-107行)
- Modify: `packages/brain/src/routes/harness-pending-reviews.js` (83-98 + 118-136行)
- Modify: `packages/brain/src/routes/harness-interrupts.js` (100-122行)

**Interfaces:** 无对外接口变化（删除的都是永远不会被路由到的分支）

- [ ] **Step 1: grep 复核当前行号（main 一直在前进，之前调研的行号可能已漂移）**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
grep -n "eslint-disable no-unreachable\|compileHarnessFullGraph" packages/brain/src/executor.js
grep -n "compileHarnessInitiativeGraph\|registerWorkflow('harness-initiative'" packages/brain/src/workflows/index.js
grep -n "harness-task\|harness-initiative\|harness-evaluate\|harness-gan\|walking-skeleton\|lookupHarnessThread" packages/brain/src/lib/harness-thread-lookup.js
grep -n "cecelia-relay-\|compileHarnessTaskGraph\|compileHarnessFullGraph" packages/brain/src/routes/harness-callback.js
grep -n "compileHarnessTaskGraph" packages/brain/src/routes/harness-pending-reviews.js
grep -n "compileHarnessFullGraph" packages/brain/src/routes/harness-interrupts.js
```

- [ ] **Step 2: 用 Read+Edit 逐文件删除死分支**

对每个文件：
1. `Read` 目标行区间前后各20行拿到完整上下文（确认 if/else 或 switch case 的边界，不能删出语法错误）
2. `Edit` 删除死分支代码块，若是 if/else 结构的一支，改写条件逻辑保证语义完整（例如 `if (deadCondition) { deadBranch } else { liveBranch }` → 直接保留 `liveBranch` 内容，去掉判断）
3. `node --check <file>` 确认语法通过

对 `executor.js`：删除 2906 行起的注释块和 `/* eslint-disable no-unreachable */` 到函数结束前的不可达代码（保留 2880-2905 行的 orchestrator 硬校验 + skill-relay spawn + return，这段是活代码）

- [ ] **Step 3: 全部 node --check**

```bash
node --check packages/brain/src/executor.js
node --check packages/brain/src/workflows/index.js
node --check packages/brain/src/lib/harness-thread-lookup.js
node --check packages/brain/src/routes/harness-callback.js
node --check packages/brain/src/routes/harness-pending-reviews.js
node --check packages/brain/src/routes/harness-interrupts.js
```
Expected: 全部无输出（语法通过）

- [ ] **Step 4: 跑 Task 2 已改过的对应测试确认仍绿（此时死分支代码已删，但图文件还在，import 还能解析）**

```bash
npx vitest run packages/brain/src/__tests__/harness-max-fresh-starts.test.js \
  packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js \
  packages/brain/src/__tests__/harness-resume-checkpoint-error-state.test.js \
  packages/brain/src/routes/__tests__/harness-pending-reviews.test.js \
  packages/brain/src/workflows/__tests__/index.test.js
```
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/executor.js packages/brain/src/workflows/index.js \
  packages/brain/src/lib/harness-thread-lookup.js packages/brain/src/routes/harness-callback.js \
  packages/brain/src/routes/harness-pending-reviews.js packages/brain/src/routes/harness-interrupts.js
git commit -m "refactor(harness): 删除6处运行时代码里已不可达的LangGraph图调用分支

刀4阶段3 Task 3/6：orchestrator硬校验(2026-07-05起)保证 harness_initiative
任务必须走skill-relay，以下分支物理不可达：executor.js旧图调用块、
workflows/index.js的harness-initiative图注册、harness-thread-lookup.js的
四个图分支、harness-callback.js/harness-pending-reviews.js/harness-interrupts.js
的图resume分支。保留lookupHarnessThread本体+walking-skeleton分支（仍活用）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: 删除两个图文件本身 + 僵尸smoke脚本 + 修复b43断言

**Files:**
- Delete: `packages/brain/src/workflows/harness-task.graph.js`
- Delete: `packages/brain/src/workflows/harness-initiative.graph.js`
- Delete: `packages/brain/scripts/smoke/reportnode-task-writeback-smoke.sh`
- Modify: `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh` (56-61行左右，grep 复核)

**Interfaces:** 无（此时所有引用方已在 Task 1-3 清理完毕）

- [ ] **Step 1: 确认无残留引用（Task 1-3 应该已经清理干净）**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
grep -rln "harness-task\.graph\.js\|harness-initiative\.graph\.js" packages/brain/src packages/brain/scripts --include="*.js" --include="*.sh"
```
Expected: 空输出（若有残留，回到对应 Task 补删）

- [ ] **Step 2: 删除图文件和僵尸smoke**

```bash
git rm packages/brain/src/workflows/harness-task.graph.js
git rm packages/brain/src/workflows/harness-initiative.graph.js
git rm packages/brain/scripts/smoke/reportnode-task-writeback-smoke.sh
```

- [ ] **Step 3: 修复 b43 smoke 脚本的 compileHarnessFullGraph 断言**

```bash
grep -n "compileHarnessFullGraph" packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```
读取该文件对应行区间，删除断言 `compileHarnessFullGraph` export 存在的那个 Case（若整个 Case 只测这一件事就删掉整个 Case 块；若是多断言里的一条，只删这一条，保留其余）

- [ ] **Step 4: node --check + bash 语法检查**

```bash
node -e "require('fs').readdirSync('packages/brain/src/workflows').includes('harness-task.graph.js')" 2>&1 | grep -q false && echo "确认已删除"
bash -n packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(harness): 物理删除两个废弃LangGraph图文件 + 僵尸reportNode smoke

刀4阶段3 Task 4/6：harness-task.graph.js / harness-initiative.graph.js
全部图外引用已在Task1-3清理完毕。一并删除专测死图reportNode函数的
僵尸smoke脚本reportnode-task-writeback-smoke.sh，修复b43 smoke里对
已删除的compileHarnessFullGraph export的断言。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: 全量验证

**Files:** 无新增，只运行验证

- [ ] **Step 1: 全仓库残留引用扫描**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
grep -rn "harness-task\.graph\|harness-initiative\.graph\|compileHarnessFullGraph\|compileHarnessTaskGraph\|compileHarnessInitiativeGraph" packages/brain/src packages/brain/scripts --include="*.js" --include="*.sh"
```
Expected: 空输出

- [ ] **Step 2: Brain 完整单测套件**

```bash
cd packages/brain && npx vitest run 2>&1 | tail -60
```
Expected: 全绿（除已知的历史基线红——见 memory harness-cross-repo-fix-progress 提到的既有环境红：sprints/ 历史合同 + okr integration + OOM worker，这些与本次改动无关，不必修）

- [ ] **Step 3: DevGate 三件套**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个都通过（若 version-sync 要求 bump 版本，按 packages/brain/package.json 现有版本 +1 patch，同步改 5 个版本文件）

- [ ] **Step 4: Brain 本地启动自检（不影响生产容器，本地起一个临时进程验证boot不崩）**

```bash
cd packages/brain && node --check src/server.js && timeout 10 node -e "
process.env.NODE_ENV='test';
import('./src/server.js').then(() => { console.log('BOOT_OK'); process.exit(0); }).catch(e => { console.error('BOOT_FAIL', e.message); process.exit(1); });
" 2>&1 | tail -20
```
Expected: 看到 `BOOT_OK` 或至少不是因为找不到 harness-task.graph.js / harness-initiative.graph.js 而崩（若因端口占用等无关原因退出属正常，只要不是 MODULE_NOT_FOUND 指向已删文件）

- [ ] **Step 5: Commit（若前面步骤有版本bump等改动）**

```bash
git add -A
git commit -m "chore(brain): DevGate版本同步（刀4阶段3收尾）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" --allow-empty
```

---

## Task 6: Push + PR

**Files:** 无

- [ ] **Step 1: Push**

```bash
cd /Users/administrator/worktrees/cecelia/dao4-stage3-delete-dead-graphs
git push -u origin cp-0709152321-dao4-stage3-delete-dead-graphs
```

- [ ] **Step 2: 开 PR**

```bash
gh pr create --title "refactor(brain): 刀4阶段3 — 物理删除废弃LangGraph死图（harness-task.graph.js + harness-initiative.graph.js）" \
  --body "$(cat <<'EOF'
## Summary
- 刀4三阶段收尾：阶段1(staging_e2e端点)+阶段2(controller接回派生)均已上生产，本PR执行阶段3——物理删除已确认运行时不可达的LangGraph图代码
- 删除 harness-task.graph.js + harness-initiative.graph.js（skill-relay orchestrator硬校验后compile*Graph调用路径物理走不到）
- 清理6处死路由/lib分支（executor.js/workflows/index.js/harness-thread-lookup.js/harness-callback.js/harness-pending-reviews.js/harness-interrupts.js），保留仍被walking-skeleton-1node图复用的lookupHarnessThread本体
- 删除85个测试文件中的引用（73个整删+12个部分裁剪），删除专测死图reportNode的僵尸smoke脚本
- 不改变任何生产运行时行为（纯删除已确认死代码）

设计文档：docs/superpowers/specs/2026-07-09-dao4-stage3-delete-dead-graphs-design.md
实现计划：docs/superpowers/plans/2026-07-09-dao4-stage3-delete-dead-graphs.md

## Test plan
- [x] 全仓库 grep 确认零残留引用
- [x] Brain 单测套件全绿（历史基线红除外）
- [x] DevGate 三件套通过
- [x] 本地 boot 自检确认无 MODULE_NOT_FOUND

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: 交给 engine-ship + engine-pr-watchdog 走完剩余流程**（合并后自动回写 handoff）
