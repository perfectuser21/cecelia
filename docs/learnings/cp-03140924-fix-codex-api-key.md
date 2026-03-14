---
id: learning-fix-codex-api-key
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03140924-fix-codex-api-key
changelog:
  - 1.0.0: 初始版本
---

# Learning: Codex runner.sh 401 修复 — CODEX_API_KEY vs OPENAI_API_KEY

## 根因

codex-bin v0.114.0（Rust 实现）在读取 API key 时优先检查 `CODEX_API_KEY`，其次才是 `OPENAI_API_KEY`。
当两者都未设置时，binary strings 中的错误信息为 "API key auth is missing a key."，
实际表现为发送 401 Unauthorized 到 api.openai.com/v1/responses。

## 发现过程

1. 通过 `strings /opt/homebrew/bin/codex-bin | grep -E "OPENAI|CODEX_API"` 找到环境变量名
2. 发现 `CODEX_API_KEY` 先于 `OPENAI_API_KEY` 出现（Rust 源码 core/src/auth.rs:661）
3. 测试 `CODEX_API_KEY=sk-proj-... codex-bin exec` 立即成功

## 修复方案

在 runner.sh 配置区，若 `CODEX_API_KEY` 未设置则从 `~/.credentials/openai.env` 读取：

```bash
if [[ -z "${CODEX_API_KEY:-}" ]]; then
    _raw_key=$(grep -E '^OPENAI_API_KEY=' ~/.credentials/openai.env | head -1 | cut -d= -f2- | tr -d '"' | ...)
    export CODEX_API_KEY="$_raw_key"
fi
```

## 关键发现

- `~/.codex/auth.json` 中 `auth_mode: chatgpt` 说明机器之前用 ChatGPT OAuth 登录
- OAuth token 过期后，即使在 config.toml 写了 `api_key` 字段也无效（被 chatgpt 模式覆盖）
- 正确做法：用 API key 模式（CODEX_API_KEY 环境变量），而非 config.toml `[provider]` 段
- codex-bin v2.0.0 runner 实际可以工作：跑到第 8 步（PR 创建），只是撞上 TPM 限速（30000 tokens/min）

## 适用场景

- 任何 codex-bin v0.114.0+ 环境
- 从 ChatGPT OAuth 切换为 API key 模式时
