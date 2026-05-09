# H8 — evaluator 切到 generator 的 task worktree

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1
**Brain task**: e11351fa-6566-40b6-99a7-460b217fbe1b
**接手 PRD**: docs/handoffs/2026-05-09-langgraph-contract-enforcement-prd.md（Fix 3）

---

## 1. 背景

PR #2851（合并于 2026-05-08）让 sub-graph 自己 `ensureHarnessWorktree` —— **generator 容器在 `<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>/` 干活**（fresh off main，每个 sub_task 独立 worktree）。

但 `packages/brain/src/workflows/harness-initiative.graph.js` 的 `evaluateSubTaskNode`（line 1170）传给 evaluator executor 的是：

```js
worktreePath: state.worktreePath,
```

`state.worktreePath` 是 **initiative 主 worktree**（HEAD=`cp-harness-propose-r2-...`），跟 generator 干活的那个**不是同一个目录**。

后果：generator commit 的产物（acceptance-task-payload.json / 测试代码 / impl 代码）在 sub_task worktree 里，evaluator mount initiative 主 worktree 进容器跑 harness-evaluator，看不到这些文件 → v9 跑里 evaluate 4 次 FAIL 都报"acceptance-task-payload.json 不存在"。

## 2. 修法

### 抽 SSOT helper（避免两处重复 path 计算）

`packages/brain/src/harness-worktree.js`：

1. 把 `DEFAULT_BASE_REPO` 顶层常量改 `export`（如尚未）
2. 新增 export 函数 `harnessTaskWorktreePath(taskId, opts={})`：

```js
export function harnessTaskWorktreePath(taskId, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  return path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${shortTaskId(taskId)}`);
}
```

3. `ensureHarnessWorktree` 内部 `wtPath` 计算也改用 `harnessTaskWorktreePath()`（统一 SSOT；现有 line 62 那行 `path.join` 替换成函数调用）

### evaluateSubTaskNode 调用换路径

`packages/brain/src/workflows/harness-initiative.graph.js`：

1. import 加 `harnessTaskWorktreePath`：
```js
import { ensureHarnessWorktree, harnessTaskWorktreePath } from '../harness-worktree.js';
```

2. `evaluateSubTaskNode`（line 1140-1216）函数体内，spawn executor 调用前计算：
```js
const taskWorktreePath = harnessTaskWorktreePath(state.task.id);
```

3. line 1170 `worktreePath: state.worktreePath,` → `worktreePath: taskWorktreePath,`

## 3. 不动什么

- `state.worktreePath` 仍由上游节点（initiative graph 入口）写入（initiative 主 worktree 仍有用：planner / proposer / inferTaskPlan / dbUpsert 用）
- `evaluateSubTaskNode` 其他逻辑（幂等门 / verdict 解析 / FAIL 上报）不变
- `ensureHarnessWorktree` 的 self-heal / clone 逻辑不变（只换内部 path 计算的实现）
- 不动 spawnNode / proposer / generator 节点的 worktree 逻辑（已经对了）
- 不引入 cross-package 依赖

## 4. 测试策略

按 Cecelia 测试金字塔：H8 改动跨 2 个文件（harness-worktree.js / harness-initiative.graph.js），属于 **integration 类**（多模块行为），但每个改动局部都很小（1 个新 export 函数 + 1 处 import + 1 行替换）→ unit test 即可覆盖单元行为，integration 由 W8 v11 真跑兜住。

### 测试

`tests/brain/h8-evaluator-worktree.test.js`（vitest，新增）：

- **test A — `harnessTaskWorktreePath` 算路径正确**
  - 调 `harnessTaskWorktreePath('uuid-aaaa-bbbb-cccc')`
  - 期望返回 `${DEFAULT_BASE_REPO}/.claude/worktrees/harness-v2/task-${shortTaskId('uuid-aaaa-bbbb-cccc')}`
  - 调 `harnessTaskWorktreePath(id, { baseRepo: '/tmp/test' })` 应该用 override base
  - 与 `ensureHarnessWorktree`（mock 出来的 stat=false）的 `wtPath` 一致

- **test B — `evaluateSubTaskNode` 传给 executor 的 worktreePath = harnessTaskWorktreePath(state.task.id)**
  - 用一个 spy executor（capture opts.worktreePath）
  - 给 state.task.id = 'task-xxx', state.worktreePath = '/initiative/main' 模拟两个不一样的路径
  - 调 evaluateSubTaskNode(state, { executor: spy })
  - 断言 spy 收到的 `worktreePath` = harnessTaskWorktreePath('task-xxx')，**不等于** '/initiative/main'

- **test C — 幂等门仍然生效**
  - state 已含 evaluate_verdict='PASS'，调 evaluateSubTaskNode 直接 short-circuit return
  - spy executor 不被调用

### 不做 docker E2E

CI 没 docker runtime；W8 v11 真跑（合并后手动）兜住 integration 行为。

## 5. DoD

- [BEHAVIOR] `harnessTaskWorktreePath(taskId)` 返回 `<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>` 路径
  Test: tests/brain/h8-evaluator-worktree.test.js
- [BEHAVIOR] `evaluateSubTaskNode` 传给 executor 的 worktreePath = `harnessTaskWorktreePath(state.task.id)`，不再用 state.worktreePath
  Test: tests/brain/h8-evaluator-worktree.test.js
- [BEHAVIOR] 幂等门 (state.evaluate_verdict 非空时 short-circuit) 不被破坏
  Test: tests/brain/h8-evaluator-worktree.test.js
- [ARTIFACT] harness-worktree.js 含 `export function harnessTaskWorktreePath` + `export const DEFAULT_BASE_REPO`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/export function harnessTaskWorktreePath/.test(c))process.exit(1);if(!/export const DEFAULT_BASE_REPO/.test(c))process.exit(1)"
- [ARTIFACT] harness-initiative.graph.js evaluateSubTaskNode 调 harnessTaskWorktreePath
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.match(/export async function evaluateSubTaskNode[\s\S]+?\n\}/);if(!fn||!fn[0].includes('harnessTaskWorktreePath'))process.exit(1)"

## 6. 合并后真实证（手动）

1. brain redeploy
2. 跑 W8 v11 一次 sub_task → evaluate 节点
3. PG 查 task_events evaluate 节点 stdout 不再含"acceptance-task-payload.json 不存在"
4. evaluate verdict 能正常出 PASS/FAIL（不卡 verdict null 报 FAIL）

## 7. 不做（明确范围）

- ❌ 不动 generator/proposer 节点 worktree（已经对了）
- ❌ 不动 callback router / thread_lookup
- ❌ 不引入 push creds（独立 sprint）
- ❌ 不改 ensureHarnessWorktree 的 self-heal 行为（只换 path 计算实现）
- ❌ 不做 H7/H9/proposer verify push（独立 PR）
