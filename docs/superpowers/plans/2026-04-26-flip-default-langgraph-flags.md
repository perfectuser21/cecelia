# Flip Default LangGraph Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Brain 派发链路上的 3 个 LangGraph fallback env gate（`WORKFLOW_RUNTIME` / `HARNESS_LANGGRAPH_ENABLED` / `HARNESS_USE_FULL_GRAPH=false`），让 `dev` / `harness_planner` / `harness_initiative` 任务无条件走 LangGraph。

**Architecture:** 只删代码，不加新逻辑。所有 LangGraph 主路径已存在（PR #2640 投产），本 PR 删的是"1 周迁移期兜底"代码，让 graph 成为唯一执行路径。

**Tech Stack:** Node.js / vitest / LangGraph (`@langchain/langgraph`) / Postgres (PgCheckpointer)

---

## File Structure

| 改/删 | 文件 | 用途 |
|---|---|---|
| 修改 | `packages/brain/src/dispatcher.js` | 删 `WORKFLOW_RUNTIME !== 'v2'` 短路（line 514） |
| 修改 | `packages/brain/src/executor.js` | 删 3 处 fallback（harness_initiative useFullGraph 兜底、4 retired type 兜底、harness_planner LangGraph 开关 + `_isLangGraphEnabled` 函数） |
| 修改 | `packages/brain/src/harness-graph-runner.js` | 删 `isLangGraphEnabled()` 函数 + `runHarnessPipeline` 内的 skip 路径 |
| 修改 | `packages/brain/src/harness-final-e2e.js` | 删"保留 1 周兜底"注释（line 151） |
| 修改 | `packages/brain/src/workflows/harness-initiative.graph.js` | 删 line 259/539 的兜底注释 |
| 修改 | `packages/brain/src/orchestrator/README.md` | C7 项标"已完成" |
| 修改 | `packages/brain/src/__tests__/tick-workflow-runtime.test.js` | 翻转旧期望（无 env 也派 v2） |
| 修改 | `packages/brain/src/__tests__/harness-graph.test.js` | 删 skip 用例 + isLangGraphEnabled 用例 |
| 修改 | `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js` | 删前置 `HARNESS_LANGGRAPH_ENABLED=true` 设置 |
| 新建 | `packages/brain/src/__tests__/dispatcher-default-graph.test.js` | 验证无 env 时 dispatcher 派 dev 走 v2 |
| 新建 | `packages/brain/src/__tests__/executor-default-langgraph.test.js` | 验证无 env 时 harness_planner 走 LangGraph Pipeline |
| 新建 | `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js` | 验证无 env 时 harness_initiative 走 full graph |
| 修改 | `packages/brain/package.json` + `package-lock.json` | version 1.223.0 → 1.224.0 |
| 修改 | `.brain-versions` | 同步 |
| 修改 | `DEFINITION.md` | 同步 |
| 新建 | `cp-0426174704-flip-default-langgraph-flags.dod.md` | 至 worktree 根 |
| 新建 | `docs/learnings/cp-0426174704-flip-default-langgraph-flags.md` | Learning 文件 |

---

### Task 1: 新建 dispatcher-default-graph.test.js（RED）

**Files:**
- Create: `packages/brain/src/__tests__/dispatcher-default-graph.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * 验证：无任何 env flag 时，_dispatchViaWorkflowRuntime 派 task_type=dev
 * 任务走 v2 workflow runtime（runWorkflow），不再 fall through 到 legacy。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  runWorkflow: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  recordDispatchResult: vi.fn(),
  emit: vi.fn(),
  logTickDecision: vi.fn(),
};

vi.mock('../orchestrator/graph-runtime.js', () => ({
  runWorkflow: mocks.runWorkflow,
}));
vi.mock('../tick-state.js', () => ({
  recordDispatchResult: mocks.recordDispatchResult,
}));
vi.mock('../event-bus.js', () => ({
  emit: mocks.emit,
}));
vi.mock('../tick-status.js', () => ({
  logTickDecision: mocks.logTickDecision,
}));

describe('dispatcher default LangGraph routing', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.WORKFLOW_RUNTIME;
    delete process.env.WORKFLOW_RUNTIME;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.runWorkflow.mockResolvedValue({ result: { ok: true } });
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WORKFLOW_RUNTIME;
    else process.env.WORKFLOW_RUNTIME = originalEnv;
  });

  it('无 env flag + task_type=dev → runWorkflow 被调（默认 v2）', async () => {
    const { _dispatchViaWorkflowRuntime } = await import('../dispatcher.js');
    const task = { id: 'task-default', task_type: 'dev', title: 'default-route', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(result.runtime).toBe('v2');
    expect(mocks.runWorkflow).toHaveBeenCalledWith('dev-task', 'task-default', 1, { task });
  });

  it('无 env flag + task_type=harness_initiative → handled:false（dispatcher 只接 dev）', async () => {
    const { _dispatchViaWorkflowRuntime } = await import('../dispatcher.js');
    const task = { id: 'task-init', task_type: 'harness_initiative', title: 'init', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/dispatcher-default-graph.test.js`
Expected: 第一个 it 失败 — `expect(result.handled).toBe(true)` 实际为 `false`（因为 dispatcher.js:514 还在拦截）

- [ ] **Step 3: Don't fix yet — Task 2 will**

This test should remain RED until Task 5 deletes line 514. Don't commit yet.

---

### Task 2: 新建 executor-default-langgraph.test.js（RED）

**Files:**
- Create: `packages/brain/src/__tests__/executor-default-langgraph.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * 验证：无任何 env flag 时，executor 派 task_type=harness_planner 任务
 * 走 LangGraph Pipeline（runHarnessPipeline），不再 fall through 到单步 Docker。
 *
 * 注意：本测试只验证路由决策（runHarnessPipeline 被调），不验证 pipeline 内部行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  runHarnessPipeline: vi.fn(),
  getPgCheckpointer: vi.fn(),
};

vi.mock('../harness-graph-runner.js', () => ({
  runHarnessPipeline: mocks.runHarnessPipeline,
}));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: mocks.getPgCheckpointer,
}));

describe('executor default LangGraph for harness_planner', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.HARNESS_LANGGRAPH_ENABLED;
    delete process.env.HARNESS_LANGGRAPH_ENABLED;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.runHarnessPipeline.mockResolvedValue({ skipped: false, steps: 7, finalState: { ok: true } });
    mocks.getPgCheckpointer.mockResolvedValue({ /* fake */ });
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HARNESS_LANGGRAPH_ENABLED;
    else process.env.HARNESS_LANGGRAPH_ENABLED = originalEnv;
  });

  it('无 env flag + task_type=harness_planner → runHarnessPipeline 被调（默认走 LangGraph）', async () => {
    // 由于 executor.js 是大文件，直接 import 整个模块依赖较重；
    // 改用读源码做静态断言：harness_planner 路由决策不再依赖 _isLangGraphEnabled
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');
    // 删除后：line 2899 不应再有 _isLangGraphEnabled() 同行调用
    const harnessPlannerLine = src.match(/task\.task_type\s*===\s*['"]harness_planner['"][^\n]*/);
    expect(harnessPlannerLine, 'harness_planner 路由判断行存在').not.toBeNull();
    expect(harnessPlannerLine[0]).not.toMatch(/_isLangGraphEnabled/);
  });

  it('executor.js 不再 export 或定义 _isLangGraphEnabled', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/function\s+_isLangGraphEnabled/);
    expect(src).not.toMatch(/HARNESS_LANGGRAPH_ENABLED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/executor-default-langgraph.test.js`
Expected: 两个 it 都失败（`_isLangGraphEnabled` 还在 + line 2899 还有这个条件）

---

### Task 3: 新建 executor-harness-initiative-default-fullgraph.test.js（RED）

**Files:**
- Create: `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * 验证：executor.js 不再有 HARNESS_USE_FULL_GRAPH env 检查 — harness_initiative 永远走 full graph。
 * 静态断言代码形状（不实际跑 executor，避免 LangGraph compile 副作用）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js harness_initiative full graph default', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  it('源码中不存在 HARNESS_USE_FULL_GRAPH 引用', () => {
    expect(SRC).not.toMatch(/HARNESS_USE_FULL_GRAPH/);
  });

  it('源码中不存在 HARNESS_INITIATIVE_RUNTIME 引用（fallback runner 已删）', () => {
    expect(SRC).not.toMatch(/HARNESS_INITIATIVE_RUNTIME/);
  });

  it('源码中不再 import harness-initiative-runner.js（runInitiative 兜底已删）', () => {
    // import 语句在文件顶部静态写法，dynamic import 在 fallback 分支
    expect(SRC).not.toMatch(/from\s+['"]\.\/harness-initiative-runner\.js['"]/);
    expect(SRC).not.toMatch(/import\(['"]\.\/harness-initiative-runner\.js['"]\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/executor-harness-initiative-default-fullgraph.test.js`
Expected: 三个 it 都失败（这三个引用都还在 executor.js 中）

---

### Task 4: 更新旧测试 — tick-workflow-runtime.test.js + harness-graph.test.js + harness-graph-runner-default-executor.test.js

**Files:**
- Modify: `packages/brain/src/__tests__/tick-workflow-runtime.test.js`
- Modify: `packages/brain/src/__tests__/harness-graph.test.js`
- Modify: `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js`

- [ ] **Step 1: Update tick-workflow-runtime.test.js — flip expectations**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/__tests__/tick-workflow-runtime.test.js`，把以下两个用例改造（不删，改 expect）：

把这段：
```javascript
  it('env 未设 + task_type=dev → legacy triggerCeceliaRun 被调', async () => {
    delete process.env.WORKFLOW_RUNTIME;
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-aaa', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('env=v1 + task_type=dev → legacy 被调（显式 v1）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v1';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-bbb', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });
```

改为：
```javascript
  it('env 未设 + task_type=dev → 默认走 v2 runWorkflow（flag flipped）', async () => {
    delete process.env.WORKFLOW_RUNTIME;
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-aaa', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(result.runtime).toBe('v2');
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflow).toHaveBeenCalledWith('dev-task', 'task-aaa', 1, { task });
  });

  it('env=v1 + task_type=dev → 仍走 v2（env 已不影响默认）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v1';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-bbb', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
  });
```

注意 `import('../tick.js')` 路径不变（即使实际函数在 dispatcher.js，老测试文件 import path 指 tick.js，这是因为旧的 _dispatchViaWorkflowRuntime 可能从 tick.js re-export — 跑测试时若 import 失败再调整路径到 `'../dispatcher.js'`）。

- [ ] **Step 2: Update harness-graph.test.js — 删两个用例**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/__tests__/harness-graph.test.js`，删除以下两个用例（line 121-124 + line 155-166）：

删除：
```javascript
  it('returns { skipped: true } when HARNESS_LANGGRAPH_ENABLED is not set', async () => {
    const r = await runHarnessPipeline({ id: 'task-1', description: 'demo' });
    expect(r.skipped).toBe(true);
  });
```

删除：
```javascript
  it('isLangGraphEnabled handles common falsy values', () => {
    delete process.env.HARNESS_LANGGRAPH_ENABLED;
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = '0';
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = 'false';
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
    expect(isLangGraphEnabled()).toBe(true);
    process.env.HARNESS_LANGGRAPH_ENABLED = '1';
    expect(isLangGraphEnabled()).toBe(true);
  });
```

同时清理 `import { ... isLangGraphEnabled ... } from '../harness-graph-runner.js'`（如有 import），删 `process.env.HARNESS_LANGGRAPH_ENABLED = 'true'` 这种前置设置，删 `ORIGINAL_ENV` 备份/恢复逻辑。

第二个用例（"runs the pipeline when HARNESS_LANGGRAPH_ENABLED=true"）改为 "runs the pipeline by default (no env required)"，删开头的 `process.env.HARNESS_LANGGRAPH_ENABLED = 'true';` 一行；third 用例（"throws when task.id missing"）同样删 `process.env.HARNESS_LANGGRAPH_ENABLED = 'true';`。

- [ ] **Step 3: Update harness-graph-runner-default-executor.test.js**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js`，删除：
```javascript
  process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
```
以及 afterEach 中的 `delete process.env.HARNESS_LANGGRAPH_ENABLED;`。

- [ ] **Step 4: Don't run yet — implementation will follow**

跑测试还会失败（因为代码还没改），continue to Task 5+.

---

### Task 5: 实现 dispatcher.js — 删 WORKFLOW_RUNTIME 检查

**Files:**
- Modify: `packages/brain/src/dispatcher.js:513-554`

- [ ] **Step 1: Edit dispatcher.js**

Use Edit tool to replace this:
```javascript
export async function _dispatchViaWorkflowRuntime(taskToDispatch) {
  if (process.env.WORKFLOW_RUNTIME !== 'v2') return { handled: false };
  if (taskToDispatch?.task_type !== 'dev') return { handled: false };
```

With:
```javascript
export async function _dispatchViaWorkflowRuntime(taskToDispatch) {
  if (taskToDispatch?.task_type !== 'dev') return { handled: false };
```

(只删 line 514 的 env 检查 一行)

- [ ] **Step 2: Update inline comment block above (line 503-512)**

把：
```javascript
/**
 * C6: WORKFLOW_RUNTIME=v2 + task_type=dev 时，通过 L2 orchestrator runWorkflow('dev-task')
 * 派发 fire-and-forget；否则返回 {handled:false} 让 caller fall through 到 legacy
 * triggerCeceliaRun 路径。
 *
 * 默认（env 未设 / v1）返回 handled:false，生产零行为变化。
 *
 * @param {object} taskToDispatch Brain task row（含 id / task_type / retry_count 等）
 * @returns {Promise<{handled:boolean, runtime?:string, task_id?:string, actions?:Array}>}
 */
```
改为：
```javascript
/**
 * task_type=dev 任务一律走 L2 orchestrator runWorkflow('dev-task')，
 * fire-and-forget 派发。其他 task_type 返回 {handled:false} 让 caller fall through。
 *
 * @param {object} taskToDispatch Brain task row（含 id / task_type / retry_count 等）
 * @returns {Promise<{handled:boolean, runtime?:string, task_id?:string, actions?:Array}>}
 */
```

- [ ] **Step 3: 同时清理 file-top comment line 5 的 C6 引用**

把 `// — C6 加的 WORKFLOW_RUNTIME=v2 灰度入口），瘦身抽出独立模块。` 改成 `// — dev 任务走 L2 workflow runtime），瘦身抽出独立模块。`

- [ ] **Step 4: 验证修改**

Run: `grep -n WORKFLOW_RUNTIME /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/dispatcher.js`
Expected: empty

- [ ] **Step 5: 跑 Task 1 + 老 tick-workflow-runtime 测试**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/dispatcher-default-graph.test.js src/__tests__/tick-workflow-runtime.test.js`
Expected: 全 PASS

---

### Task 6: 实现 harness-graph-runner.js — 删 isLangGraphEnabled

**Files:**
- Modify: `packages/brain/src/harness-graph-runner.js:1-50`

- [ ] **Step 1: Delete isLangGraphEnabled function (line 20-29)**

Use Edit tool to delete:
```javascript
/**
 * 是否启用 LangGraph 路径。
 * 默认 false：未设置/空字符串/'false'/'0' 都视为关闭。
 */
export function isLangGraphEnabled() {
  const v = process.env.HARNESS_LANGGRAPH_ENABLED;
  if (!v) return false;
  const normalized = String(v).trim().toLowerCase();
  return !(normalized === '' || normalized === 'false' || normalized === '0');
}

```

- [ ] **Step 2: Delete the skip path inside runHarnessPipeline (line 44-47)**

把：
```javascript
export async function runHarnessPipeline(task, opts = {}) {
  if (!isLangGraphEnabled()) {
    return { skipped: true, reason: 'HARNESS_LANGGRAPH_ENABLED not set' };
  }
  if (!task || !task.id) {
```
改为：
```javascript
export async function runHarnessPipeline(task, opts = {}) {
  if (!task || !task.id) {
```

- [ ] **Step 3: Update file-header comment (line 7)**

把 `*   3. \`HARNESS_LANGGRAPH_ENABLED\` 未设置时直接 no-op，保持老路径（routes/execution.js）兜底` 整行删除（同时调整后续编号 4→3）。

- [ ] **Step 4: 验证**

Run: `grep -n -E "isLangGraphEnabled|HARNESS_LANGGRAPH_ENABLED" /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/harness-graph-runner.js`
Expected: empty

- [ ] **Step 5: 跑 Task 4 改的 harness-graph 测试**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/harness-graph.test.js src/__tests__/harness-graph-runner-default-executor.test.js`
Expected: 全 PASS

---

### Task 7: 实现 executor.js — 删 _isLangGraphEnabled + harness_planner gate

**Files:**
- Modify: `packages/brain/src/executor.js:2168-2180, 2899-2900`

- [ ] **Step 1: Delete _isLangGraphEnabled function (line 2168-2180 范围内)**

Use Edit tool to delete (含上面注释整段):
```javascript

// ─── preparePrompt 辅助：条件判断 + 路由内联 lambda 拆分 ────────────────────

/**
 * HARNESS_LANGGRAPH_ENABLED 环境变量检测（executor 内部用）。
 * 与 harness-graph-runner.js 中的 isLangGraphEnabled 逻辑一致。
 */
function _isLangGraphEnabled() {
  const v = process.env.HARNESS_LANGGRAPH_ENABLED;
  if (!v) return false;
  const normalized = String(v).trim().toLowerCase();
  return !(normalized === '' || normalized === 'false' || normalized === '0');
}
```

但保留 `// ─── preparePrompt 辅助：条件判断 + 路由内联 lambda 拆分 ────────────────────` section 标题行（如它对其他函数仍是分隔符）。

- [ ] **Step 2: Delete the LangGraph gate at line 2899**

把：
```javascript
  if (task.task_type === 'harness_planner' && _isLangGraphEnabled()) {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → LangGraph Pipeline (HARNESS_LANGGRAPH_ENABLED=true)`);
```
改为：
```javascript
  if (task.task_type === 'harness_planner') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → LangGraph Pipeline (default)`);
```

- [ ] **Step 3: Update the comment block above (line 2894-2898)**

把：
```javascript
  // 2.9 LangGraph Pipeline（HARNESS_LANGGRAPH_ENABLED=true + harness_planner）
  // 当启用 LangGraph 时，harness_planner 任务不走单步 Docker 执行，
  // 而是由 LangGraph 编排完整 6 步 pipeline（planner→proposer→reviewer→generator→evaluator→report）。
  // LangGraph runner 内部为每个节点调 spawn()（Brain v2 Layer 3 唯一对外 API）。
  // ⚠️ v1 路径保留（向后兼容老数据），新 Initiative 走上面的 harness_initiative 分支。
```
改为：
```javascript
  // 2.9 LangGraph Pipeline（harness_planner 默认走 LangGraph）
  // harness_planner 任务由 LangGraph 编排完整 6 步 pipeline
  // （planner→proposer→reviewer→generator→evaluator→report）。
  // LangGraph runner 内部为每个节点调 spawn()（Brain v2 Layer 3 唯一对外 API）。
```

- [ ] **Step 4: 验证 + 跑 Task 2 测试**

Run: `grep -n -E "HARNESS_LANGGRAPH_ENABLED|_isLangGraphEnabled" /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/executor.js`
Expected: empty

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/executor-default-langgraph.test.js`
Expected: 全 PASS

---

### Task 8: 实现 executor.js — 删 harness_initiative useFullGraph fallback

**Files:**
- Modify: `packages/brain/src/executor.js:2796-2855`

- [ ] **Step 1: Edit harness_initiative routing — 删 useFullGraph wrapping 和 else 分支**

Use Edit tool. 把：
```javascript
  // 2.85 Harness Full Graph (Phase A+B+C) — Sprint 1 一个 graph 跑到底。
  // env flag HARNESS_USE_FULL_GRAPH=false 走老路（迁移期保留 1 周）。
  if (task.task_type === 'harness_initiative') {
    const useFullGraph = process.env.HARNESS_USE_FULL_GRAPH !== 'false';
    if (useFullGraph) {
      console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (Sprint 1, A+B+C)`);
      try {
        const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
        const compiled = await compileHarnessFullGraph();
        const initiativeId = task.payload?.initiative_id || task.id;
        const final = await compiled.invoke(
          { task },
          { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
        );
        return {
          success: !final.error,
          taskId: task.id,
          initiative: true,
          fullGraph: true,
          finalState: {
            // 只回 summary 防 task.result 列爆炸
            initiativeId: final.initiativeId,
            sub_tasks: final.sub_tasks,
            final_e2e_verdict: final.final_e2e_verdict,
            error: final.error,
          },
        };
      } catch (err) {
        console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
        return { success: false, taskId: task.id, initiative: true, error: err.message };
      }
    }
    // ── 老路（HARNESS_USE_FULL_GRAPH=false 时迁移期兜底） ────────────
    if (process.env.HARNESS_INITIATIVE_RUNTIME === 'v2') {
      console.log(`[executor] 路由决策: task_type=${task.task_type} → v2 graph runWorkflow (legacy C8a)`);
      try {
        const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
        return await runWorkflow('harness-initiative', task.id, 1, { task });
      } catch (err) {
        console.error(`[executor] v2 graph runWorkflow error task=${task.id}: ${err.message}`);
        return { success: false, taskId: task.id, initiative: true, error: err.message };
      }
    }
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness v2 Initiative Runner (legacy procedural)`);
    let checkpointer;
    try {
      const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
      checkpointer = await getPgCheckpointer();
    } catch (cpErr) {
      console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver: ${cpErr.message}`);
      checkpointer = undefined;
    }
    try {
      const { runInitiative } = await import('./harness-initiative-runner.js');
      return await runInitiative(task, { checkpointer });
    } catch (err) {
      console.error(`[executor] Initiative Runner error task=${task.id}: ${err.message}`);
      return { success: false, taskId: task.id, initiative: true, error: err.message };
    }
  }
```

改为：
```javascript
  // 2.85 Harness Full Graph (Phase A+B+C) — 一个 graph 跑到底，默认路径。
  if (task.task_type === 'harness_initiative') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
    try {
      const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
      const compiled = await compileHarnessFullGraph();
      const initiativeId = task.payload?.initiative_id || task.id;
      const final = await compiled.invoke(
        { task },
        { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
      );
      return {
        success: !final.error,
        taskId: task.id,
        initiative: true,
        fullGraph: true,
        finalState: {
          // 只回 summary 防 task.result 列爆炸
          initiativeId: final.initiativeId,
          sub_tasks: final.sub_tasks,
          final_e2e_verdict: final.final_e2e_verdict,
          error: final.error,
        },
      };
    } catch (err) {
      console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
      return { success: false, taskId: task.id, initiative: true, error: err.message };
    }
  }
```

- [ ] **Step 2: 验证**

Run: `grep -n -E "HARNESS_USE_FULL_GRAPH|HARNESS_INITIATIVE_RUNTIME|harness-initiative-runner" /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/executor.js`
Expected: 仅剩 retired type 兜底块里的 `HARNESS_USE_FULL_GRAPH` （Task 9 删）；其他全消失

---

### Task 9: 实现 executor.js — 删 retired type fallback

**Files:**
- Modify: `packages/brain/src/executor.js:2857-2891`

- [ ] **Step 1: Edit retired task_type fallback**

Use Edit tool. 把：
```javascript
  // Sprint 1: 4 retired task_types (harness_task / harness_ci_watch / harness_fix /
  // harness_final_e2e) 已被 harness_initiative full-graph sub-graph 取代。
  // 老数据派到 executor → 标 terminal failure 防止"复活"。
  // HARNESS_USE_FULL_GRAPH=false 时仍可走老路兜底。
  const _RETIRED_HARNESS_TYPES = new Set([
    'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
  ]);
  if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {
    if (process.env.HARNESS_USE_FULL_GRAPH === 'false') {
      // 兜底：迁移期仍走老路（仅 harness_task 真要派；其余由 tick worker / runPhaseCIfReady 自管）
      if (task.task_type === 'harness_task') {
        try {
          const { triggerHarnessTaskDispatch } = await import('./harness-task-dispatch.js');
          return await triggerHarnessTaskDispatch(task);
        } catch (err) {
          console.error(`[executor] harness_task dispatch failed task=${task.id}: ${err.message}`);
          return { success: false, error: err.message };
        }
      }
      console.log(`[executor] task_type=${task.task_type} (legacy mode) → tick worker handles it`);
      return { success: true, deferred: true };
    }
    console.warn(`[executor] retired task_type=${task.task_type} task=${task.id} → marking pipeline_terminal_failure`);
```

改为：
```javascript
  // Sprint 1: 4 retired task_types (harness_task / harness_ci_watch / harness_fix /
  // harness_final_e2e) 已被 harness_initiative full-graph sub-graph 取代。
  // 老数据派到 executor → 标 terminal failure 防止"复活"。
  const _RETIRED_HARNESS_TYPES = new Set([
    'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
  ]);
  if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {
    console.warn(`[executor] retired task_type=${task.task_type} task=${task.id} → marking pipeline_terminal_failure`);
```

- [ ] **Step 2: 验证**

Run: `grep -n HARNESS_USE_FULL_GRAPH /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/executor.js`
Expected: empty

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run src/__tests__/executor-harness-initiative-default-fullgraph.test.js`
Expected: 全 PASS

---

### Task 10: 注释清理 — harness-final-e2e.js + workflows + README

**Files:**
- Modify: `packages/brain/src/harness-final-e2e.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Modify: `packages/brain/src/orchestrator/README.md`

- [ ] **Step 1: Clean harness-final-e2e.js**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/harness-final-e2e.js` line 145-160 附近，删除 line 151 附近的"保留 1 周作 HARNESS_USE_FULL_GRAPH=false 兜底；下一个 PR 删。"整段注释。

- [ ] **Step 2: Clean harness-initiative.graph.js**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/workflows/harness-initiative.graph.js` line 255-265 附近，删除 line 259 的"保留 1 周作 HARNESS_USE_FULL_GRAPH=false 兜底；下一个 PR 删。"。

读 line 535-545 附近，删除 line 539 的 "与上方 legacy `runInitiative` 528 行并存。executor.js 通过 HARNESS_INITIATIVE_RUNTIME=v2" 这种 legacy 引用注释段落。

- [ ] **Step 3: Mark C7 done in orchestrator/README.md**

读 `/Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain/src/orchestrator/README.md` line 30-40 附近。

把：
```
| C7 | 清老 runner + 清 WORKFLOW_RUNTIME flag |
```
改为：
```
| C7 | 清老 runner + 清 WORKFLOW_RUNTIME flag | ✅ 完成（PR flip-default-langgraph-flags） |
```

或如果该表已有"状态"列，直接打勾。如表结构不一致按原表格习惯添加。

- [ ] **Step 4: 验证全 grep**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && grep -rn -E "HARNESS_USE_FULL_GRAPH|HARNESS_LANGGRAPH_ENABLED|HARNESS_INITIATIVE_RUNTIME" packages/brain/src --include='*.js' | grep -v __tests__`
Expected: 0 行（test 文件除外）

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && grep -rn "WORKFLOW_RUNTIME" packages/brain/src --include='*.js' | grep -v __tests__`
Expected: 0 行

---

### Task 11: 跑 brain 全部单测验证 GREEN

**Files:**
- 无修改

- [ ] **Step 1: Run full brain test suite**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npx vitest run --reporter=basic 2>&1 | tail -50`
Expected: 全 PASS（如有 fail，逐一修；不允许 skip 任何 test）

- [ ] **Step 2: Run brain lint**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags/packages/brain && npm run lint 2>&1 | tail -20`
Expected: 0 error

- [ ] **Step 3: Brain syntax smoke (per memory feedback_brain_deploy_syntax_smoke.md)**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && node --check packages/brain/server.js && node --check packages/brain/src/dispatcher.js && node --check packages/brain/src/executor.js && node --check packages/brain/src/harness-graph-runner.js`
Expected: 4 文件均无 SyntaxError

---

### Task 12: Brain 版本 bump + per-branch DoD + Learning

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Create: `cp-0426174704-flip-default-langgraph-flags.dod.md`
- Create: `docs/learnings/cp-0426174704-flip-default-langgraph-flags.md`

- [ ] **Step 1: Bump brain version 1.223.0 → 1.224.0**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && bash scripts/bump-brain-version.sh patch 2>&1 | tail` （如脚本存在）

如无脚本，手动改：
- `packages/brain/package.json`: `"version": "1.223.0"` → `"version": "1.224.0"`
- `packages/brain/package-lock.json`: 同步两处 `"version": "1.223.0"` → `"version": "1.224.0"`（顶部 + packages."" 段）
- `.brain-versions`: `1.223.0` → `1.224.0`
- `DEFINITION.md`: 找 brain 版本字段，改为 1.224.0

验证：
Run: `cat .brain-versions && grep version packages/brain/package.json`
Expected: 都是 1.224.0

- [ ] **Step 2: Write per-branch DoD file**

Create file `cp-0426174704-flip-default-langgraph-flags.dod.md` at worktree root：

```markdown
# DoD: flip default LangGraph flags + 删 fallback gate

- [x] [BEHAVIOR] dispatcher.js: 无 env flag 时 dev 任务走 v2 workflow runtime
  Test: packages/brain/src/__tests__/dispatcher-default-graph.test.js

- [x] [BEHAVIOR] executor.js: 无 env flag 时 harness_planner 走 LangGraph Pipeline
  Test: packages/brain/src/__tests__/executor-default-langgraph.test.js

- [x] [BEHAVIOR] executor.js: 无 env flag 时 harness_initiative 走 full graph
  Test: packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js

- [x] [ARTIFACT] dispatcher.js 不再含 WORKFLOW_RUNTIME 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(c.includes('WORKFLOW_RUNTIME'))process.exit(1)"

- [x] [ARTIFACT] executor.js 不再含 HARNESS_LANGGRAPH_ENABLED 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_LANGGRAPH_ENABLED'))process.exit(1)"

- [x] [ARTIFACT] executor.js 不再含 HARNESS_USE_FULL_GRAPH 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_USE_FULL_GRAPH'))process.exit(1)"

- [x] [ARTIFACT] harness-graph-runner.js 不再含 isLangGraphEnabled
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(c.includes('isLangGraphEnabled'))process.exit(1)"
```

注意：所有条目首次 push 前必须 `[x]`（per Memory `dod-writing-three-essentials`）。

- [ ] **Step 3: Write Learning file**

Create `docs/learnings/cp-0426174704-flip-default-langgraph-flags.md`：

```markdown
# Learning: flip default LangGraph flags + 删 fallback gate

## 上下文
PR #2640 投产 full graph 默认行为，但保留了 `HARNESS_LANGGRAPH_ENABLED` / `HARNESS_USE_FULL_GRAPH=false` / `WORKFLOW_RUNTIME` 三个 env fallback gate 作为"1 周迁移期兜底"。本 PR 删除这些 gate，让 LangGraph 成为 dev/harness_planner/harness_initiative 唯一执行路径。

## 根本原因
- Phase B/C 重构时为了平滑过渡，故意保留 fallback。代码注释里写明"下一个 PR 删"，但没人接手。
- 用户视角：派发 dev/harness_planner 任务时，因 env 默认未设，看到任务走 procedural 老路而不是 LangGraph，误以为 graph 集成"跑着跑着不工作了"。

## 下次预防
- [ ] 任何"保留 N 天兜底"代码必须在合并 PR 时同时注册一个清理 task 到 Brain（避免遗忘）
- [ ] env-gate 默认值翻转后，应该立即在下一个 patch PR 删除 env 检查代码（保留 env 名作为 escape hatch 反而让现状更难懂）
- [ ] 任务调度链路（dispatcher / executor）的"路由决策"代码应集中在一个文件而非散落在多处 if-else，便于审查
```

- [ ] **Step 4: Verify all files exist**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && ls -la cp-0426174704-flip-default-langgraph-flags.dod.md docs/learnings/cp-0426174704-flip-default-langgraph-flags.md packages/brain/package.json .brain-versions DEFINITION.md`
Expected: 都存在

---

### Task 13: 一次性 commit 所有改动 + push

**Files:**
- 全部已修改文件

- [ ] **Step 1: Stage all changes**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && git add \
  packages/brain/src/dispatcher.js \
  packages/brain/src/executor.js \
  packages/brain/src/harness-graph-runner.js \
  packages/brain/src/harness-final-e2e.js \
  packages/brain/src/workflows/harness-initiative.graph.js \
  packages/brain/src/orchestrator/README.md \
  packages/brain/src/__tests__/tick-workflow-runtime.test.js \
  packages/brain/src/__tests__/harness-graph.test.js \
  packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js \
  packages/brain/src/__tests__/dispatcher-default-graph.test.js \
  packages/brain/src/__tests__/executor-default-langgraph.test.js \
  packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js \
  packages/brain/package.json \
  packages/brain/package-lock.json \
  .brain-versions DEFINITION.md \
  cp-0426174704-flip-default-langgraph-flags.dod.md \
  docs/learnings/cp-0426174704-flip-default-langgraph-flags.md
```

- [ ] **Step 2: Verify staged**

Run: `cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && git diff --cached --stat`
Expected: 17 个文件

- [ ] **Step 3: Commit (per Memory: pass message via HEREDOC, include Co-Authored-By)**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/flip-default-langgraph-flags && git commit -m "$(cat <<'EOF'
feat(brain): flip default LangGraph + 删 3 个 fallback env gate

接续 #2640 投产 full graph 默认行为后，删除剩余 env fallback gate：
- dispatcher.js: 删 WORKFLOW_RUNTIME !== 'v2' 短路
- executor.js: 删 HARNESS_USE_FULL_GRAPH=false 兜底（harness_initiative + 4 retired type）
- executor.js: 删 _isLangGraphEnabled() + harness_planner 上的 LangGraph gate
- harness-graph-runner.js: 删 isLangGraphEnabled() + skip 路径

dev / harness_planner / harness_initiative 现在无条件走 LangGraph，
graph 是唯一执行路径，老 procedural fallback 全清。

Brain 1.223.0 → 1.224.0
Brain Task: a2acd254-cd84-4262-8f6f-1bffb0574572

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage
- ✅ Unit A (dispatcher.js WORKFLOW_RUNTIME) → Task 5
- ✅ Unit B (executor.js harness_initiative useFullGraph) → Task 8
- ✅ Unit C (executor.js retired type fallback) → Task 9
- ✅ Unit D (executor.js _isLangGraphEnabled + harness_planner gate) → Task 7
- ✅ harness-graph-runner.js cleanup → Task 6
- ✅ 3 new tests → Task 1/2/3
- ✅ 3 old tests update → Task 4
- ✅ Comment cleanup → Task 10
- ✅ Test green验证 → Task 11
- ✅ Version bump + DoD + Learning → Task 12
- ✅ Commit → Task 13

### Placeholder scan
- 无 TBD/TODO
- 所有代码块给完整 before/after
- 所有命令行 + 期望 output 都明确

### Type consistency
- `_dispatchViaWorkflowRuntime` 名字全文一致
- `runHarnessPipeline` / `compileHarnessFullGraph` / `runWorkflow` 名字一致
- env name `WORKFLOW_RUNTIME` / `HARNESS_LANGGRAPH_ENABLED` / `HARNESS_USE_FULL_GRAPH` 一致

Plan complete.
