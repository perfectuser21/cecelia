# 轻盈底座本机 RPC 使用已验证的 Brain 地址

Task: b9a889dc-afd9-43bb-b50f-59407c5dad49
GP-Anchor: none(infra)

- [x] CLI 从私有配置读取本机 Brain 地址，调度、独立 Skill provider 和冻结 native RPC 使用同一地址。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/worker.test.mjs scripts/standalone-skill/native-discovery.test.mjs
- [x] 业务地址只传受信本机 provider，模型子进程仍使用现行白名单和认证。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/native-discovery.test.mjs
