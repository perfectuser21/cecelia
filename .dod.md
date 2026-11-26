# 复核轻盈底座首次硬件诊断超时

Task: 61a4d19f-ed29-453d-8b78-3f6e05c47f3c
GP-Anchor: none(infra)

- [x] 使用生产 HTTP 入口复现旧版拒绝原件完整的硬件诊断超时请求。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js --maxWorkers=1 --minWorkers=1
- [x] 核对同一 TaskRun 时间窗口、原件 SHA256、诊断状态及两条连接关闭事件，证据不符时拒绝。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js --maxWorkers=1 --minWorkers=1
- [x] 合法请求原子结束同一 Task 与 TaskRun，保留回执并拒绝自动重试。原有复核保持兼容。
  Test: manual:cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js --maxWorkers=1 --minWorkers=1
