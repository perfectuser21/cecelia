# H8 evaluator worktree switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: 把 evaluateSubTaskNode 传给 evaluator executor 的 worktreePath 从 initiative 主 worktree 切到 generator 干活的 sub-task worktree（`<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>`），SSOT 抽到 `harnessTaskWorktreePath()` helper。

**Architecture**:
1. `harness-worktree.js`：export `DEFAULT_BASE_REPO` + 新增 export `harnessTaskWorktreePath(taskId, opts)`，`ensureHarnessWorktree` 内部 `wtPath` 计算改用此 helper（消除两处重复 path.join）。
2. `harness-initiative.graph.js` import `harnessTaskWorktreePath`，`evaluateSubTaskNode` 计算 `taskWorktreePath = harnessTaskWorktreePath(state.task.id)`，传给 executor 替代 `state.worktreePath`。

**Tech Stack**: Node.js / vitest / LangGraph

**Spec**: `docs/superpowers/specs/2026-05-09-h8-evaluator-worktree-switch-design.md`

**Brain task**: e11351fa-6566-40b6-99a7-460b217fbe1b

---

## File Structure

- **Create**: `cp-0509144710-h8-evaluator-worktree-switch.prd.md`
- **Create**: `cp-0509144710-h8-evaluator-worktree-switch.dod.md`
- **Create**: `tests/brain/h8-evaluator-worktree.test.js`
- **Modify**: `packages/brain/src/harness-worktree.js`（line 9 加 export + 新增 helper + line 62 改用 helper）
- **Modify**: `packages/brain/src/workflows/harness-initiative.graph.js`（line 33 import 加 helper + evaluateSubTaskNode 计算 + line 1170 替换）
- **Create**: `docs/learnings/cp-0509144710-h8-evaluator-worktree-switch.md`

---

### Task 1: PRD + DoD（commit 1）

**Files**:
- Create: `cp-0509144710-h8-evaluator-worktree-switch.prd.md`
- Create: `cp-0509144710-h8-evaluator-worktree-switch.dod.md`

- [ ] **Step 1.1**：写 PRD（worktree 根目录）

完整内容（直接 Write）：

```markdown
# PRD: H8 evaluator 切到 generator 的 task worktree

**Brain task**: e11351fa-6566-40b6-99a7-460b217fbe1b
**Spec**: docs/superpowers/specs/2026-05-09-h8-evaluator-worktree-switch-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

PR #2851 让 sub-graph 自己 ensureHarnessWorktree → generator 在 `<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>/` 干活。但 evaluateSubTaskNode (harness-initiative.graph.js:1170) 传给 executor 的 worktreePath 仍是 state.worktreePath（initiative 主 worktree） → evaluator 容器看不到 generator commit 的产物 → v9 跑里 evaluate 4 次 FAIL 都报"acceptance-task-payload.json 不存在"。

## 修法

1. harness-worktree.js：export DEFAULT_BASE_REPO + 新增 export harnessTaskWorktreePath(taskId, opts={})，ensureHarnessWorktree 内部改用此 helper（SSOT）
2. harness-initiative.graph.js：import harnessTaskWorktreePath；evaluateSubTaskNode 内 taskWorktreePath = harnessTaskWorktreePath(state.task.id)；传给 executor 的 worktreePath 改成 taskWorktreePath

## 成功标准

- evaluator 容器 mount 的 worktree = generator 干活的 task-<shortTaskId> 目录
- evaluate verdict 不再因 acceptance-task-payload.json 缺失恒报 FAIL
- 幂等门保留（state.evaluate_verdict 非空 short-circuit）

## 不做

- 不动 generator/proposer 节点 worktree（已对）
- 不动 ensureHarnessWorktree self-heal 逻辑
- 不引入 push creds / 不重设计 callback router
- 不做 H7/H9/proposer verify push（独立 PR）
```

- [ ] **Step 1.2**：写 DoD

```markdown
# DoD: H8 evaluator 切到 generator 的 task worktree

## 验收清单

- [ ] [BEHAVIOR] harnessTaskWorktreePath(taskId) 返回 <baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId> 路径
  Test: tests/brain/h8-evaluator-worktree.test.js

- [ ] [BEHAVIOR] evaluateSubTaskNode 传给 executor 的 worktreePath = harnessTaskWorktreePath(state.task.id)，不再是 state.worktreePath
  Test: tests/brain/h8-evaluator-worktree.test.js

- [ ] [BEHAVIOR] evaluateSubTaskNode 幂等门保留（state.evaluate_verdict 非空时直接 return，不调 executor）
  Test: tests/brain/h8-evaluator-worktree.test.js

- [ ] [ARTIFACT] harness-worktree.js 含 export function harnessTaskWorktreePath + export const DEFAULT_BASE_REPO
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/export function harnessTaskWorktreePath/.test(c))process.exit(1);if(!/export const DEFAULT_BASE_REPO/.test(c))process.exit(1)"

- [ ] [ARTIFACT] evaluateSubTaskNode 函数体含 harnessTaskWorktreePath 调用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function evaluateSubTaskNode[\s\S]+?\n\}/);if(!m||!m[0].includes('harnessTaskWorktreePath'))process.exit(1)"

## Learning

文件: docs/learnings/cp-0509144710-h8-evaluator-worktree-switch.md

## 测试命令

​```bash
npx vitest run tests/brain/h8-evaluator-worktree.test.js
​```
```

- [ ] **Step 1.3**：commit

```bash
cd /Users/administrator/worktrees/cecelia/h8-evaluator-worktree-switch
git add cp-0509144710-h8-evaluator-worktree-switch.prd.md cp-0509144710-h8-evaluator-worktree-switch.dod.md
git commit -m "docs: H8 evaluator worktree switch PRD + DoD"
```

---

### Task 2: Failing vitest unit test（commit 2，TDD red）

**Files**:
- Create: `tests/brain/h8-evaluator-worktree.test.js`

- [ ] **Step 2.1**：写测试

`tests/brain/h8-evaluator-worktree.test.js` 完整内容：

```javascript
// SPDX-License-Identifier: MIT
// Test for H8: evaluateSubTaskNode worktreePath 切到 generator 的 sub-task worktree。
// 修复 PR #2851 后引入的 worktree 不一致 BUG（initiative 主 worktree 跟 sub-task 不是同一个目录）。

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import {
  harnessTaskWorktreePath,
  DEFAULT_BASE_REPO,
} from '../../packages/brain/src/harness-worktree.js';
import { shortTaskId } from '../../packages/brain/src/harness-utils.js';
import { evaluateSubTaskNode } from '../../packages/brain/src/workflows/harness-initiative.graph.js';

describe('H8 — harnessTaskWorktreePath helper', () => {
  test('返回 <baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>', () => {
    const taskId = '485f6817-20d0-427e-9096-0fe0a4c5cc02';
    const expected = path.join(
      DEFAULT_BASE_REPO,
      '.claude',
      'worktrees',
      'harness-v2',
      `task-${shortTaskId(taskId)}`,
    );
    expect(harnessTaskWorktreePath(taskId)).toBe(expected);
  });

  test('opts.baseRepo override 生效', () => {
    const taskId = 'aaaa-bbbb-cccc';
    const custom = '/tmp/custom-base';
    const got = harnessTaskWorktreePath(taskId, { baseRepo: custom });
    expect(got.startsWith(custom)).toBe(true);
    expect(got.endsWith(`task-${shortTaskId(taskId)}`)).toBe(true);
  });
});

describe('H8 — evaluateSubTaskNode worktreePath 切到 sub-task worktree', () => {
  function makeSpyExecutor() {
    const calls = [];
    const spy = async (opts) => {
      calls.push(opts);
      return { exit_code: 0, stdout: '{"verdict":"PASS","feedback":null}', stderr: '', timed_out: false };
    };
    spy.calls = calls;
    return spy;
  }

  test('worktreePath 传给 executor 的值 = harnessTaskWorktreePath(state.task.id)，不是 state.worktreePath', async () => {
    const spy = makeSpyExecutor();
    const state = {
      task: { id: 'task-h8-test-uuid', payload: { sprint_dir: 'sprints/test' } },
      worktreePath: '/initiative/main/path',  // 主 worktree（不该被传）
      task_loop_index: 0,
      taskPlan: { journey_type: 'autonomous' },
      githubToken: 'ghs_test',
      evaluate_verdict: null,
    };
    await evaluateSubTaskNode(state, { executor: spy });
    expect(spy.calls.length).toBe(1);
    const passedWtPath = spy.calls[0].worktreePath;
    expect(passedWtPath).toBe(harnessTaskWorktreePath('task-h8-test-uuid'));
    expect(passedWtPath).not.toBe('/initiative/main/path');
  });

  test('幂等门：state.evaluate_verdict 非空时直接 return，不调 executor', async () => {
    const spy = makeSpyExecutor();
    const state = {
      task: { id: 'task-h8-idem' },
      worktreePath: '/whatever',
      evaluate_verdict: 'PASS',
      evaluate_feedback: 'cached',
    };
    const out = await evaluateSubTaskNode(state, { executor: spy });
    expect(spy.calls.length).toBe(0);
    expect(out.evaluate_verdict).toBe('PASS');
    expect(out.evaluate_feedback).toBe('cached');
  });
});
```

- [ ] **Step 2.2**：跑测试，期待 FAIL

```bash
cd /Users/administrator/worktrees/cecelia/h8-evaluator-worktree-switch
mkdir -p tests/brain
npx vitest run tests/brain/h8-evaluator-worktree.test.js 2>&1 | tail -25
```

期望：
- `harnessTaskWorktreePath` 测试 FAIL（函数还没 export）
- `worktreePath 传给 executor 的值` 测试 FAIL（impl 还没改，传的还是 state.worktreePath）
- 幂等门测试可能 PASS（pre-fix 已实现幂等）

- [ ] **Step 2.3**：commit (TDD red)

```bash
git add tests/brain/h8-evaluator-worktree.test.js
git commit -m "test(brain): add failing tests for H8 evaluator worktree switch"
```

---

### Task 3: Implement helper + evaluateSubTaskNode 切换（commit 3，TDD green）

**Files**:
- Modify: `packages/brain/src/harness-worktree.js`
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 3.1**：改 harness-worktree.js

**改动 A**：line 9 加 `export` 关键字。

old_string:
```
const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';
```
new_string:
```
export const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';

/**
 * 计算 harness sub-task worktree 路径（SSOT）。
 *
 * <baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>
 */
export function harnessTaskWorktreePath(taskId, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  return path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${shortTaskId(taskId)}`);
}
```

**改动 B**：原 `wtPath` 计算（line 62）改用 helper。

old_string（精确匹配，line 62 附近）:
```
  const sid = shortTaskId(opts.taskId);
  const branch = makeCpBranchName(opts.taskId, { now: opts.now });
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);
```
new_string:
```
  const branch = makeCpBranchName(opts.taskId, { now: opts.now });
  const wtPath = harnessTaskWorktreePath(opts.taskId, { baseRepo });
```

注意：删了 `const sid = shortTaskId(opts.taskId);` 这行，因为现在 sid 不再需要（helper 内部算）。如果 wtPath 之外的代码还用 `sid` 变量，需要保留这行。**先 grep 确认**：

```bash
grep -c '\bsid\b' packages/brain/src/harness-worktree.js
```

如果 count > 1（除了 line 60 那处），保留 `const sid = shortTaskId(opts.taskId);`。

- [ ] **Step 3.2**：改 harness-initiative.graph.js

**改动 A**：line 33 import 加 `harnessTaskWorktreePath`：

old_string:
```
import { ensureHarnessWorktree } from '../harness-worktree.js';
```
new_string:
```
import { ensureHarnessWorktree, harnessTaskWorktreePath } from '../harness-worktree.js';
```

**改动 B**：evaluateSubTaskNode 函数体，找到这段（约 line 1147-1170）：

old_string（精确匹配）:
```
  const executor = opts.executor || spawn;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const workstreamN = (state.task_loop_index ?? 0) + 1;
  const journeyType = state.taskPlan?.journey_type || 'autonomous';
```
new_string:
```
  const executor = opts.executor || spawn;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const workstreamN = (state.task_loop_index ?? 0) + 1;
  const journeyType = state.taskPlan?.journey_type || 'autonomous';
  // H8: evaluator 必须 mount 跟 generator 同一个 sub-task worktree（PR #2851 后 generator 自起独立 worktree），
  // 否则 evaluator 容器看不到 generator commit 的 acceptance-task-payload.json / 测试代码。
  const taskWorktreePath = harnessTaskWorktreePath(state.task.id);
```

**改动 C**：line 1170 替换 worktreePath。

old_string:
```
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_evaluate',
```
new_string:
```
      worktreePath: taskWorktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_evaluate',
```

- [ ] **Step 3.3**：跑 test，期待全 PASS

```bash
cd /Users/administrator/worktrees/cecelia/h8-evaluator-worktree-switch
npx vitest run tests/brain/h8-evaluator-worktree.test.js 2>&1 | tail -10
```

期望：4/4 PASS

- [ ] **Step 3.4**：跑 ARTIFACT 检查

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/export function harnessTaskWorktreePath/.test(c))process.exit(1);if(!/export const DEFAULT_BASE_REPO/.test(c))process.exit(1);console.log('ARTIFACT_A_OK')"
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/export async function evaluateSubTaskNode[\s\S]+?\n\}/);if(!m||!m[0].includes('harnessTaskWorktreePath'))process.exit(1);console.log('ARTIFACT_B_OK')"
```

期望：`ARTIFACT_A_OK` / `ARTIFACT_B_OK`

- [ ] **Step 3.5**：跑现有 harness-worktree 相关测试，确认 ensureHarnessWorktree 没被破坏

```bash
cd packages/brain
npx vitest run src/__tests__/harness-worktree-state-validation.test.js 2>&1 | tail -10
cd ../..
```

期望：原测试仍 PASS（helper 内部重构不应破坏现有行为）

- [ ] **Step 3.6**：commit (TDD green)

```bash
git add packages/brain/src/harness-worktree.js packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): evaluator 切到 generator 的 task worktree (H8) — 抽 harnessTaskWorktreePath SSOT helper"
```

---

### Task 4: DoD checked + Learning（commit 4）

**Files**:
- Modify: `cp-0509144710-h8-evaluator-worktree-switch.dod.md`
- Create: `docs/learnings/cp-0509144710-h8-evaluator-worktree-switch.md`

- [ ] **Step 4.1**：DoD 5 项 `[ ]` → `[x]`

```bash
sed -i '' 's/- \[ \]/- [x]/g' cp-0509144710-h8-evaluator-worktree-switch.dod.md
grep -c '\- \[x\]' cp-0509144710-h8-evaluator-worktree-switch.dod.md
```

期望：`5`

- [ ] **Step 4.2**：写 Learning

```markdown
# Learning: H8 — evaluator 切到 generator 的 task worktree

**PR**: cp-0509144710-h8-evaluator-worktree-switch
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 v9 跑里 evaluate 节点 4 次都报"acceptance-task-payload.json 不存在"FAIL → 整个 sub_task 走 terminal_fail 路径，initiative graph 卡死。

## 根本原因

PR #2851 让 sub-graph spawnNode 自起独立 worktree（`<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>`），从此 generator commit 的产物（acceptance-task-payload.json / 测试 / impl）都在这个 task worktree 里，**不再在 initiative 主 worktree**。但 evaluateSubTaskNode (harness-initiative.graph.js:1170) 没跟着改，传给 evaluator executor 的 worktreePath 仍是 state.worktreePath（initiative 主 worktree） → evaluator 容器 mount 错目录 → 看不到任何 generator 产物 → 恒报 FAIL。

哲学层根因：当**节点之间的 worktree 共享假设**被打破时（generator 独立 vs initiative 共享），所有"读 generator 产物"的下游节点必须同步切换。**节点产物的"位置"是节点契约的一部分**，不能由 state.worktreePath 隐式承载（路径是产物属性，不是 graph 状态）。spec 阶段 2 的 contract enforcement layer 应把"产物位置"显式化（每个节点声明 reads_from / writes_to）。

## 下次预防

- [ ] 任何 graph 节点改 worktree 隔离粒度时，必须同步审查所有"读节点产物"的下游节点的 worktreePath 取值
- [ ] worktree 路径计算抽 SSOT helper（harnessTaskWorktreePath），避免两处重复 path.join 漂移
- [ ] PR review 凡涉及 graph 节点 worktreePath 字段，问"哪个节点写 / 哪些节点读 / 路径一致吗"
```

- [ ] **Step 4.3**：commit

```bash
git add cp-0509144710-h8-evaluator-worktree-switch.dod.md docs/learnings/cp-0509144710-h8-evaluator-worktree-switch.md
git commit -m "docs: H8 DoD checked + Learning"
```

---

### Task 5: Push + PR + foreground CI wait（controller 做）

略 — controller 在 finishing 做。

---

## Self-Review

**Spec coverage**：spec §2 修法（helper + evaluateSubTaskNode 切换）→ Task 3.1 + 3.2；§3 不动什么 → Task 3 严守；§4 测试策略 → Task 2 (3 BEHAVIOR test) + Task 3.4 (ARTIFACT)；§5 DoD 5 项 → Task 1.2 + Task 4.1；§6 合并后真实证 → 不在 plan 范围；§7 不做 → Task 3 仅碰 2 文件 ✓

**Placeholder scan**：无 TBD/TODO，每 step 给具体代码、命令、期望输出 ✓

**Type consistency**：
- `harnessTaskWorktreePath` / `DEFAULT_BASE_REPO` 命名在 spec/plan/PRD/DoD/test 全部一致
- `taskWorktreePath` 局部变量命名在 plan 一致
- 文件路径 `tests/brain/h8-evaluator-worktree.test.js` 一致 ✓

**TDD iron law**：Task 2 commit-1 = fail test，Task 3 commit-2 = impl，顺序对 ✓

**lint-tdd-commit-order**：CI 校验 brain/src/*.js 改动前必须有 *.test.js commit。Task 2 改 tests/brain/，Task 3 改 brain/src/，commit 时间顺序 Task 2 → Task 3 ✓

**lint-test-pairing**：Task 2 写 `tests/brain/h8-evaluator-worktree.test.js`，覆盖 Task 3 改的 brain/src 模块 ✓
