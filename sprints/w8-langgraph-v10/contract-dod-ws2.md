---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 监控 / 断言 lib + 健康预检

**范围**: Node.js polling lib（wait-for-status / wait-for-substep / wait-generator-all）+ PG 行解析器
**大小**: M
**依赖**: Workstream 1（共享 fixture 路径与 INITIATIVE_ID 协议）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-for-status.cjs` 存在并接受 CLI 参数 `<initiative_id> <target_status> <timeout_seconds>`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/w8-langgraph-v10/lib/wait-for-status.cjs','utf8');if(!c.includes('process.argv'))process.exit(1);if(!c.includes('waitForStatus'))process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-for-substep.cjs` 存在并接受 `<initiative_id> <task_type> <target_status> <timeout_seconds>` 四个 CLI 参数
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/wait-for-substep.cjs','utf8');if(!c.includes('process.argv'))process.exit(1);if(!c.includes('task_type'))process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-generator-all.cjs` 存在并接受 `<initiative_id> <timeout_seconds>` CLI 参数
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/wait-generator-all.cjs','utf8');if(!c.includes('harness_generator'))process.exit(1)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/pg-task-query.cjs` 导出 `parseTaskRow`、`fetchTaskById`、`fetchSubTasks`、`waitForStatus` 四个函数
  Test: node -e "const m=require('./sprints/w8-langgraph-v10/lib/pg-task-query.cjs');for(const k of ['parseTaskRow','fetchTaskById','fetchSubTasks','waitForStatus']){if(typeof m[k]!=='function')process.exit(1)}"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/wait-lib.test.ts`，覆盖：
- parseTaskRow() 把 PG 返回行解析成 `{id, status, taskType, logicalTaskId, completedAt}`，缺字段时填 null
- waitForStatus() 在 fake pgClient 立即返回 target status 时立即 resolve（不轮询）
- waitForStatus() 在超时窗口内未达终态时抛 `TimeoutError`，不静默通过
