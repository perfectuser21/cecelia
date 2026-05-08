---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 跑通全图 + 收 evidence

**范围**: 等待 LangGraph harness-initiative full graph 跑完 A→B→C 阶段；将 task_id、Planning 6 节点 SQL 截、sub_task task_id+PR URL、interrupt_pending+resumed 计数、thread_lookup 命中、4 个 hotfix PR 编号、Brain log 关键行号都汇总写入 `acceptance-evidence.md`。
**大小**: M
**依赖**: Workstream 1 完成（task_id 已派发且 in_progress）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v9/acceptance-evidence.md` 文件存在
  Test: test -f sprints/w8-langgraph-v9/acceptance-evidence.md

- [ ] [ARTIFACT] evidence 含真实 task_id 引用（不是占位）
  Test: TASK_ID=$(cat /tmp/w8v9-task-id 2>/dev/null) && [ -n "$TASK_ID" ] && grep -q "$TASK_ID" sprints/w8-langgraph-v9/acceptance-evidence.md

- [ ] [ARTIFACT] evidence 含真实 PR URL（GitHub PR 正则匹配）
  Test: grep -E "https://github\.com/.+/pull/[0-9]+" sprints/w8-langgraph-v9/acceptance-evidence.md

- [ ] [ARTIFACT] evidence 显式声明 4 个 hotfix（PR #2845/2846/2847/2850）已生效
  Test: grep -E "#2845" sprints/w8-langgraph-v9/acceptance-evidence.md && grep -E "#2846" sprints/w8-langgraph-v9/acceptance-evidence.md && grep -E "#2847" sprints/w8-langgraph-v9/acceptance-evidence.md && grep -E "#2850" sprints/w8-langgraph-v9/acceptance-evidence.md

- [ ] [ARTIFACT] evidence 不含 TBD/TODO/PLACEHOLDER/XXXX/<填写> 占位符
  Test: ! grep -E "TBD|TODO|PLACEHOLDER|XXXX|<填写>" sprints/w8-langgraph-v9/acceptance-evidence.md

- [ ] [ARTIFACT] evidence 含至少一段 SQL 输出截（含 `graph_node_update` 或 `interrupt_` 字样）
  Test: grep -E "graph_node_update|interrupt_pending|interrupt_resumed" sprints/w8-langgraph-v9/acceptance-evidence.md

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/run-and-evidence.test.ts`，覆盖：
- A 阶段：30min 内 distinct planning node 计数 ≥ 6（覆盖 prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert）
- A 阶段尾：sub_task 行 ≥ 1，且 payload.contract_dod_path 字符串非空
- B 阶段：120min 时间窗内 interrupt_pending ≥ 1 且 interrupt_resumed ≥ 1
- B 阶段：walking_skeleton_thread_lookup 或 harness_thread_lookup 命中 ≥ 1
- B 阶段尾：sub_task verdict=DONE + pr_url 匹配 GitHub PR URL 正则；gh pr view 显示 MERGED 到 main
- 全程：Brain log 致命模式 0 命中（await_callback timeout / lookup miss 404 / OOM_killed reject 无人接住）
