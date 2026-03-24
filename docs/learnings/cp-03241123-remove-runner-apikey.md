# Learning: runner.sh 删除 API Key 注入（cp-03241123-remove-runner-apikey）

## 任务摘要

删除 `packages/engine/runners/codex/runner.sh` 中的 API Key 注入代码块（v2.1.0 引入），
确保所有 Codex runner 使用 ChatGPT OAuth 包月模式，不再使用 OpenAI API Key 模式。

## 根本原因

runner.sh v2.1.0 为兼容 `codex-bin v0.114.0` 引入了从 `~/.credentials/openai.env` 自动加载
`OPENAI_API_KEY` 并导出为 `CODEX_API_KEY` 的逻辑。这导致 Codex 进入 API Key 模式
（调用 `https://api.openai.com/v1/responses`），而非用户要求的 ChatGPT OAuth 模式。

副作用：
1. 西安机器 SOCKS5 代理下 `/v1/responses` 连接不稳定
2. 消耗 OpenAI API 配额而非包月额度
3. 曾误认为是 gpt-5.4 + 代理兼容问题，实际根因是认证模式错误

## 下次预防

- [ ] 新增任何凭据加载逻辑前，先确认用户的认证意图（OAuth vs API Key）
- [ ] Codex runner 新功能引入时，在 runner.sh 头部注释中明确"认证模式：OAuth Only"
- [ ] 如需支持双模式，应通过明确的环境变量 `CODEX_AUTH_MODE=oauth|apikey` 控制，不自动检测
