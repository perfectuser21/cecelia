# Remove Fix-Rounds Cap 设计文档

**Goal**: 移除 harness pipeline 两处 fix-round 上限，让 agent 无限重试直至修好。

**Architecture**: 单文件改动，`harness-initiative.graph.js`。删除 `MAX_FIX_ROUNDS` 常量及两处引用它的 cap 检查，dead code 同步清理。

**Tech Stack**: Node.js / LangGraph state machine

---

## 改动范围

### 1. `finalEvaluateDispatchNode`（主动路径，Lines 1502-1512）

**改前**：
```js
const fixRound = state.final_e2e_fix_count ?? 0;
if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound < MAX_FIX_ROUNDS) {
  return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
}
if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound >= MAX_FIX_ROUNDS) {
  return { ...verdictDelta, error: { node: 'final_evaluate', message: `Final E2E 已重试 ${fixRound} 次仍失败，自动终止` } };
}
```

**改后**：
```js
const fixRound = state.final_e2e_fix_count ?? 0;
if (verdictDelta.final_e2e_verdict === 'FAIL') {
  return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
}
```

### 2. `routeAfterEvaluate`（dead code，Line 1373）

**改前**：
```js
if (fixCount >= MAX_FIX_ROUNDS) return 'terminal_fail';
return 'retry';
```

**改后**：
```js
return 'retry';
```

### 3. `MAX_FIX_ROUNDS` 常量（Line 51）

删除：`const MAX_FIX_ROUNDS = 3;`

### 4. `terminalFailNode` reason 字符串（Line 1340）

`terminalFailNode` 是 dead code（不在 graph 中），但其 reason 字符串引用了 MAX_FIX_ROUNDS 字面量，需更新为通用描述。

---

## 测试策略

- **unit test** — `finalEvaluateDispatchNode` FAIL + fixRound=0 → 返回 `{ final_e2e_fix_count: 1, task_loop_index: 0 }`
- **unit test** — `finalEvaluateDispatchNode` FAIL + fixRound=3 → 返回 `{ final_e2e_fix_count: 4, task_loop_index: 0 }`（曾经会终止，现在继续）
- **unit test** — `finalEvaluateDispatchNode` FAIL + fixRound=10 → 返回 `{ final_e2e_fix_count: 11, task_loop_index: 0 }`
- **unit test** — `routeAfterEvaluate` FAIL + fixCount=99 → 返回 `'retry'`
- **unit test** — `finalEvaluateDispatchNode` PASS → 返回 verdictDelta（不触碰 fix_count）

---

## 不改的地方

- `runPhaseCIfReady`（Line 387）— 整体已 @deprecated，不动
- `terminalFailNode` 函数体本身 — dead code，只更新 reason 字符串中的字面量引用
- graph 连线 — 不改 `addConditionalEdge`，`_routeAfterFinalE2E` 中 FAIL → pick_sub_task 路由已正确
