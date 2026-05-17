-- Migration 266: 移除 mouth fallback 中失效的 codex / anthropic-api 凭据
--
-- 背景：
--   - codex CLI refresh token 失效（401 Unauthorized）
--   - anthropic-api 信用余额 = 0（400 invalid_request_error）
--   - 现 mouth 调用主路径 anthropic bridge 8s timeout 后 fallback 到这两个失效 provider，
--     全部失败导致 mouth 整体失败，触发 cecelia-run 熔断 526 次。
--
-- 修复：
--   mouth.fallbacks 改为 [{provider: anthropic, model: haiku}]（同 OAuth bridge，sonnet 失败 fallback haiku）
--   完全脱离失效的 codex / anthropic-api 依赖。
--
-- 影响：
--   只更新含 codex 或 anthropic-api fallback 的 profile，不动其他 agent 配置。
--   其他 agent（cortex / reflection / rumination 等）primary 是 anthropic-api 的
--   仍按原配置运行（如果信用 0 自然报错，由 implicit fallback 兜底）。
--
-- 验证：
--   SELECT name, config->'mouth'->'fallbacks' FROM model_profiles WHERE is_active=true;

UPDATE model_profiles
SET config = jsonb_set(
  config,
  '{mouth,fallbacks}',
  '[{"model":"claude-haiku-4-5-20251001","provider":"anthropic"}]'::jsonb,
  true
)
WHERE config ? 'mouth'
  AND (
    config->'mouth'->'fallbacks' @> '[{"provider":"codex"}]'::jsonb
    OR config->'mouth'->'fallbacks' @> '[{"provider":"anthropic-api"}]'::jsonb
  );
