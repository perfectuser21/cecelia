---
id: learning-codex-quota-backoff
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: Quota exceeded 是 rate limit 非 quota 耗尽（2026-03-14）

## 问题背景

runner.sh v2.4.0 遇到 Quota exceeded 时 sleep 2 秒立即切下一个账号，5 个账号在 10 秒内全部失败。所有账号都是 Team workspace 成员，共享同一 rate limit 池。

### 根本原因

- OpenAI Codex API 有 per-minute session rate limit（N sessions/分钟）
- runner.sh 在 10 秒内创建 5 个 session，触发限流
- "Quota exceeded" 实际是 rate limit 响应，不是月度配额耗尽
- 手动单次调用正常（1898-2089 tokens），证明账号本身有效

### 下次预防

- [ ] rate limit 类错误要做指数退避，不要立即重试
- [ ] 账号切换不是解决 rate limit 的方法（共享 rate limit 池）
- [ ] 遇到新的 "Quota exceeded" 场景，先测试手动单次调用是否成功

## 解法

1. 账号切换前 sleep 2 → sleep 30（给 rate limit 窗口恢复时间）
2. 所有账号耗尽时等 60 秒后重置账号列表重试（而不是直接失败）

## 验证

手动 E2E：西安 Mac mini team1 + gpt-5.4 + cecelia repo，成功完成 git commit + push（commit 8f0bc5b14，1898 tokens）。
