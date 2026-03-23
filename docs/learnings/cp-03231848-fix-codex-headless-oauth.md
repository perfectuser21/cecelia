# Learning: callCodexHeadless OAuth 账号修复

## 根本原因
`callCodexHeadless` 注入 `OPENAI_API_KEY: apiKey`，覆盖了 codex CLI 的 OAuth token，导致所有 codex exec 调用走直接 API 计费而非 ChatGPT 订阅（免费）。今日消耗 25M tokens / $6。

## 修复方案
- 新增 `getNextCodexTeamHome()` round-robin 轮换 `~/.codex-team1` / `~/.codex-team2`
- 设置 `CODEX_HOME` 为 team 账号目录，删除 `OPENAI_API_KEY`/`CODEX_API_KEY` 注入
- fallback：无 OAuth 账号时用 API key

## 下次预防
- [x] 新增 codex 调用时不注入 `OPENAI_API_KEY`，用 `CODEX_HOME` 控制账号
- [x] codex OAuth 账号通过 `auth.json` 中 `tokens` 字段判断有效性
- [x] 每次配置 codex provider 前检查 team 账号目录是否存在且 tokens 有效
