---
id: learning-codex-runner-model
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: runner.sh CODEX_MODEL 支持（2026-03-14）

## 问题背景

runner.sh v2.3.0 没有指定 `--model` 参数，由 Codex CLI 自动选择模型。在西安 Mac mini 上，Team plan 账号的 Codex CLI 自动选择 `gpt-5.3-codex`，该模型有严格的 per-session quota 限制，导致所有任务在 session 启动时立即报 `Quota exceeded`，账号轮换无效（5 个账号均共享同一 quota 池）。

### 根本原因

- `gpt-5.3-codex` 是 ChatGPT Team plan 的 Codex 默认模型，per-session token 上限低
- runner.sh 未指定 `--model`，完全依赖 CLI 默认选择
- 5 个 team 账号（team1/3/4/5）共享同一 ChatGPT Team workspace，quota 无法通过账号轮换绕过
- `gpt-5.4` 是更新的模型，quota 宽松，手动测试可正常运行

### 下次预防

- [ ] 任何调用 codex-bin 的脚本，都应通过 `CODEX_MODEL` 或 `--model` 显式指定模型
- [ ] 添加新 Codex 账号时，检查账号归属（同一 Team workspace vs 独立账号），确保 quota 真正独立
- [ ] runner.sh 环境变量文档要同步更新（CODEX_MODEL 已加入 v2.4.0 说明）

## 解法

1. runner.sh v2.4.0 新增 `CODEX_MODEL="${CODEX_MODEL:-gpt-5.4}"` 配置项
2. `codex-bin exec` 调用加入 `--model "$CODEX_MODEL"` 参数
3. 日志输出显示当前 model，便于排查

## 效果

所有账号均使用 `gpt-5.4`，Quota exceeded 问题消除，E2E 链路恢复正常。
