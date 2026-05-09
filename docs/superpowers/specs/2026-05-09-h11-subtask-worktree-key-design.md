# H11 — sub-task worktree key 用 `<initiativeId8>-<logical_id>` 复合

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement（v11 实测暴露）
**Brain task**: 92f6228b-909e-4e24-aaf7-860aeb87b35c

---

## 1. 背景

W8 v11 实测（task `feddcf5e`）暴露 PR #2851 隐藏 P0：

`packages/brain/src/workflows/harness-task.graph.js:120`：
```js
worktreePath = await ensureWt({ taskId: task.id, initiativeId });
```

PR #2851 让 `task.id` = `subTask.id` = logical_task_id（如 "ws1"）。但 `ensureHarnessWorktree` 内部第 60 行调 `shortTaskId(opts.taskId)`，第 27 行强制 ≥8 字符，"ws1" 3 字符 → throw `taskId must be ≥8 chars, got ws1` → spawnNode catch return `{error}` → sub-graph 进 await_callback interrupt 但容器没起 → 90 min 超时整个 graph fail。

PR #2851 期望 sub_task 独立 worktree，但被 shortTaskId 校验挡住，**spawnNode 从未真跑通过**。这意味着：
- v8 看到的 sub_task 容器起 + PR #2848 是另一条路径（H1-Layer 3 之前的旧 spawn 模式）
- v9 evaluate FAIL 报"acceptance-task-payload.json 不存在" — 真根因是 spawn 从未发生（generator 没产出文件），不是 H8 假设的 worktree 路径不一致
- H8 PR 改的 evaluator worktreePath = `harnessTaskWorktreePath(state.task.id)` 实质等价于改之前的 `state.worktreePath`（都是 initiative worktree），是 cosmetic noop —— H8 设计基于"generator 在 task-{shortTaskId} 干活"的错误假设

正确的 sub_task worktree 路径应该是 `<initiativeId8>-<logical_id>`（如 `task-feddcf5e-ws1`），保证：
- 同 initiative 不同 sub_task 不碰撞（ws1 vs ws2）
- 不同 initiative 同 logical_id 不碰撞（init A 的 ws1 vs init B 的 ws1）

## 2. 修法

### 2.1 harness-worktree.js — 加 wtKey 参数 + 新 helper

`ensureHarnessWorktree(opts)` 签名加 `opts.wtKey`：
```js
const wtKey = opts.wtKey || shortTaskId(opts.taskId);
const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${wtKey}`);
const branch = opts.branch || makeCpBranchName(opts.taskId, { now: opts.now });
```

后向兼容：调用方不传 wtKey → 默认走 shortTaskId（initiative-level callers 不变）。

新 export helper：
```js
export function harnessSubTaskWorktreePath(initiativeId, logicalTaskId, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const init8 = String(initiativeId).slice(0, 8);
  return path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${init8}-${logicalTaskId}`);
}

export function harnessSubTaskBranchName(initiativeId, logicalTaskId, opts = {}) {
  // cp-<MMDDHHMM>-<init8>-<logical>，满足 branch-protect 正则
  const now = opts.now || new Date();
  // 用同 makeCpBranchName 的时间戳逻辑
  const stamp = ...;
  return `cp-${stamp}-${String(initiativeId).slice(0,8)}-${logicalTaskId}`;
}
```

（branch helper 实际复用 `makeCpBranchName` 的时间戳计算，最简单方案：构造一个伪 taskId = `${init8}${logical_id}` 长度 ≥ 8 喂给 makeCpBranchName。具体在 plan 阶段决定。）

### 2.2 harness-task.graph.js spawnNode — 用复合 key

```js
import { ensureHarnessWorktree, harnessSubTaskWorktreePath, harnessSubTaskBranchName } from '../harness-worktree.js';

// spawnNode line 120 改：
const wtKey = `${String(initiativeId).slice(0, 8)}-${task.id}`;
const subTaskBranch = harnessSubTaskBranchName(initiativeId, task.id);
worktreePath = await ensureWt({
  taskId: task.id,         // 仍传，给 ensureWt 内部其他地方用
  initiativeId,
  wtKey,                   // ← 新参数 override path 计算
  branch: subTaskBranch,   // ← 新参数 override branch
});
```

### 2.3 harness-initiative.graph.js evaluateSubTaskNode — 用同样路径

H8 改的 `harnessTaskWorktreePath(state.task.id)` 改回 `harnessSubTaskWorktreePath(state.initiativeId, state.sub_task?.id || state.task.id)`：

```js
const taskWorktreePath = state.sub_task?.id
  ? harnessSubTaskWorktreePath(state.initiativeId, state.sub_task.id)
  : state.worktreePath;  // fallback for final E2E（不在 sub_task 上下文）
```

注：fallback 用 state.worktreePath（initiative 主 worktree），适合 finalE2eNode 等 initiative-level evaluator。但 evaluateSubTaskNode **始终在 sub_task 上下文**（pickSubTaskNode 之后），state.sub_task 应非空。fallback 是防御。

## 3. 不动什么

- `shortTaskId` 函数本身不动（保留 ≥8 校验给 initiative-level worktree 用）
- `makeCpBranchName` 不动（保留 ≥8 校验给 initiative-level branch 用）
- 非 H11 范围（H7/H9/H8/H10 已合 PR）
- proposer/reviewer/inferTaskPlan/finalE2eNode 不动
- ensureHarnessWorktree 的 self-heal / clone 主体逻辑不动

## 4. 测试策略

按 Cecelia 测试金字塔：H11 跨 3 个文件（harness-worktree.js + harness-task.graph.js + harness-initiative.graph.js）+ 行为变化重大（worktree 路径模式整改）→ **integration 类**，但每个改动单元都小。

### 测试

`tests/brain/h11-subtask-worktree-key.test.js`（新增）：

- **A. `harnessSubTaskWorktreePath` 路径计算**
  - `harnessSubTaskWorktreePath('feddcf5e-...-uuid', 'ws1')` → `<base>/.claude/worktrees/harness-v2/task-feddcf5e-ws1`
  - opts.baseRepo override

- **B. `ensureHarnessWorktree` opts.wtKey 优先于 taskId**
  - mock execFn / statFn，taskId='abcd1234ee', wtKey='custom-key'
  - 期望 wtPath 以 `task-custom-key` 结尾，而非 `task-abcd1234`

- **C. `ensureHarnessWorktree` 接受短 taskId 当配 wtKey 时不 throw**
  - taskId='ws1', wtKey='feddcf5e-ws1'（绕过 shortTaskId）
  - 期望不 throw（不调 shortTaskId 路径）

- **D. spawnNode 调 ensureWt 时传复合 wtKey**
  - mock spawnDetached + ensureHarnessWorktree spy
  - state.task.id='ws1', state.initiativeId='feddcf5e-uuid'
  - 期望 ensureWt 收到 opts.wtKey='feddcf5e-ws1'

- **E. evaluateSubTaskNode worktreePath 用 harnessSubTaskWorktreePath（H8 修正）**
  - state.sub_task = { id: 'ws1' }, state.initiativeId = 'feddcf5e-...'
  - 期望 spy executor 收到 worktreePath = `task-feddcf5e-ws1`，不是 `task-feddcf5e`（H8 之前）

不做 docker E2E，CI 没 docker；W8 v12 真跑（合并后）兜 integration。

## 5. DoD

- [BEHAVIOR] `harnessSubTaskWorktreePath(init, logical)` 返回 `task-<init8>-<logical>` 路径
  Test: tests/brain/h11-subtask-worktree-key.test.js
- [BEHAVIOR] ensureHarnessWorktree opts.wtKey 优先于 shortTaskId(taskId) 计算路径
  Test: tests/brain/h11-subtask-worktree-key.test.js
- [BEHAVIOR] ensureHarnessWorktree 配 wtKey 时接受短 taskId（"ws1"）不 throw
  Test: tests/brain/h11-subtask-worktree-key.test.js
- [BEHAVIOR] sub-graph spawnNode 调 ensureWt 时传 wtKey=`<init8>-<logical>`
  Test: tests/brain/h11-subtask-worktree-key.test.js
- [BEHAVIOR] evaluateSubTaskNode 在 state.sub_task 存在时 worktreePath = harnessSubTaskWorktreePath(initiativeId, sub_task.id)
  Test: tests/brain/h11-subtask-worktree-key.test.js
- [ARTIFACT] harness-worktree.js export `harnessSubTaskWorktreePath` + ensureHarnessWorktree 含 `opts.wtKey` 引用
  Test: manual:node -e 检查
- [ARTIFACT] 测试文件存在
  Test: manual:node -e accessSync

## 6. 合并后真实证（手动）

1. brain redeploy
2. 跑 W8 v12 → 看 brain log 含 `harness-task-ws1-r0-*` 容器 spawn（detached）
3. PG 查 sub-graph state.error 为空（不再 'taskId must be ≥8 chars'）
4. evaluator stdout 含 acceptance-task-payload.json 真存在的提示

## 7. 不做（明确范围）

- ❌ 不动 shortTaskId / makeCpBranchName 校验逻辑
- ❌ 不引入 contract enforcement layer（stage 2）
- ❌ 不动 H7/H9/H8/H10
- ❌ 不动 proposer/reviewer/inferTaskPlan/finalE2eNode
