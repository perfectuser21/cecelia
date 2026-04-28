# Spec: 修复 Rumination LLM Fallback（PROBE_FAIL_RUMINATION）

**日期**: 2026-04-28
**任务 ID**: 5f16530d-68e8-4cc7-bcf5-ae2b8bbe0824
**分支**: cp-0428132345-fix-rumination-llm-provider

---

## 背景 / Context

Capability probe "rumination" 持续失败：
- DB 中活跃 model profile 的 `rumination` 配置为 `codex` provider
- Codex OAuth 账号不可用、OpenAI API key 不存在
- 当前 Anthropic API 余额不足（anthropic-api 直连也失败）
- Bridge（anthropic 订阅）可用，但不在 fallback 链中

PR #2682 已修复代码层（emergency fallback + migration 247），但：
1. Brain Docker 容器跑的是旧镜像（1.226.0），migration 247 未执行
2. 即使 migration 运行，anthropic-api 余额不足时 bridge 不在兜底路径

---

## 根本原因

| 层级 | 问题 | 状态 |
|------|------|------|
| DB 配置 | rumination provider = codex（错误） | 未修复（migration 247 未运行） |
| code：emergency fallback | codex 失败后只尝试 anthropic-api，不继续尝试 bridge | 代码存在但 bridge 不在 fallback 链 |
| Anthropic API 余额 | api 余额不足，anthropic-api 失败 | 运营问题（需充值，代码层加 bridge 兜底） |

---

## 修复方案

### 1. DB 层：在代码中手动运行 migration 247

Migration 247 SQL 内容：将活跃 profile 中 `rumination` 的 `codex`/`openai` provider 改为 `anthropic-api`（含 `anthropic` bridge fallback）。

### 2. code 层：扩展 emergency fallback 链

**文件**: `packages/brain/src/llm-caller.js`

当前逻辑：
```
codex 失败 → hasAnthropicCandidate=false → 尝试 anthropic-api 兜底 → 失败 → 抛错
```

修改后：
```
codex 失败 → hasAnthropicCandidate=false → 尝试 anthropic-api 兜底
  → anthropic-api 余额不足 → 尝试 anthropic（bridge）兜底 → 成功
```

具体：在 `callLLM` 的 `!hasAnthropicCandidate` 分支中，anthropic-api 失败后继续尝试 `callClaudeViaBridge` 作为终极兜底。

### 3. 改进诊断：`rumination_llm_failure` 事件记录完整 fallback 链

**文件**: `packages/brain/src/rumination.js`

当前 `llm_error` 字段只记录 `callLLM` 抛出的最后错误（candidates 里的错误），不包含 emergency fallback 的失败原因。

改进：当 `callLLM` 抛错时，若错误包含 `anthropic_api_balance_low` 信号，在 `rumination_llm_failure` 事件的 payload 中补充 `anthropic_balance_low: true`。

---

## 测试策略

| 测试类型 | 覆盖场景 | 文件 |
|---------|---------|------|
| unit | codex 失败 + anthropic-api 失败 → bridge 兜底成功 | `packages/brain/src/__tests__/llm-caller-codex-fallback.test.js`（扩展） |
| unit | codex 失败 + anthropic-api 余额不足 → bridge 兜底成功 | 同上（新 test case） |
| unit | bridge 也失败时抛出完整错误 | 同上（新 test case） |
| smoke | 调用 Brain API 触发 manual rumination → 验证产生 rumination_output | `packages/brain/scripts/smoke/rumination-smoke.sh`（新建） |

---

## 成功标准

- [ ] DB 中 `rumination` provider = `anthropic-api`（migration 247 运行后）
- [ ] `callLLM('rumination', ...)` 在 anthropic-api 失败时自动走 bridge
- [ ] Bridge 可用时 rumination 产生 `rumination_output` 事件
- [ ] `llm-caller-codex-fallback.test.js` 全部通过（含新 bridge 兜底 case）
- [ ] `rumination-smoke.sh` 验证通过

---

## 边界 / 不做

- 不修改 Anthropic API key（运营问题，需 Alex 充值）
- 不修改 rumination 的其他逻辑（NotebookLM 路径、学习处理等）
- 不修改 Brain 部署流程（migration 247 在本次由代码层调用确保）
