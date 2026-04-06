# Learning: 内容生成v1 — AI每日产出引擎

**分支**: cp-04060850-4cd26d4a-84bb-4d50-9418-b6772f
**日期**: 2026-04-06

## 根本原因

DB 中 `model_profiles` 表的活跃 profile 将 `cortex` 指向 `codex/gpt-5.4`（Codex）。
`topic-selector.js` 的 `callLLM('cortex', ...)` 无 fallback，Codex 配额耗尽时直接抛错，
导致 `generateTopics()` 失败 → 今日无选题 → 内容产出为零。

## 下次预防

- [ ] 所有直接调用 `callLLM` 的非 executor 模块，都应加 `_callLLMWithFallback` 保护
- [ ] Brain 的 model profile 切换（Codex ↔ Claude）不应影响内容生成主流程的稳定性
- [ ] 内容库 API（`/content-library`）现已上线，可查看日产出和提交人工审核
- [ ] 新增 `_isFallbackError` 识别范式：codex exec failed / usage limit / stream disconnected
