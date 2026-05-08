---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 集成测试（mock 层 14 节点 + checkpoint resume + credentials 注入）

**范围**：在 `packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js` 写 vitest 集成测试，端到端 mock 跑 `compileHarnessFullGraph()`，验证 14 节点全路径 + sub_task spawn 注入 CECELIA_CREDENTIALS + checkpoint resume 幂等。
**大小**：M
**依赖**：Workstream 1（fixture 提供 prd_content 给 prep 节点 mock）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js` 文件存在
  Test: `test -f packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js`

- [ ] [ARTIFACT] 测试文件 import `compileHarnessFullGraph`（从 `harness-initiative.graph.js`）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js','utf8');if(!/compileHarnessFullGraph/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件 import `MemorySaver` 和 `Command`（来自 `@langchain/langgraph`）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js','utf8');if(!/MemorySaver/.test(c)||!/Command/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件 mock `../../spawn/middleware/account-rotation.js` 的 `resolveAccount`（验 credentials 注入路径）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js','utf8');if(!/account-rotation/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件 reads fixture from `sprints/w8-langgraph-v8/acceptance-fixture.json`（统一 fixture 来源）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js','utf8');if(!/acceptance-fixture\.json/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/w8-acceptance.integration.test.ts`，覆盖：
- full graph 编译不崩
- 第一次 invoke 后 sub-graph 停在 await_callback interrupt（state 含 containerId 但未 finalized）
- Command(resume) 唤回后 graph 走到 report 节点（state.report_path 非空）
- sub_task spawn mock 调用 args.env 含 CECELIA_CREDENTIALS（非空字符串）
- resume 前后 spawn mock 总调用次数 = sub_task 数（无重 spawn — 幂等门生效）
- 顶层 12 节点（prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）spy 各 ≥ 1 次
- sub-graph 5 节点（spawn/await_callback/parse_callback/poll_ci/merge_pr）spy 各 ≥ 1 次
- 测试 thread_id 命名遵循 `harness-task:${initiativeId}:${subTaskId}` 约定
