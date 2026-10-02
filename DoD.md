# DoD — 受控再基恢复

- [x] [BEHAVIOR] 显式受鉴权入口追加收据、签发Controller、保留失败事实；旧入口与无显式请求仍拒绝。
  Test: manual:bash -c "npx vitest run tests/gp/f1/step1-controlled-recovery.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] Map/Git/活跃身份改变即拒绝，旧恢复保护保持。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-rebase.test.js src/orchestrator/__tests__/kernel-run-store.test.js src/__tests__/relay-runs-canonical-create.test.js src/orchestrator/preflight/base-sha-reanchor.test.js --maxWorkers=1 --minWorkers=1"

真实隔离PG 6项已通过，详见永久 integration。正式 native、Judge、CI 与部署状态记录于 Brain 任务，不据本 DoD 宣称已完成。

- [x] [BEHAVIOR] 正规恢复冻结目标贯穿ground-truth同run候选与真实dispatcher到attempt/launcher边界，排除旧us投影；冲突profile与非法target无新run或派发。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/orchestrator/__tests__/recovery-target-cross-path.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] identity 身份与许可：手机SSH执行面独立授权；身份字段逐项绑定，未知或过期容量拒绝，动作只允许adb_get_state。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/phone-dispatch/identity.test.js src/phone-dispatch/contracts.test.js src/execution-directory --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] ledger 持久台账：真实PostgreSQL验证已部署image510后补缺号508与507独立台账及十三执行器，验证同单唯一预约、同机互斥、一次launch、丢回复保留占位、认证回执幂等结算及旧writer保护。
  Test: manual:bash -c 'cd packages/brain && DB_NAME="${DB_NAME:-cecelia_scratch}" TEST_DATABASE_URL="" node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/phone-dispatch/store.test.js src/__tests__/integration/execution-directory.pg.integration.test.js src/__tests__/integration/script-capacity-reservation.pg.integration.test.js src/app-server/__tests__/integration/store.test.js --maxWorkers=1 --minWorkers=1'
- [x] [BEHAVIOR] ownership 兼容合同：独立controller不交普通派发器终止，保留历史471名单并核对后续合法增量；手机独立所有权跨180分钟不误回队，旧device宽限保留。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js src/__tests__/executor-headed-liveness.test.js src/phone-dispatch/task-ownership.test.js --maxWorkers=1 --minWorkers=1"
- [x] [BEHAVIOR] gates 门禁：事实、版本及DoD映射全部通过。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"

- [x] [BEHAVIOR] smoke 写入护栏：新smoke默认及显式生产目标拒绝且没有业务写请求；永久守卫验证覆盖真实shell入口。
  Test: manual:bash -c "node --test packages/quality/tests/smoke-production-guard.node-test.mjs packages/quality/tests/phone-dispatch-smoke-env.node-test.mjs"

- [x] [BEHAVIOR] required smoke合同：T1/F4精确十三执行器并核手机独立收口；script保留471历史名单并叠加508精确增量；手机身份smoke在allowlist唯一登记，永久执行真实Node合同块及完整script shell回归。
  Test: manual:bash -c "cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/__tests__/script-executor-contract-smoke.test.js src/__tests__/executor-contracts.test.js src/__tests__/migration-471-script-executor.test.js --maxWorkers=1 --minWorkers=1"
