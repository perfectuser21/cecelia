---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: PgCheckpointer 持久化验证 + 无 MemorySaver 静态守门

**范围**：新增 checkpoint inspector 助手模块（按 thread_id 查 `checkpoints` 表，解析 `metadata->'writes'` 拿节点名集合）+ Vitest 验收测试，断言 ≥14 行、≥12 distinct happy nodes、源码无 `MemorySaver` 引用。复用 WS1 traversal observer 跑出的 thread_id。
**大小**：S
**依赖**：Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/workflows/acceptance/checkpoint-inspector.js` 模块存在并导出 `listCheckpointsByThread(threadId, opts)` 与 `listDistinctNodesByThread(threadId, opts)` 两个函数
  Test: node -e "const m=require('./packages/brain/src/workflows/acceptance/checkpoint-inspector.js');if(typeof m.listCheckpointsByThread!=='function'||typeof m.listDistinctNodesByThread!=='function')process.exit(1)"

- [ ] [ARTIFACT] checkpoint-inspector 查询语句包含时间窗口约束（防止造假通过：禁止读老数据）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/acceptance/checkpoint-inspector.js','utf8');if(!/created_at\s*>\s*NOW\(\)\s*-\s*interval/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 源码不再含 `MemorySaver` 引用（Stream 2 已删除生产 fallback；本 ARTIFACT 锁住回归）
  Test: bash -c "if grep -nE 'MemorySaver' packages/brain/src/workflows/harness-initiative.graph.js; then exit 1; fi"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/acceptance-pg-persistence.test.js`，覆盖：
- listCheckpointsByThread 在跑完 traversal smoke 后返回 ≥14 行（10 分钟时间窗内）
- listDistinctNodesByThread 返回的 happy 节点集合 size ≥ 12（覆盖 prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）
- listCheckpointsByThread 在不存在的 thread_id 上返回空数组（不抛错，符合"读 only"语义）
- inspector 函数对 SQL 注入 thread_id 安全（用参数化查询，不字符串拼接）
