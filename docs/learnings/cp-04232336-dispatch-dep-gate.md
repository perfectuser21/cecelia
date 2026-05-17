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
把 `task_dependencies` 表检查**下沉进主 SELECT 的 WHERE 子句**（`NOT EXISTS` 子查询），而非在 JS 层 for 循环内 per-task 查询。这样做的额外好处：

1. **性能**：N 个候选从 "N+1 次 SQL 往返" 变 "1 次 SQL 含 JOIN"，PG 可以用索引
2. **测试稳定性**：15+ 现存 dispatch/initiative-lock/integration 测试都用 `mockResolvedValueOnce` 按顺序 mock 单次 `pool.query`，如果在 for 循环内多加一次查询会**全部打乱**
3. **语义对齐**：与同文件已有的 `project_id` Initiative 锁子查询（`NOT EXISTS` + `t2`）同层、同风格

```sql
AND NOT EXISTS (
  SELECT 1 FROM task_dependencies d
  JOIN tasks dep ON dep.id = d.to_task_id
  WHERE d.from_task_id = t.id
    AND dep.status NOT IN ('completed', 'cancelled', 'canceled')
)
```

原有 `payload.depends_on` 软检查保留在 for 循环内。两层并存：任一未满足即 skip。

## 下次预防
- [ ] 任何新增"依赖表达机制"必须同时 patch **所有** dispatcher 入口（目前至少 `selectNextDispatchableTask` + `nextRunnableTask`，未来增加 worker 选 task 前也要核对）
- [ ] 为 dispatch 路径写 "依赖语义契约" 文档：说明 payload.depends_on 和 task_dependencies 表应在何处检查、何时采用何者
- [ ] 在 harness-dag.js upsertTaskPlan 写表后，单独补一份 payload.depends_on（双写），保证即使某个 dispatcher 只看 payload 也安全 —— 作为纵深防御（本 PR 不做此改动，避免语义分叉）
- [ ] 单测覆盖到表 + payload 双维度，不止 payload

## 影响面
- 仅影响 `selectNextDispatchableTask`，即普通 tick dispatch
- 不影响 `nextRunnableTask`（Initiative Runner 专用）
- 不改 payload.depends_on 语义
