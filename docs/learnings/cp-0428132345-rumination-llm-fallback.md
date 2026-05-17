# Learning: PROBE_FAIL_RUMINATION — LLM Emergency Fallback 链不完整

**日期**: 2026-04-28
**分支**: cp-0428132345-fix-rumination-llm-provider
**任务**: 5f16530d-68e8-4cc7-bcf5-ae2b8bbe0824

### 根本原因

1. **DB 配置错误**：活跃 model profile 将 `rumination` 设为 `codex` provider，但 Codex OAuth 账号不可用。
2. **Emergency fallback 链不完整**：`callLLM` 在 `!hasAnthropicCandidate` 分支只尝试 `anthropic-api` 一层兜底，当 anthropic-api 余额不足时不继续尝试 `anthropic`（bridge）。
3. **诊断盲区**：`rumination_llm_failure` 事件的 `llm_error` 字段只记录 candidates 里的错误，不记录 emergency fallback 的失败原因（如 "credit balance too low"）。

### 影响

- rumination 连续 6 天无产出（595 条 undigested learnings 堆积）
- PROBE_FAIL_RUMINATION 持续触发，Brain 每次生成 auto-fix 任务

### 修复

- `llm-caller.js`：`!hasAnthropicCandidate` 分支新增第二层兜底 `callClaudeViaBridge`（bridge 走订阅）
- `rumination.js`：`rumination_llm_failure` 事件 payload 增加 `anthropic_balance_low` 标记
- `247_fix_rumination_provider.sql`（已在 #2682 合并）：将 rumination 改回 `anthropic-api` + bridge fallback

### 下次预防

- [ ] 新增 provider 配置时，必须在 FALLBACK_PROFILE 中也配对应 fallback
- [ ] `callLLM` emergency fallback 测试覆盖「anthropic-api 余额不足 → bridge 兜底」场景（已加）
- [ ] 每次 Brain 部署后，检查 `model_profiles` 的 rumination provider 不为 codex/openai
- [ ] `rumination_llm_failure` 事件必须包含完整错误链（已改）
