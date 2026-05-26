# Final E2E Fix Loop 接线修复设计

**日期**: 2026-05-18  
**分支**: fix/final-e2e-fix-loop  
**类型**: bug fix  
**文件**: `packages/brain/src/workflows/harness-initiative.graph.js`

---

## 问题

当 Final E2E（`final_evaluate` 节点）失败时，pipeline 直接走 `report → END`，标记为 failed，不再重试。Fix loop 的代码逻辑存在（`task_loop_fix_count` 计数 + `interrupt()`），但图路由是死边，从未触发 re-run。

**根因三点**：
1. `addEdge('final_evaluate', 'report')` 硬边，无条件跳 report
2. `_routeAfterFinalE2E` 函数永远返回 `'report'` 且未接入图
3. `task_loop_fix_count` 被 `pickSubTaskNode`/`advanceTaskIndexNode` 每次重置，无法跨轮追踪 Final E2E fix 次数

---

## 设计

### 新状态字段

```js
// FullInitiativeState 新增：
final_e2e_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 })
```

专用于追踪 Final E2E 的 fix 轮次，不受 sub-task loop 的重置影响。

### `finalEvaluateDispatchNode` 变更

1. **计数源**：`const fixRound = state.final_e2e_fix_count ?? 0`（原 `task_loop_fix_count`）

2. **FAIL + fixRound < MAX_FIX_ROUNDS**（新分支，在 interrupt 块之后、`return verdictDelta` 之前）：
   ```js
   if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound < MAX_FIX_ROUNDS) {
     return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
   }
   ```
   - `final_e2e_fix_count + 1`：追踪已用 fix 轮次
   - `task_loop_index: 0`：重置 sub-task 游标，使 `pick_sub_task` 从头重跑所有 workstream

3. **FAIL + fixRound >= MAX（interrupt 非 GraphInterrupt 异常）**：
   ```js
   // 原：return verdictDelta
   // 新：
   return { ...verdictDelta, error: { node: 'final_evaluate', message: 'max fix rounds exhausted, interrupt failed' } };
   ```
   防止 interrupt 抛非 GraphInterrupt 异常后，routing 函数看到 FAIL 无限路由回 pick_sub_task。

4. **`extend_fix_rounds` handler**：`task_loop_fix_count: 0` → `final_e2e_fix_count: 0`

### `_routeAfterFinalE2E` 路由函数

```js
function _routeAfterFinalE2E(state) {
  if (state.error) return 'report';
  if (state.final_e2e_verdict === 'PASS' || state.final_e2e_verdict === 'PASS_WITH_OVERRIDE') return 'report';
  return 'pick_sub_task'; // FAIL → 重跑所有 sub-tasks
}
```

路由规则：
- `error` 存在（abort / interrupt fail）→ report
- PASS / PASS_WITH_OVERRIDE → report
- FAIL（含 fix_count 已递增）→ pick_sub_task（重跑所有 sub-tasks）

max fix 次数由 `finalEvaluateDispatchNode` 内 `interrupt()` 负责（图不需感知上限）。

### 图接线

```js
// 旧：
.addEdge('final_evaluate', 'report')
// 新：
.addConditionalEdges('final_evaluate', _routeAfterFinalE2E, { report: 'report', pick_sub_task: 'pick_sub_task' })
```

---

## 数据流（修复后）

```
final_evaluate
  │
  ├─ PASS / PASS_WITH_OVERRIDE → report → END
  │
  ├─ FAIL + final_e2e_fix_count < MAX_FIX_ROUNDS(3)
  │    → state: { final_e2e_fix_count+1, task_loop_index:0 }
  │    → pick_sub_task → run_sub_task × N → final_evaluate (循环)
  │
  ├─ FAIL + final_e2e_fix_count >= MAX_FIX_ROUNDS(3)
  │    → interrupt() → 主理人决策:
  │         abort           → error → report
  │         extend_fix_rounds → final_e2e_fix_count:0 → pick_sub_task (再循环)
  │         accept_failed   → PASS_WITH_OVERRIDE → report
  │
  └─ error → report → END
```

---

## 测试策略

| 类型 | 测试内容 | 文件 |
|------|---------|------|
| Unit | `_routeAfterFinalE2E`：error/PASS/PASS_WITH_OVERRIDE/FAIL 四路正确 | `harness-initiative.graph.full.test.js` |
| Unit | `finalEvaluateDispatchNode` FAIL+fixRound<3：返回 `final_e2e_fix_count:1` + `task_loop_index:0` | `harness-initiative-evaluate.test.js` |
| Unit | `finalEvaluateDispatchNode` FAIL+fixRound>=3：调用 `interrupt()`（mock 验证） | `harness-initiative-evaluate.test.js` |
| Unit | `finalEvaluateDispatchNode` extend_fix_rounds：重置 `final_e2e_fix_count:0` | `harness-initiative-evaluate.test.js` |
| Integration | 图级 mock：evaluator 先 FAIL(×1) 再 PASS，验证 final_e2e_fix_count=1 且最终 report | `harness-initiative.graph.full.test.js` |

---

## 影响范围

- `packages/brain/src/workflows/harness-initiative.graph.js` 仅修改
- 相关测试文件：`harness-initiative-evaluate.test.js`、`harness-initiative.graph.full.test.js`
- commit 类型：`fix:`，不需要 smoke.sh

---

## 不在范围内

- 不改 per-task sub-task fix loop（harness-task.graph.js，已正常工作）
- 不改 `MAX_FIX_ROUNDS` 常量（保持 3）
- 不改 interrupt 的 operator 决策接口（harness-interrupts.js）
