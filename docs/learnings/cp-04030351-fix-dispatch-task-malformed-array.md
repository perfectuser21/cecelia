# Learning: dispatch_task action 传字符串导致 malformed array literal

**任务**: [SelfDrive] [P0] 诊断和修复 Brain API degraded  
**PR**: cp-04030351-0b58ce98-1733-4960-93bb-4b0ef6  
**日期**: 2026-04-03

---

### 根本原因

`decision-executor.js` 的 `dispatch_task` action 将 `params.trigger`（字符串 `'task_completed'`）
传给了 `dispatchNextTask(goalIds)`，但该函数期望 UUID 数组或 null。

```js
// 错误代码（修复前）
const result = await dispatchNextTask(params.trigger || 'thalamus');
//                                    ^^^^^^^^^^^^^^^^ 字符串！
```

PostgreSQL 执行 `t.goal_id = ANY($1)` 时尝试将字符串 `'task_completed'` 解析为数组字面量，
抛出 `malformed array literal: "task_completed"`，导致 thalamus 每次 task_completed
回调后的派发事务全部回滚，任务队列冻结无法推进。

---

### 症状链条

```
task_completed 事件
  → thalamus 快速路由返回 dispatch_task action
  → decision-executor 调用 dispatchNextTask('task_completed')
  → selectNextDispatchableTask('task_completed', [])
  → SQL: WHERE (t.goal_id = ANY($1)  ← $1='task_completed'，PostgreSQL 爆炸
  → malformed array literal
  → transaction ROLLBACK
  → 记录 decision_rollback 事件
  → 队列中所有任务无法被派发
```

Brain API `/health` 端点自身保持 healthy（进程正常），
但自驱派发系统完全冻结 → 表现为 "Brain API degraded"。

---

### 修复

1. **`decision-executor.js`**: `dispatch_task` 传 `null` 而非 `params.trigger`  
   `null` = 不按 goal 过滤，派发任何优先级最高的可用任务

2. **`tick.js`** `selectNextDispatchableTask`: 支持 `null` goalIds  
   `null` → `goalCondition = '(1=1)'`（不过滤 goal），适合 thalamus 触发的全局派发

---

### 下次预防

- [ ] `dispatchNextTask(goalIds)` 函数入参应在文档注释中明确标注类型：`goalIds: string[] | null`
- [ ] `dispatch_task` action 未来如需传元数据，使用独立字段（如 `params.metadata`），不要复用 goalIds 位置
- [ ] 测试覆盖：新增 action handler 时必须有 mock 测试验证实际传参类型
- [ ] `malformed array literal` 错误类型应加入 Brain 错误告警分类，快速定位 SQL 参数类型错误
