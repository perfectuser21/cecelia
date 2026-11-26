# 轻盈底座本机 RPC 使用已验证的 Brain 地址

Task: b9a889dc-afd9-43bb-b50f-59407c5dad49
GP-Anchor: none(infra)

- [x] CLI 从私有配置读取本机 Brain 地址，调度、独立 Skill provider 和冻结 native RPC 使用同一地址。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/worker.test.mjs scripts/standalone-skill/native-discovery.test.mjs
- [x] 业务地址只传受信本机 provider，模型子进程仍使用现行白名单和认证。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/native-discovery.test.mjs

## 悦升 101 末次清理握手复核

- [x] 只允许原清理中已经正常结束的唯一 HOME 和特定观察顺序，最后一次 version 的未知握手须由完整叶账原字节支持。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 拒绝缺失或被改写的叶账、未知出现在 HOME、未知命令及不匹配的桌面和中央锁。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 已有探针结算、重放和隔离租约回归通过，保留原失败回执。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js

Brain Task 594f3bdb-1363-456b-b033-2e1f095d1641
