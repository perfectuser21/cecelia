---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 监控 / 断言 lib + 共享 helper

**范围**: Node.js polling lib（wait-for-status / wait-for-substep / wait-generator-all）+ PG 行解析器（拆分 parse-task-row.cjs）+ 共享 helper（get-logical-id.sh / assert-final-state.cjs）
**大小**: M
**依赖**: Workstream 1（共享 fixture 路径与 INITIATIVE_ID 协议）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/parse-task-row.cjs` 存在并独立导出 `parseTaskRow`（Round 2 修订：从 pg-task-query.cjs 拆出，让 Reviewer 可以 `node lib/parse-task-row.cjs` 独立验证，杜绝 MODULE_NOT_FOUND）
  Test: node -e "const m=require('./sprints/w8-langgraph-v10/lib/parse-task-row.cjs');if(typeof m.parseTaskRow!=='function')process.exit(1)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/pg-task-query.cjs` 导出 `fetchTaskById`、`fetchSubTasks`、`waitForStatus` 三个核心函数（可 re-export `parseTaskRow`，但主源在 parse-task-row.cjs）
  Test: node -e "const m=require('./sprints/w8-langgraph-v10/lib/pg-task-query.cjs');for(const k of ['fetchTaskById','fetchSubTasks','waitForStatus']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-for-status.cjs` 存在并接受 CLI 参数 `<initiative_id> <target_status> <timeout_seconds>`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/w8-langgraph-v10/lib/wait-for-status.cjs','utf8');if(!c.includes('process.argv'))process.exit(1);if(!c.includes('waitForStatus'))process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-for-substep.cjs` 存在并接受 `<initiative_id> <task_type> <target_status> <timeout_seconds>` 四个 CLI 参数
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/wait-for-substep.cjs','utf8');if(!c.includes('process.argv'))process.exit(1);if(!c.includes('task_type'))process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/wait-generator-all.cjs` 存在并接受 `<initiative_id> <timeout_seconds>` CLI 参数
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/wait-generator-all.cjs','utf8');if(!c.includes('harness_generator'))process.exit(1)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/get-logical-id.sh` 存在且可执行，接受 `$1=initiative_id` 并 stdout 输出 logical_task_id（Round 2 修订：抽取共享 helper，Step 5/6/7/8 与 E2E 验收脚本统一调用，schema 字段名变更只改 1 处）
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v10/lib/get-logical-id.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('sprints/w8-langgraph-v10/lib/get-logical-id.sh','utf8');if(!c.includes('logical_task_id'))process.exit(2);if(!c.includes('psql'))process.exit(3)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/assert-final-state.cjs` 存在并接受 `$1=initiative_id` CLI；内部按顺序断言三件事，任一失败 exit 非 0 并打印失败原因（Round 2 修订：合并 Step 8 三段 SQL，让 Step 8 与 E2E 验收共用同一行命令）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/assert-final-state.cjs','utf8');for(const k of ['process.argv','status','completed','logical_task_id','in_progress']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/wait-lib.test.ts`，覆盖：
- parseTaskRow() 把 PG 返回行解析成 `{id, status, taskType, logicalTaskId, completedAt}`，缺字段时填 null
- waitForStatus() 在 fake pgClient 立即返回 target status 时立即 resolve（不轮询）
- waitForStatus() 在超时窗口内未达终态时抛 `TimeoutError`，不静默通过
