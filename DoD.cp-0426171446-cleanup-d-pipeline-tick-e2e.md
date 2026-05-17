# DoD: cleanup-D — content-pipeline 幂等门 + tick-runner 完整 tick E2E

**分支**：cp-0426171446-cleanup-d-pipeline-tick-e2e

## Definition of Done

- [x] [ARTIFACT] 新增 `packages/brain/src/__tests__/integration/content-pipeline-idempotent.integration.test.js`
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/content-pipeline-idempotent.integration.test.js')"

- [x] [ARTIFACT] 新增 `packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js`
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js')"

- [x] [ARTIFACT] content-pipeline-idempotent test mock pg-checkpointer + executor (vi.fn 计数)，含 3 个 it 用例
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/content-pipeline-idempotent.integration.test.js','utf8');if(!c.includes(\"vi.mock('../../orchestrator/pg-checkpointer.js'\"))process.exit(1);if(!c.includes('createContentDockerNodes'))process.exit(1);if((c.match(/it\\(/g)||[]).length<3)process.exit(1)"

- [x] [ARTIFACT] tick-runner-full-tick test 含对 8 plugin tick 的 spy 断言
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js','utf8');for(const m of ['dept-heartbeat','kr-progress-sync-plugin','heartbeat-plugin','goal-eval-plugin','pipeline-patrol-plugin','pipeline-watchdog-plugin','kr-health-daily-plugin','cleanup-worker-plugin']){if(!c.includes(m))process.exit(1)}"

- [x] [BEHAVIOR] content-pipeline-idempotent 验 executor 在第一次（空 state）被调 6 次，第二次（findings_path 已存在）只被调 5 次（research 跳过）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/content-pipeline-idempotent.integration.test.js','utf8');if(!c.includes('toHaveBeenCalledTimes(6)'))process.exit(1);if(!c.includes('toHaveBeenCalledTimes(5)'))process.exit(1);if(!c.includes(\"not.toContain('research')\"))process.exit(1)"

- [x] [BEHAVIOR] tick-runner-full-tick 一次 executeTick 后验所有 8 plugin .tick 都 toHaveBeenCalled，dispatcher.dispatchNextTask 被调，tickState 时间戳被推进
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/tick-runner-full-tick.integration.test.js','utf8');if(!c.includes('dispatchNextTask).toHaveBeenCalled'))process.exit(1);if(!c.includes('tickState.lastZombieSweepTime'))process.exit(1);if((c.match(/\\.tick\\)\\.toHaveBeenCalled/g)||[]).length<8)process.exit(1)"

## 成功标准

1. 新增 2 个 integration test 文件，4 个用例全 pass
2. 既有 `packages/brain/src/__tests__/content-pipeline-graph.test.js`（9 个）+ `tick-dispatch.integration.test.js`（4 个）不回归
3. 测试无真连 PG / Docker / 网络（执行时间 < 5s）
