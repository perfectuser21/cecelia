# Learning: callCodexHeadless OAuth 账号修复

## 根本原因
`callCodexHeadless` 注入 `OPENAI_API_KEY: apiKey`，覆盖了 codex CLI 的 OAuth token，导致所有 codex exec 调用走直接 API 计费（~$0.15-0.24/1M tokens）而非 ChatGPT 订阅（免费）。

## 修复方案
- 新增 `getNextCodexTeamHome()` round-robin 轮换 `~/.codex-team1` / `~/.codex-team2`
- 设置 `CODEX_HOME` 为 team 账号目录，删除 `OPENAI_API_KEY`/`CODEX_API_KEY`
- fallback：无 OAuth 账号时用 API key

## 下次预防
- 新增 codex 调用时，**不要**注入 `OPENAI_API_KEY`
- 用 `CODEX_HOME` 控制账号，不用 key 注入
- codex OAuth 账号通过 `auth.json` 中 `tokens` 字段判断是否有效

## 影响
今日消耗 $6 / 25M input tokens，修复后 codex 调用走订阅不计费。
