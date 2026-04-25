# Dispatcher Initiative Lock 收紧到 harness 类型 — 设计

## 背景

`packages/brain/src/dispatcher.js:278-289` 的 initiative-level lock 当前用 `project_id` 一刀切：
同一 `project_id` 任意 `in_progress` task 都会阻拒新派发。

bb245cb4 Initiative 跑 Phase A 时其他 dev/talk/audit 任务全被拒派 = 整个 project 死锁。

## 目标

把 initiative-level lock 收紧成 task_type 白名单：仅 harness pipeline 类型才持有 lock。
dev / talk / audit 等通用任务不再被 initiative lock 阻塞。

## 实现

### 文件 1：`packages/brain/src/dispatcher.js`

在文件顶部 import 之后加 harness task type 白名单常量（与 monitor-loop.js / pipeline-watchdog.js 同风格，但严格按 PRD 列表）：

```js
// Initiative-level lock 仅对 harness pipeline 类型生效。
// dev / talk / audit / qa 等通用任务不持有 initiative lock。
const INITIATIVE_LOCK_TASK_TYPES = [
  'harness_task',
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_fix',
  'harness_initiative',
];
```

改 `lockCheck` SQL（L278-L289）：

```js
if (nextTask.project_id && INITIATIVE_LOCK_TASK_TYPES.includes(nextTask.task_type)) {
  const lockCheck = await pool.query(
    `SELECT id, title FROM tasks
     WHERE project_id = $1
       AND status = 'in_progress'
       AND task_type = ANY($3::text[])
       AND id != $2
     LIMIT 1`,
    [nextTask.project_id, nextTask.id, INITIATIVE_LOCK_TASK_TYPES]
  );
  if (lockCheck.rows.length > 0) {
    const blocker = lockCheck.rows[0];
    tickLog(`[dispatch] Initiative 已有进行中 harness 任务 (task_id: ${blocker.id})，跳过派发: ${nextTask.title}`);
    await recordDispatchResult(pool, false, 'initiative_locked');
    return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: nextTask.id, actions };
  }
}
```

要点：
- 顶部 guard：`nextTask.task_type` 不在白名单 → 跳过 lock check（dev/talk/audit 直接放行）
- SQL 内再加 `task_type = ANY($3::text[])`：只查同 project 的 harness 任务作为 blocker（防止 dev 任务卡住 harness）
- `task_type` 取自 `tasks.task_type` 字段（其它 dispatcher 路径 L308 已用 `nextTask.task_type` 验证字段名稳定）

### 文件 2：`packages/brain/src/__tests__/dispatcher-initiative-lock.test.js`（新建）

vitest mock dispatcher 上下文，直接验证白名单行为：

- Case 1: `nextTask.task_type = 'harness_task'`, project 有另一个 `harness_task in_progress` → 返回 `{ dispatched:false, reason:'initiative_locked' }`
- Case 2: `nextTask.task_type = 'dev'`, project 有 `harness_task in_progress` → 不查 lock，正常推进到下一阶段（不返回 initiative_locked）
- Case 3: `nextTask.task_type = 'harness_task'`, project 有 `dev in_progress` → 不算 blocker，可派（lock SQL 应过滤掉非 harness blocker）

mock 方式参考 `dispatcher-quota-cooling.test.js`：mock `db.js` / `executor.js` / `pre-flight-check.js` / `actions.js`。
通过 `mockQuery` mock 不同 SQL 分支返回，断言 `dispatchNextTask([])` 的返回值。

## 边界 / 风险

- 只动 dispatcher 内一处 lock check，不影响 quota / claim / preflight / executor 链路
- 常量内联在 dispatcher.js：与 PRD 描述一致，避免新增导出文件
- harness task 之间 lock 行为不变（关键 case 1 仍锁），只放开了非 harness 的 false-positive

## 成功标准（DoD 摘要）

- [BEHAVIOR] 单元测试 case 1：harness vs harness same project → locked
- [BEHAVIOR] 单元测试 case 2：dev vs harness same project → 不 locked
- [ARTIFACT] dispatcher.js lock SQL 包含 `task_type = ANY` 过滤
