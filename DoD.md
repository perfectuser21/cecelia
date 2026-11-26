# 轻盈底座 101 原生准入前失败结算

Task: 095bcbd2-ef8c-40b7-96b4-02ca610fd0ed
GP-Anchor: none(infra)

- [x] 真实 HTTP 与隔离 PostgreSQL 中，经操作者认证且只收同一原 Task、TaskRun、attestation、宿主撤销和复核证据。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain --config vitest.integration.config.js standalone-start-reconciliation.pg.integration.test.js
- [x] 阻断存活持有者、待审批计划、Span、保留的 Activity 动作、过期或漂移证据。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain --config vitest.integration.config.js standalone-start-reconciliation.pg.integration.test.js
- [x] 原子写入失败任务和运行，旧回执原样、同证幂等、末次写失败整笔回滚，未自动重试。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain --config vitest.integration.config.js standalone-start-reconciliation.pg.integration.test.js
