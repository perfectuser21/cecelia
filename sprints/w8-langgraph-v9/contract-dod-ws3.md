---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 最终 acceptance 报告 + learnings

**范围**: 写最终 acceptance 报告 + learnings 文档；回写 Brain task 状态为 completed（PATCH /api/brain/tasks/{task_id}）。
**大小**: S
**依赖**: Workstream 2 完成（evidence 已落盘）

## ARTIFACT 条目

- [ ] [ARTIFACT] 最终报告 `docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md` 文件存在
  Test: test -f docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] 报告含真实 task_id 引用
  Test: TASK_ID=$(cat /tmp/w8v9-task-id 2>/dev/null) && [ -n "$TASK_ID" ] && grep -q "$TASK_ID" docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] 报告含 graph_node_update SQL 截
  Test: grep -E "graph_node_update" docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] 报告含 sub_task PR URL
  Test: grep -E "https://github\.com/.+/pull/[0-9]+" docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] 报告含 KR 字段（"管家闭环" / "KR" / "key_result" 任一）
  Test: grep -E "KR|key_result|管家闭环" docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] 报告显式断言 failure_reason 全空
  Test: grep -E "failure_reason.*(NULL|空|none|null)" docs/superpowers/reports/2026-05-08-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] learnings 文档 `docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md` 文件存在
  Test: test -f docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md

- [ ] [ARTIFACT] learnings 文档 ≥ 60 字节（防一句话敷衍）
  Test: [ "$(wc -c < docs/learnings/cp-0509-w8-v9-langgraph-acceptance.md)" -ge 60 ]

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/report-and-learnings.test.ts`，覆盖：
- 报告 5 段必填内容（task_id / graph_node_update / PR URL / KR 字段 / failure_reason 全空断言）齐全
- learnings 内容不是 PRD 的子集（必须含 PRD 文本之外的具体细节）
- Brain task PATCH 回写：tasks 表本任务 status=completed 且 result.merged 为 true
