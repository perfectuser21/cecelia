-- Migration 247: 修复 rumination agent 的 provider 配置
-- 问题：rumination 被设置为 codex provider，但 Codex OAuth 账号不可用且无 OpenAI API key，
--       导致 PROBE_FAIL_RUMINATION (degraded_llm_failure)。
-- 修复：将活跃 profile 中的 rumination 改为 anthropic-api + haiku，
--       并为未配置 rumination 的 profile 补充默认值。

-- 1. 将已设置为 codex/openai provider 的 rumination 改回 anthropic-api
UPDATE model_profiles
SET config = jsonb_set(
  config,
  '{rumination}',
  '{"provider": "anthropic-api", "model": "claude-haiku-4-5-20251001", "fallbacks": [{"provider": "anthropic", "model": "claude-haiku-4-5-20251001"}]}'::jsonb
),
updated_at = NOW()
WHERE is_active = true
  AND (
    config->'rumination'->>'provider' IN ('codex', 'openai')
    OR config->'rumination'->>'model' LIKE 'codex/%'
  );

-- 2. 为活跃 profile 中没有 rumination 配置的情况补充默认值
UPDATE model_profiles
SET config = config || '{"rumination": {"provider": "anthropic-api", "model": "claude-haiku-4-5-20251001", "fallbacks": [{"provider": "anthropic", "model": "claude-haiku-4-5-20251001"}]}}'::jsonb,
    updated_at = NOW()
WHERE is_active = true
  AND NOT (config ? 'rumination');

INSERT INTO schema_version (version) VALUES ('247')
ON CONFLICT (version) DO NOTHING;
