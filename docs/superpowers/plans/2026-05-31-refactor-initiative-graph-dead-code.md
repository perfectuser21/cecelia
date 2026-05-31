# Initiative Graph 死代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 PR #3188 删除 final_evaluate 节点后遗留的 7 个孤立函数（以及 @deprecated 区块），以及只测这些函数的测试文件。

**Architecture:** 纯删除操作，不新增任何代码。主文件删 ~600 行，7 个测试文件整体删除，3 个混合测试文件删除对应的 describe 块和 import。无生产行为改变。

**Tech Stack:** Node.js, Vitest

---

## 文件改动清单

**主文件（删除死函数）：**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

**完整删除的测试文件（7个）：**
- Delete: `packages/brain/src/workflows/__tests__/final-evaluate-pr-branch.test.js`
- Delete: `packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js`
- Delete: `packages/brain/src/workflows/__tests__/harness-quality-fixes.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-cross-repo-final-evaluate.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js`
- Delete: `tests/integration/harness-interrupt-resume.test.ts`

**部分删除的测试文件（3个）：**
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-langgraph-step-events.test.js`
- Modify: `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`

---

### Task 1：删除主文件死函数与孤立 import

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

**背景：**
下列函数不在 `buildHarnessFullGraph()` 中使用，是 PR #3188 删 final_evaluate 节点后的残留：
- `runInitiative`（行 98–317，旧过程式实现）
- `@deprecated` 区块：`checkAllTasksCompleted` / `createFixTask` / `runPhaseCIfReady`（行 319–542）
- `fanoutSubTasksNode`（行 1085–1098）
- `fanoutPassthroughNode`（行 1100–1107）
- `_collectCoveredTasks`（行 1372–1376，辅助函数只在 finalE2eNode 里用）
- `joinSubTasksNode`（行 1349–1370）
- `finalE2eNode`（行 1378–1439）
- `routeAfterEvaluate`（行 1652–1665，注释明确"不连接 graph"）
- `finalEvaluateDispatchNode`（行 1667–1848，含 JSDoc）

删除后需同步删除孤立 import：
- 行 38：`import { runFinalE2E, attributeFailures } from '../harness-final-e2e.js'`（只在 runPhaseCIfReady 里用）
- 行 39：`harnessSubTaskWorktreePath`（只在 finalEvaluateDispatchNode 里用），保留 `ensureHarnessWorktree`
- 行 939–942 的 import block：`runScenarioCommand` / `bootstrapE2E` / `teardownE2E` / `normalizeAcceptance`（只在 finalE2eNode 里用）

**保留的 import（仍在 live 函数里用）：**
- `spawnDockerDetached`（在 runPlannerNode line 620 用）
- `resolveAccount`（在 runPlannerNode line 655 用）
- `fetchAndShowOriginFile`（在 inferTaskPlanNode line 1056 用）
- `ensureHarnessWorktree`（在 prepInitiativeNode 用）

- [ ] **Step 1.1：删除顶部 JSDoc（行 1–27），替换为简短注释**

将文件开头的旧 JSDoc（引用 runInitiative/runPhaseCIfReady 的文档）替换为：

```js
/**
 * Harness v2 — Initiative Graph（Phase A + B LangGraph 实现）
 *
 * 唯一执行路径：executor.js harness_initiative → compileHarnessFullGraph()
 * Phase A: prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert
 * Phase B: pick_sub_task → run_sub_task（loop）→ report
 */
```

- [ ] **Step 1.2：删除 `runInitiative` 函数（行 98–317）**

定位并删除从 `export async function runInitiative(task, opts = {}) {` 到其结束 `}` 的完整函数体（约220行）。

- [ ] **Step 1.3：删除 @deprecated 区块（行 319–542）**

删除从注释 `// ─── @deprecated 阶段 C — Final E2E + 失败归因` 到 `runPhaseCIfReady` 函数结束 `}` 的全部内容，包括：
- `checkAllTasksCompleted`
- `createFixTask`
- `runPhaseCIfReady`

- [ ] **Step 1.4：删除行 38 的孤立 import**

删除：
```js
import { runFinalE2E, attributeFailures } from '../harness-final-e2e.js';
```

- [ ] **Step 1.5：修改行 39，只保留 ensureHarnessWorktree**

将：
```js
import { ensureHarnessWorktree, harnessSubTaskWorktreePath } from '../harness-worktree.js';
```
改为：
```js
import { ensureHarnessWorktree } from '../harness-worktree.js';
```

- [ ] **Step 1.6：删除 fanoutSubTasksNode + fanoutPassthroughNode**

删除从 `/**\n * fanoutSubTasksNode:` JSDoc 开始到 `fanoutPassthroughNode` 函数结束 `}` 的内容（约28行）。

- [ ] **Step 1.7：删除 `_collectCoveredTasks`、`joinSubTasksNode`、`finalE2eNode`**

删除：
1. `export async function joinSubTasksNode(state)` 整个函数
2. `function _collectCoveredTasks(scenarios)` 辅助函数
3. `export async function finalE2eNode(state, opts = {})` 整个函数

- [ ] **Step 1.8：删除 行 939–942 的孤立 import block**

删除：
```js
import {
  runScenarioCommand,
  bootstrapE2E,
  teardownE2E,
  normalizeAcceptance,
} from '../harness-final-e2e.js';
```

- [ ] **Step 1.9：删除 `routeAfterEvaluate`**

删除包括注释行在内的：
```
// routeAfterEvaluate: 不连接 graph（initiative 层的 evaluate 节点已删除...
// 保留 export 仅供 harness-initiative-evaluate.test.js 单元测试引用，不影响生产 graph。
export function routeAfterEvaluate(state) { ... }
```

- [ ] **Step 1.10：删除 `finalEvaluateDispatchNode`（含 JSDoc）**

删除从 `// Change 6: finalEvaluateDispatchNode (Mode B)` 注释开始，到函数体结束 `}` 的全部内容（约180行）。

- [ ] **Step 1.11：删除 `_routeAfterJoin` 辅助函数（如果只在旧 full graph 里用）**

检查 `function _routeAfterJoin(state)` 是否在 `buildHarnessFullGraph` 里引用：
```bash
grep -n "_routeAfterJoin" packages/brain/src/workflows/harness-initiative.graph.js
```
如果 `buildHarnessFullGraph` 里没有引用，删除它。

- [ ] **Step 1.12：验证文件可解析**

```bash
cd /Users/administrator/worktrees/cecelia/refactor-dead-nodes-0531
node --input-type=module < packages/brain/src/workflows/harness-initiative.graph.js 2>&1 | head -5 || true
node -e "import('./packages/brain/src/workflows/harness-initiative.graph.js').then(() => console.log('OK')).catch(e => console.error(e.message))" 2>&1
```

---

### Task 2：删除只测死函数的整个测试文件（7个）

**Files:**
- Delete: `packages/brain/src/workflows/__tests__/final-evaluate-pr-branch.test.js`
- Delete: `packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js`
- Delete: `packages/brain/src/workflows/__tests__/harness-quality-fixes.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-cross-repo-final-evaluate.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js`
- Delete: `packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js`
- Delete: `tests/integration/harness-interrupt-resume.test.ts`

- [ ] **Step 2.1：执行删除**

```bash
cd /Users/administrator/worktrees/cecelia/refactor-dead-nodes-0531
rm packages/brain/src/workflows/__tests__/final-evaluate-pr-branch.test.js
rm packages/brain/src/workflows/__tests__/harness-initiative-b41.test.js
rm packages/brain/src/workflows/__tests__/harness-quality-fixes.test.js
rm packages/brain/src/__tests__/harness-initiative-cross-repo-final-evaluate.test.js
rm packages/brain/src/__tests__/harness-initiative-windows-cloud-env.test.js
rm packages/brain/src/__tests__/harness-initiative-create-fix-task.test.js
rm tests/integration/harness-interrupt-resume.test.ts
```

- [ ] **Step 2.2：确认文件已删除**

```bash
ls packages/brain/src/workflows/__tests__/final-evaluate-pr-branch.test.js 2>&1
# Expected: No such file or directory
```

---

### Task 3：部分删除混合测试文件（3个）

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-langgraph-step-events.test.js`
- Modify: `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`

#### 3A: harness-initiative.graph.full.test.js

- [ ] **Step 3A.1：删除 fanoutSubTasksNode describe 块（行 103~124）**

删除从 `describe('fanoutSubTasksNode (router function)', () => {` 到其闭合 `});` 的完整内容。

- [ ] **Step 3A.2：删除 joinSubTasksNode describe 块（行 184~212）**

删除从 `describe('joinSubTasksNode', () => {` 到其闭合 `});` 的完整内容。

- [ ] **Step 3A.3：删除 finalE2eNode describe 块（行 213~252）**

删除从 `describe('finalE2eNode', () => {` 到其闭合 `});` 的完整内容。

- [ ] **Step 3A.4：更新 import，移除不存在的导出**

找到文件顶部的 import 块（行 92-99 左右），删除以下三个名称：
`fanoutSubTasksNode`、`joinSubTasksNode`、`finalE2eNode`

示例：将
```js
  fanoutSubTasksNode,
  joinSubTasksNode,
  finalE2eNode,
```
从 import 里删除。

#### 3B: harness-langgraph-step-events.test.js

- [ ] **Step 3B.1：删除三个 describe 块**

删除：
1. `describe('fanoutPassthroughNode — langgraph_step events (legacy parallel path)', () => {` 到其 `});`（行 66~74）
2. `describe('finalE2eNode — langgraph_step events', () => {` 到其 `});`（行 86~94）
3. `describe('finalEvaluateDispatchNode — langgraph_step events (Mode B, production path)', () => {` 到其 `});`（行 95~103）

删除后文件应保留：`emitLangGraphStep helper`、`runGanLoopNode`、`runSubTaskNode`、`reportNode` 四个 describe 块。

#### 3C: harness-initiative-evaluate.test.js

- [ ] **Step 3C.1：删除 routeAfterEvaluate describe 块（行 228~294）**

删除从注释 `// ─── 3. routeAfterEvaluate — 4 cases` 到 `describe('routeAfterEvaluate', ...)` 闭合 `});` 的完整内容（包含注释行）。

- [ ] **Step 3C.2：删除 finalEvaluateDispatchNode describe 块（行 429~565）**

删除从注释 `// ─── finalEvaluateDispatchNode fix loop delta` 到文件末尾（该 describe 是最后一块）的完整内容。

- [ ] **Step 3C.3：更新 import，移除 routeAfterEvaluate 和 finalEvaluateDispatchNode**

找到文件顶部的 import（行 99~105 左右），删除：
```js
  routeAfterEvaluate,
```
和
```js
  finalEvaluateDispatchNode,
```

---

### Task 4：跑测试验证无 regression

**Files:** 无代码变更，只跑测试

- [ ] **Step 4.1：跑 workflows/__tests__ 测试**

```bash
cd /Users/administrator/worktrees/cecelia/refactor-dead-nodes-0531
npx vitest run packages/brain/src/workflows/__tests__/ 2>&1 | tail -40
```

预期：所有测试 PASS，无引用错误。

- [ ] **Step 4.2：跑 src/__tests__ 测试**

```bash
npx vitest run packages/brain/src/__tests__/ 2>&1 | tail -40
```

预期：所有测试 PASS，无引用错误。

- [ ] **Step 4.3：如有失败，追查并修复**

若报错 `SyntaxError: The requested module ... does not provide an export named 'XXX'`，说明还有引用未清理，找到对应文件删除该 import。

---

### Task 5：写 Learning 文件并提交

**Files:**
- Create: `docs/learnings/cp-0531084301-refactor-dead-nodes-0531.md`

- [ ] **Step 5.1：写 Learning 文件**

内容：

```markdown
# Learning: Initiative Graph 死代码清理

## 根本原因

PR #3188 删除了 `final_evaluate` 节点（单一 evaluator 设计对齐），
但只删除了节点的 graph 连接，没有同步删除底层函数实现和对应测试文件。
导致 7 个函数（~600行）和 10 个测试文件/describe 块成为死代码，
增加阅读负担和误导性文档。

## 下次预防

- [ ] 删除 graph 节点时，同 PR 一并删除底层函数实现（不只删 .addNode()）
- [ ] 测试文件与被测函数生命周期绑定：函数删了，对应测试文件必须同 PR 删
- [ ] PR 描述中明确"已删除以下测试文件"，防止遗漏
```

- [ ] **Step 5.2：提交**

```bash
cd /Users/administrator/worktrees/cecelia/refactor-dead-nodes-0531
git add packages/brain/src/workflows/harness-initiative.graph.js
git add packages/brain/src/workflows/__tests__/
git add packages/brain/src/__tests__/
git add tests/integration/
git add docs/learnings/cp-0531084301-refactor-dead-nodes-0531.md
git commit -m "refactor(harness): 删除 initiative graph 死代码节点

PR #3188 删除 final_evaluate 节点后遗留 7 个孤立函数和对应测试文件。
删除：runInitiative/@deprecated区块/fanoutSubTasksNode/fanoutPassthroughNode/
joinSubTasksNode/finalE2eNode/routeAfterEvaluate/finalEvaluateDispatchNode，
同时删除 7 个专项测试文件，修剪 3 个混合测试文件的死代码 describe 块。"
```
