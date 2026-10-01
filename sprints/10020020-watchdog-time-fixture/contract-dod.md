# DoD — 看门狗 PG 全天与精确边界增强（7a8a09a6）

- [ ] [BEHAVIOR] clock 主线基础夹具修复已合并；北京多个时刻增强验证自然日统计、25h stale、1h fresh、恰好24h及无批设备；产品阈值和SQL不变。
  Test: manual:bash -c "cd packages/brain && TZ=UTC DB_NAME=cecelia_scratch POSTGRES_INTEGRATION=1 npx vitest run --config vitest.integration.config.js src/__tests__/commander-watchdog.pg.integration.test.js --maxWorkers=1 --minWorkers=1"
- [ ] [BEHAVIOR] native 原生入口真实运行UTC和上海两次永久PG套件，8项全通过且不允许skip。
  Test: manual:bash -c "DB_NAME=cecelia_scratch npx vitest run sprints/10020020-watchdog-time-fixture/tests/watchdog-time-fixture.test.mjs --maxWorkers=1 --minWorkers=1"
- [ ] [BEHAVIOR] gates 事实、版本、DoD映射和Test Contract完整。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/engine/scripts/devgate/check-test-coverage.cjs sprints/10020020-watchdog-time-fixture/contract-draft.md"
