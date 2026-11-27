# 复核轻盈底座 101 前台账号拒绝后的受管清理

Task: 535fdab5-7e2c-4921-861c-3a8885f6b915
GP-Anchor: none(infra)

- [x] 原始同 run 账号拒绝、16 个只读叶完全返回、1 条同范围配置快照及新鲜 HOME 证据才允许结算原失败并释放同持有者的中央锁。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 错误日志、叶账缺失或前台证明漂移拒绝，旧收尾路径和无重试语义保持。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
