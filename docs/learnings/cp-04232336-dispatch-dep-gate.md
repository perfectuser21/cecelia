# Learning: Dispatch 依赖门禁遗漏 `task_dependencies` 表

**Branch**: `cp-04232336-dispatch-dep-gate`
**Date**: 2026-04-23
**Related PR**: (待 push 后填)

## 现象
Initiative 2303a935 的 4 个 Generator 子任务 ws1/ws2/ws3/ws4 明确在 `task_dependencies` 表写了线性依赖（ws2→ws1, ws3→ws2, ws4→ws3）。但 4 个任务同时 queued 时，Brain 普通 dispatcher 并行派出 ws2/ws3/ws4，基于错误 worktree 状态产出冲突 PR。

## 根本原因
- 系统有**两条**表达依赖的路径：
  - `tasks.payload.depends_on`（软指针，JSON 里的 UUID 数组）
  - `task_dependencies` 表（硬边，`from_task_id → to_task_id` 行）
- `selectNextDispatchableTask` 只检查前者，对后者盲视
- `harness-dag.js:nextRunnableTask` 正确地检查了后者，但**只在 Initiative Runner 内部调用**，不参与普通 tick dispatch
- 结果：`task_dependencies` 只在 Initiative Runner "拉一个" 场景下生效；一旦 Initiative 子任务回落到普通 queued 状态，依赖门禁消失

## 修复
在 `selectNextDispatchableTask` 的 for 循环内，现有 payload 检查之后追加：

```js
const tableDepResult = await pool.query(
  `SELECT COUNT(*) AS blocked_count
   FROM task_dependencies d
   JOIN tasks dep ON dep.id = d.to_task_id
   WHERE d.from_task_id = $1
     AND dep.status NOT IN ('completed', 'cancelled', 'canceled')`,
  [task.id]
);
if (parseInt(tableDepResult.rows[0].blocked_count) > 0) continue;
```

两层检查并存：任一未满足即 skip。

## 下次预防
- [ ] 任何新增"依赖表达机制"必须同时 patch **所有** dispatcher 入口（目前至少 `selectNextDispatchableTask` + `nextRunnableTask`，未来增加 worker 选 task 前也要核对）
- [ ] 为 dispatch 路径写 "依赖语义契约" 文档：说明 payload.depends_on 和 task_dependencies 表应在何处检查、何时采用何者
- [ ] 在 harness-dag.js upsertTaskPlan 写表后，单独补一份 payload.depends_on（双写），保证即使某个 dispatcher 只看 payload 也安全 —— 作为纵深防御（本 PR 不做此改动，避免语义分叉）
- [ ] 单测覆盖到表 + payload 双维度，不止 payload

## 影响面
- 仅影响 `selectNextDispatchableTask`，即普通 tick dispatch
- 不影响 `nextRunnableTask`（Initiative Runner 专用）
- 不改 payload.depends_on 语义
