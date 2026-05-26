# merge_pr Branch-Behind Auto-Rebase + Error Propagation 修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 修复 `mergePrNode` 的两个问题：① "branch behind main" 时静默失败无恢复路径；② 任何 merge 失败只写 `merge_error` 而不设 `state.error`，导致任务仍标 completed。

**Architecture:** 在 `harness-task.graph.js` 的 `mergePrNode` 内检测 "behind" 错误，调 `gh pr update-branch --rebase`，返回 `{ ci_status: 'pending', rebase_attempted: 1 }` 触发 poll_ci 重新等 CI。修改 graph 边从 `merge_pr → END`（无条件）改为条件路由：`ci_status=pending → poll_ci`，其余 → END。非 behind 错误改为 `{ error: { node: 'merge_pr', message } }` 正确传播失败。

**Tech Stack:** Node.js, LangGraph (@langchain/langgraph), `gh` CLI

---

## 变更范围

**文件:** `packages/brain/src/workflows/harness-task.graph.js`

1. **TaskState Annotation** — 新增 `rebase_attempted: Annotation({ reducer: (_o, n) => n, default: () => 0 })`

2. **`mergePrNode` 函数** — 重写 catch 块：

   ```
   try: gh pr merge → 成功 → 返回 { status:'merged', ci_status:'merged', ... }（不变）

   catch:
     if state.rebase_attempted:
       → 已重试过 → return { error: { node:'merge_pr', message:'merge failed after rebase: ...' } }
     if !BEHIND_RE.test(msg):
       → 非 behind 错误 → return { error: { node:'merge_pr', message } }
     else (behind):
       → await gh pr update-branch prUrl --rebase
       success → return { ci_status:'pending', rebase_attempted: 1 }
       fail    → return { error: { node:'merge_pr', message:'update-branch failed: ...' } }
   ```

   其中 `BEHIND_RE = /behind|out of date|outdated|head ref is out of date|must be up to date|not mergeable/i`

3. **`routeAfterMergePr` 函数（新增）**:

   ```javascript
   export function routeAfterMergePr(state) {
     if (state.status === 'merged') return 'end';
     if (state.error)               return 'end';
     if (state.ci_status === 'pending') return 'poll';
     return 'end';  // merge_error legacy path
   }
   ```

4. **Graph 边** — 修改：
   - 旧：`.addEdge('merge_pr', END)`
   - 新：`.addConditionalEdges('merge_pr', routeAfterMergePr, { end: END, poll: 'poll_ci' })`

## 错误传播修正

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| merge 成功 | `{ status:'merged' }` | 不变 |
| branch behind，首次 | `{ merge_error }` | update-branch → `{ ci_status:'pending', rebase_attempted:1 }` → poll_ci |
| branch behind，二次失败 | N/A | `{ error: { node:'merge_pr' } }` → initiative 感知失败 |
| update-branch 失败 | N/A | `{ error: { node:'merge_pr' } }` |
| 其他错误 | `{ merge_error }` | `{ error: { node:'merge_pr' } }` |
| no pr_url | `{ merge_error }` | `{ error: { node:'merge_pr' } }` |

## 测试策略

**单函数行为 → unit test**（文件：`packages/brain/src/__tests__/harness-task-verdict.test.js`）

新增测试用例：
1. `behind → update-branch ok → returns { ci_status:'pending', rebase_attempted:1 }`
2. `behind + rebase_attempted=1 → returns { error: { node:'merge_pr' } }`
3. `behind → update-branch throws → returns { error: { node:'merge_pr' } }`
4. `non-behind error → returns { error: { node:'merge_pr' } }`（不再是 merge_error）
5. `no pr_url → returns { error: { node:'merge_pr' } }`（不再是 merge_error）
6. `routeAfterMergePr: status=merged → 'end'`
7. `routeAfterMergePr: ci_status=pending → 'poll'`
8. `routeAfterMergePr: error set → 'end'`

**已有测试保留**：`gh pr merge` 参数验证测试（`--squash`, `--delete-branch`）不变。

## 约束

- `rebase_attempted` 上限为 1（仅重试一次），防无限循环
- 不改变成功路径行为（向后兼容）
- `gh pr update-branch --rebase` 失败（如有冲突）立即 hard fail，不 fallback
