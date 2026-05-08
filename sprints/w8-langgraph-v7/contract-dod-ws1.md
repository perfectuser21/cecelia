---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 14 节点 traversal observer + happy path 验收测试

**范围**：新增 traversal observer 助手模块 + smoke 脚本 + Vitest 验收测试，覆盖最小 Initiative 端到端跑完 14 节点图（happy path 12 节点全程命中，retry/terminal_fail 合法跳过）；observer 必须输出 `VISITED_NODES`、`SKIPPED_NODES`、`PG_CHECKPOINTER_INJECTED`、`THREAD_ID` 四行机器可解析标记。
**大小**：M
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/workflows/acceptance/traversal-observer.js` 模块存在并导出 `runWithTraversalObserver(opts)` 函数
  Test: node -e "const m=require('./packages/brain/src/workflows/acceptance/traversal-observer.js');if(typeof m.runWithTraversalObserver!=='function')process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs` smoke 脚本存在并接受 `--task-id` `--thread-id` 参数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs','utf8');if(!c.includes('--task-id')||!c.includes('--thread-id')||!c.includes('VISITED_NODES'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs` smoke 脚本输出 `PG_CHECKPOINTER_INJECTED:` 与 `THREAD_ID:` 两行可解析标记
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs','utf8');if(!c.includes('PG_CHECKPOINTER_INJECTED')||!c.includes('THREAD_ID:'))process.exit(1)"

- [ ] [ARTIFACT] traversal observer 不修改 `harness-initiative.graph.js` 源码（验证 git diff 该文件为空）
  Test: bash -c "git diff origin/main -- packages/brain/src/workflows/harness-initiative.graph.js | wc -l | awk '{ if ($1 != 0) exit 1 }'"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/acceptance-traversal.test.js`，覆盖：
- runWithTraversalObserver 跑完最小 Initiative 后，事件流含 12 个 happy path 节点 enter+exit 事件
- 事件流不含 retry / terminal_fail 节点 enter 事件（合法跳过）
- observer 报告 `pgCheckpointerInjected === true`（hotfix #2846 路径生效）
- observer 报告的 `threadId` 等于传入的 thread_id（用于下游 WS2 跨用例查询 checkpoints 表）
