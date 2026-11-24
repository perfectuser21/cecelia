# 旧Tick回滚执行链与重复默认检查清退

Task: a146ab50-3d42-4830-97dd-e16b540836f9
GP-Anchor: none(infra)

- [ ] 真实手动HTTP经tick facade、runTickSafe、runScheduler返回原生派发结果，并更新统计、释放锁；移除无现役调用的旧执行器及兼容常量。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/tick-http-scheduler.test.js src/__tests__/tick-loop.test.js
- [ ] 现役恢复、活性未知保护与发布边界保留，旧专项按实际调用收口。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/t2-liveness-four-blades-regression.test.js src/__tests__/retired-claude-idle-watchdog.test.js
- [ ] callback纯mock十二项归unit唯一owner，PG专属仅由真实PG跑道执行，已休眠图的开启态专项退出默认，关闭态仍验证。
  Test: manual:node --test scripts/ci/__tests__/basic-integration-once.test.mjs
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/callback-processor-pr-gate.test.js src/__tests__/consciousness-loop-disabled.test.js
- [ ] rumination检查实际函数返回与数据库证据，补独有诊断行为后删除字符串版本；重复Python只保Ops真实owner。
  Test: manual:cd packages/brain && npx --no-install vitest run ../../tests/capability-probe-rumination.test.js
  Test: manual:bash scripts/ops/__tests__/opc_company_kr.test.sh
- [ ] 现役原生任务、Notion入口和租约锁的真实PG合同继续执行。
  Test: manual:cd packages/brain && npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/native-agent-scheduler.pg.integration.test.js src/__tests__/integration/native-agent-notion-flow.pg.integration.test.js src/__tests__/integration/task-lease-device-pool.pg.integration.test.js
- [ ] 共享辅助关系无已删除owner/path，通用发布片与固定Git缺件拒绝不放宽。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs
