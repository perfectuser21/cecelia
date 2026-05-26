# Design: Harness Pipeline 串行 Gate — advanceTaskIndexNode merge 检查

**日期**: 2026-05-26  
**分支**: cp-0526145940-fix-harness-serial-gate  
**影响文件**: `packages/brain/src/workflows/harness-initiative.graph.js`

---

## 问题描述

`buildHarnessFullGraph` 的串行执行循环：

```
pick_sub_task → run_sub_task → advance → pick_sub_task → ...
```

`advanceTaskIndexNode` 无条件递增 `task_loop_index`，不检查上一个 sub-task 是否真正 merged。当 WS N 的子图因任何原因提前终止（no_pr / timeout / failed / status: undefined），initiative 仍然推进到 WS N+1，导致并行开出多个 PR，违反串行语义。

**实证**：WS2 子图以 `status: undefined, pr_url: none` 结束，advance 照样执行，WS3 被 pick 并开出 PR #461，而 WS2 PR #460 仍未合并。

---

## 设计方案

### 唯一方案：在 advanceTaskIndexNode 加 merge gate（选定）

在 `advanceTaskIndexNode` 头部检查 `state.sub_tasks` 最后一项的 status：

```js
export async function advanceTaskIndexNode(state) {
  // Serial merge gate: 上一个 sub-task 必须 merged 才能推进
  const subTasks = state.sub_tasks || [];
  if (subTasks.length > 0) {
    const lastTask = subTasks[subTasks.length - 1];
    if (lastTask && lastTask.status !== 'merged') {
      return {
        error: {
          node: 'advance',
          message: `Serial gate: sub-task ${lastTask.id} did not merge (status=${lastTask.status ?? 'undefined'}). Next workstream blocked.`,
        },
      };
    }
  }
  return {
    task_loop_index: (state.task_loop_index ?? 0) + 1,
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}
```

**为什么在这里加**：
- `advance` 是 `run_sub_task` → `pick_sub_task` 的唯一中间节点
- `routeFromPickSubTask` 已有 `if (state.error) return 'end'` 检查，error 设上后自动路由到 END
- `computeHarnessInitiativeOk(final)` 检查 `final.error` 决定任务成败，error 字段会正确触发 initiative 失败

**替代方案（排除）**：
- 修改图结构加 conditional edge → 更侵入，改动面更大
- 在 `routeFromPickSubTask` 里扫 `sub_tasks` → 路由函数无法返回 state update，无法写 error，只能静默跳 END（没有错误信息）

---

## 数据流验证

```
run_sub_task → sub_tasks = [{id:'ws2', status:'failed'}]
     ↓
advanceTaskIndexNode
  → lastTask.status !== 'merged'
  → return {error: {node:'advance', message:'...'}}
     ↓
pick_sub_task → routeFromPickSubTask
  → state.error is set
  → return 'end'
     ↓
END
     ↓
computeHarnessInitiativeOk(final) → false
initiative task → failed
```

---

## 测试策略

**分类**：Unit（直接测函数）

新建 `packages/brain/src/__tests__/harness-serial-gate.test.js`：

| 测试用例 | 输入 | 期望 |
|---|---|---|
| 上一个 WS 未 merged → 返回 error | `sub_tasks:[{id:'ws1',status:'failed'}]` | `{error: {node:'advance',...}}` |
| 上一个 WS status undefined → 返回 error | `sub_tasks:[{id:'ws1',status:undefined}]` | `{error: {node:'advance',...}}` |
| 上一个 WS 已 merged → 正常递增 | `sub_tasks:[{id:'ws1',status:'merged'}]` | `{task_loop_index:1}` |
| 没有 sub_tasks（首次调用不应发生，但防御）| `sub_tasks:[]` | `{task_loop_index:1}` |

---

## 范围

**包含**：
- `advanceTaskIndexNode` 加 merge gate（5 行）
- 新建 `harness-serial-gate.test.js`（4 个用例）

**不包含**：
- 修改图结构（edges/nodes）
- 处理 WS2 当前未 merged 的存量 PR（手动操作）
- 其他节点的错误处理改动

---

## 验收标准

- [ ] `harness-serial-gate.test.js` 在 commit-1 时所有用例均 FAIL（TDD failing test）
- [ ] commit-2 修复 `advanceTaskIndexNode` 后所有用例 PASS
- [ ] `brain-unit` CI 全绿
- [ ] 既有 `harness-initiative` 测试无回归
