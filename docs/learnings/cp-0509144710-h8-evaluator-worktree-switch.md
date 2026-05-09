# Learning: H8 — evaluator 切到 generator 的 task worktree

**PR**: cp-0509144710-h8-evaluator-worktree-switch
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 v9 跑里 evaluate 节点 4 次都报"acceptance-task-payload.json 不存在"FAIL → 整个 sub_task 走 terminal_fail 路径，initiative graph 卡死。

### 根本原因

PR #2851 让 sub-graph spawnNode 自起独立 worktree（`<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>`），从此 generator commit 的产物（acceptance-task-payload.json / 测试 / impl）都在这个 task worktree 里，**不再在 initiative 主 worktree**。但 evaluateSubTaskNode (harness-initiative.graph.js:1170) 没跟着改，传给 evaluator executor 的 worktreePath 仍是 state.worktreePath（initiative 主 worktree） → evaluator 容器 mount 错目录 → 看不到任何 generator 产物 → 恒报 FAIL。

哲学层根因：当**节点之间的 worktree 共享假设**被打破时（generator 独立 vs initiative 共享），所有"读 generator 产物"的下游节点必须同步切换。**节点产物的"位置"是节点契约的一部分**，不能由 state.worktreePath 隐式承载（路径是产物属性，不是 graph 状态）。spec 阶段 2 的 contract enforcement layer 应把"产物位置"显式化（每个节点声明 reads_from / writes_to）。

### 下次预防

- [ ] 任何 graph 节点改 worktree 隔离粒度时，必须同步审查所有"读节点产物"的下游节点的 worktreePath 取值
- [ ] worktree 路径计算抽 SSOT helper（harnessTaskWorktreePath），避免两处重复 path.join 漂移
- [ ] PR review 凡涉及 graph 节点 worktreePath 字段，问"哪个节点写 / 哪些节点读 / 路径一致吗"
