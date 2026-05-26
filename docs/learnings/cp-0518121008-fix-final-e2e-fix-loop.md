# Learning: Final E2E Fix Loop 接线缺失

### 根本原因
1. `addEdge('final_evaluate', 'report')` 死边 — 只有 `addConditionalEdges` 才能实现条件路由，死边永远不检查 verdict
2. `_routeAfterFinalE2E` 路由函数已写但未接入图（只定义不使用），且永远返回 'report'
3. `task_loop_fix_count` 被 `pickSubTaskNode`/`advanceTaskIndexNode` 每次重置，无法跨 sub-task loop 追踪 Final E2E fix 次数——需要独立字段 `final_e2e_fix_count`
4. interrupt catch 正则 `/interrupt/i` 误匹配 vitest 的 "No 'interrupt' export" 错误，导致 re-throw 而非走兜底路径

### 下次预防

- [ ] 设计 fix loop 时，路由函数必须用 `addConditionalEdges` 接入图，只写函数不接不生效
- [ ] 跨 sub-task loop 的计数器必须独立命名，不能复用被内层 loop 重置的字段
- [ ] 新增状态字段同步在 `FullInitiativeState` Annotation 里定义
- [ ] interrupt catch 条件只保留 `err?.name === 'GraphInterrupt'`，不用 message 正则（避免误匹配测试环境错误）

### 附：已知遗留 bug（不在本次修复范围）

`fix_rounds_extended` 字段写入 state 但从未读取用于计算上限。当操作员选择 `extend_fix_rounds` 后，`final_e2e_fix_count` 归零，下轮再到 3 时仍触发 interrupt，并未真正扩展到 6 次。后续需修复：`fixRound >= MAX_FIX_ROUNDS + (state.fix_rounds_extended ?? 0)`。
