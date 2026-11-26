# 修复轻盈底座 Codex 等待空输入

Task: 87b24f84-f22e-406d-bf2e-2ae73b6dbbc8
GP-Anchor: none(infra)

- [x] 正常派单、冻结和认证流程中，实际子进程在收到空 stdin 的 EOF 后生成业务模型回执。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/native-discovery.test.mjs
- [x] 现有独立 Skill 启动和回执回归全部通过，原超时、输出边界及认证代码沿用现行实现。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill
