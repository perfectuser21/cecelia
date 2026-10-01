# DoD — 合同封存补齐任务 Sprint 上下文

- [x] [BEHAVIOR] context 首次封存、已批准同证据重封仅补缺值，同根幂等；不同根、多根、非法 payload 拒绝；任一步失败全事务回滚，其他任务授权字段保持。
  Test: manual:bash -c "cd packages/brain && DB_NAME=cecelia_scratch DB=cecelia_scratch POSTGRES_INTEGRATION=1 npx vitest run --config vitest.integration.config.js src/__tests__/integration/contract-task-context.pg.integration.test.js src/orchestrator/__tests__/contract-store.test.js"
- [x] [BEHAVIOR] native Sprint 原生入口通过 Vitest loader 真执行同一永久 PostgreSQL 套件，无复制业务断言。
  Test: manual:bash -c "DB_NAME=cecelia_scratch npx vitest run sprints/tests/contract-task-context.test.mjs"
- [x] [BEHAVIOR] gates 合同测试路径、facts、Brain 四处版本同步与 DoD 映射通过。
  Test: manual:bash -c "node packages/engine/scripts/devgate/check-test-coverage.cjs sprints/contract-draft.md && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs"

真实 native/seal/evaluator/Judge/合并部署由正式 Kernel 链验收；不得用本地绿测替代 native 事件或生产 API 回读。
