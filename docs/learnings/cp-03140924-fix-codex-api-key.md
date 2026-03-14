---
id: learning-fix-codex-api-key
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03140924-fix-codex-api-key
changelog:
  - 1.0.0: 初始版本
---

# Learning: Codex runner.sh 401 修复（2026-03-14）

### 根本原因

codex-bin v0.114.0（Rust 实现）在 core/src/auth.rs:661 中检查 API key 顺序为 `CODEX_API_KEY` 优先于 `OPENAI_API_KEY`。runner.sh 配置区未设置任何一个，导致 codex-bin 发送无 Authorization header 的请求，服务端返回 401 Unauthorized。

### 下次预防

- [ ] 新增或修改 runner.sh 时，检查 `CODEX_API_KEY` 是否已加载（`echo ${CODEX_API_KEY:+已设置}`）
- [ ] 配置 codex-bin 时，用 `CODEX_API_KEY`（v0.114.0+），而非 `OPENAI_API_KEY` 或 config.toml `[provider]` 段
- [ ] 若 `~/.codex/auth.json` 中 `auth_mode` 为 `chatgpt`，OAuth token 过期后需切换为 API key 模式

## 背景

codex-bin 是 OpenAI Codex CLI（Rust 重写版）。`strings` 工具可从 binary 提取环境变量名，比读文档更准确。发现 CODEX_API_KEY 后测试立即成功，并验证 runner v2.0.0 实际可运行到第 8 步（PR 创建），只是撞上 TPM 限速（30000 tokens/min）而非 auth 问题。
