# DoD

- [x] 有持久化headed-session+非空owner且无runId的任务，在startup保留状态与认领。
  Test: manual:DB_NAME=cecelia_scratch npx vitest run src/__tests__/executor-startup-sync.test.js
- [x] 真实scratch中Task/原authoring结果/lease全行不变；普通brainlocal和无owner仍恢复；过期lease仍由原reaper失效。
  Test: manual:DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js
- [x] 部署canary不查询或改共享Task，普通primary继续恢复本地孤儿。
  Test: manual:DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js
