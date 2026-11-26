# 修复轻盈底座 Codex 等待空输入

Task: 87b24f84-f22e-406d-bf2e-2ae73b6dbbc8
GP-Anchor: none(infra)

- [x] 正常派单、冻结和认证流程中，实际子进程在收到空 stdin 的 EOF 后生成业务模型回执。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/native-discovery.test.mjs
- [x] 现有独立 Skill 启动和回执回归全部通过，原超时、输出边界及认证代码沿用现行实现。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill

## 悦升 101 收尾复核

- [x] 原运行只能是 101 独立 Skill，原任务、TaskRun、冻结绑定、已退出宿主及隔离本机锁须匹配。
- [x] 同次只存在已回执的 ADB 只读探针。原清理收据原字节、新鲜的默认桌面读回及零业务效果共同支持复核。
- [x] 原中央锁按设备、owner 与版本条件清理。已空闲的同版本保持空闲。旧收据和复核历史保留。
- [x] 独立 PostgreSQL HTTP 回归覆盖正常结算、无修改的读回、幂等重试、错误桌面、非只读 adb 和租约版本变化。

Brain Task 7ea9603c-73fb-4b04-b360-5ee5cae849fb
