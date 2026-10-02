# DoD — 受控再基恢复
- [x] [BEHAVIOR] C7 B2.1 recurring过期收口：DISTINCT ON候选前及最终UPDATE同时排除真实phone执行器与持久owner；真实513producer/旧508租约/历史无owner手机保持原账，伪payload普通及同title邻居合法过期，保取消去重、原字段/history及仅RETURNING计数。最终目标故障为真实SQL负例，不声称非法身份重绑竞态。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/recurring.pg.test.js src/phone-dispatch/recurring-dispatch.pg.test.js src/phone-dispatch/schedule-store.pg.test.js src/phone-dispatch/recurring-dispatch.test.js src/phone-dispatch/schedule-store.test.js src/__tests__/recurring-engine.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] headed HTTP限流：接管POST两注册路径、执行与字段PATCH真实第301请求429；双alias共享预算，错误认证计数，拒绝前不新增数据库/owner/终态副作用；固定draft7/Retry-After且无legacy头，原普通结果/metadata及接管合同保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/routes/__tests__/task-mutation-rate-limit.test.js src/routes/__tests__/task-task-patch.test.js src/routes/__tests__/task-headed-takeover.test.js src/routes/__tests__/headed-patch-transaction.test.js src/lib/__tests__/headed-task-owner.test.js src/routes/__tests__/tasks-result-backfill.test.js src/routes/__tests__/tasks-completed-gate.test.js --maxWorkers=1 --minWorkers=1"


- [x] [BEHAVIOR] OpenClaw 创建/更新 workflow 按六活动推进，重试幂等，未验收不能登记，任务回执保留。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/workflow-authoring --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] 登记真实落库并回读身份与顺序，版本冲突、共享活动变化和失败事务不覆盖已有流程。
  Test: manual:bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-authoring.pg.integration.test.js --maxWorkers=1 --minWorkers=1"

