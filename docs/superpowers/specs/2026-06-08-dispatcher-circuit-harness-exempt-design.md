# Design: dispatcher.js 熔断检查豁免 harness_initiative

**日期**: 2026-06-08  
**类型**: Bug Fix  
**分支**: cp-0608002137-dispatcher-circuit-harness-exempt

## 根因

`dispatcher.js` line 297 的全局 `isAllowed('cecelia-run')` 熔断检查在 `selectNextDispatchableTask`（任务选择）之前运行，对所有任务类型一视同仁。熔断器 OPEN 时整个 dispatch 提前 return，任何任务都无法调度。

`harness_initiative` 走 `runHarnessInitiativeRouter` → Docker spawn 路径，**完全不依赖 cecelia-bridge**，被拦截是误伤。

line 534-536 已有正确豁免逻辑（`needsBridgeCheck = task_type !== 'harness_initiative'`），但提前的 line 297 让这段豁免永不可达。

## 修法

**删除** line 296-300（全局熔断检查）。

**在 line 536 之后**插入条件熔断检查：

```javascript
const needsBridgeCheck = nextTask.task_type !== 'harness_initiative';

// Circuit breaker — 只对依赖 cecelia-bridge 的任务生效（harness_initiative 豁免）
if (needsBridgeCheck && !isAllowed('cecelia-run')) {
  await updateTask({ task_id: nextTask.id, status: 'queued' });
  await pool.query('UPDATE tasks SET claimed_by=NULL, claimed_at=NULL WHERE id=$1', [nextTask.id]);
  await recordDispatchResult(pool, false, 'circuit_breaker_open');
  return { dispatched: false, reason: 'circuit_breaker_open', actions };
}

const ceceliaAvailable = needsBridgeCheck
  ? await checkCeceliaRunAvailable()
  : { available: true };
```

## 影响范围

- drain block（line 302-328）：不依赖 bridge，无影响
- `checkCeceliaRunAvailable`：已有 harness 豁免，无变化
- 其他任务类型（dev/research/...）：熔断行为不变

## 测试策略

`packages/brain/src/__tests__/dispatcher-circuit-harness-exempt.test.js`

| case | 任务类型 | 熔断状态 | 预期结果 |
|------|---------|---------|---------|
| 1 | harness_initiative | OPEN | dispatched: true |
| 2 | dev | OPEN | reason: circuit_breaker_open |
| 3 | harness_initiative | CLOSED | dispatched: true |

Mock 模式参考 `dispatcher-initiative-lock.test.js`。
