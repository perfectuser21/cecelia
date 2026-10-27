# DoD

- [x] [BEHAVIOR] 有持久化headed-session+非空owner且无runId的任务，在startup保留状态与认领。
  Test: manual:bash -c 'cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/executor-startup-sync.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 真实scratch中Task/原authoring结果/lease全行不变；普通brainlocal和无owner仍恢复；过期lease仍由原reaper失效。
  Test: manual:bash -c 'cd packages/brain && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] 部署canary在syncOrphanTasksOnStartup内不查询或改共享Task，普通primary继续恢复本地孤儿。
  Test: manual:bash -c 'cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/executor-startup-sync.test.js --maxWorkers=1 --minWorkers=1'
