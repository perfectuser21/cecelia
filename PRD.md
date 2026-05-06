# PRD — fix(brain): mouth fallbacks 移除失效 codex/anthropic-api，改用 OAuth bridge

## 背景 / 问题

当前活跃 model_profile 的 mouth 配置：
```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "fallbacks": [
    {"model": "codex/gpt-5.4-mini", "provider": "codex"},
    {"model": "claude-sonnet-4-6", "provider": "anthropic-api"}
  ]
}
```

**两个 fallback 都失效**：
- `codex` provider：CLI refresh token 401（"Your refresh token has already been used... Please try signing in again"）
- `anthropic-api` provider：信用余额 0（"Your credit balance is too low"）

加上 primary anthropic（bridge OAuth）经常被 8s timeout 截断，**mouth 整体几乎必失败**。每次失败堆积 `cecelia-run` 熔断 +1，累积 526 次 → 熔断 OPEN → dispatcher 全局停摆。

## 成功标准

- **SC-001**: 活跃 profile 的 mouth.fallbacks 不再含 codex 或 anthropic-api provider
- **SC-002**: 新 fallback 走 anthropic bridge（OAuth Claude Code），从 sonnet 降级到 haiku（同 provider，更稳更快）
- **SC-003**: 其他 agent 配置（cortex / reflection / rumination）不受影响
- **SC-004**: Brain 重启后 mouth 失败率应显著下降

## 范围限定

**在范围内**：
- migration 266：UPDATE model_profiles 修改 mouth.fallbacks
- 单元测试（grep SQL 内容，不依赖 DB）

**不在范围内**：
- llm-caller.js 的 implicit fallback 逻辑（line 224-235 anthropic-api 直连）— 后续 PR
- 其他 agent fallback 调整
- 修复 codex / anthropic-api 凭据（运维操作）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/migrations/266_mouth_fallback_oauth_only.sql` 创建
- [x] [ARTIFACT] `packages/brain/src/__tests__/migration-266.test.js` 创建
- [x] [BEHAVIOR] tests/migration-266: 6 个 it 全过（UPDATE 目标 / jsonb_set 路径 / 新 fallback / WHERE 精确 / 不动其他 agent / 背景注释）

## 受影响文件

- `packages/brain/migrations/266_mouth_fallback_oauth_only.sql`
- `packages/brain/src/__tests__/migration-266.test.js`

## 部署后验证

merge + Brain 重启（自动 apply migration）后：
1. `psql -d cecelia -c "SELECT config->'mouth'->'fallbacks' FROM model_profiles WHERE is_active=true;"` 返回 `[{"model":"claude-haiku-4-5-20251001","provider":"anthropic"}]`
2. `tail logs/brain-error.log | grep "mouth.*失败"` 显著减少
