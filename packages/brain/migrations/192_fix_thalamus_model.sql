-- Migration 192: 修复 profile-anthropic thalamus 模型配置
-- 问题：migration 159 将 thalamus 切换为 gpt-5.4-mini（codex/openai），
--       导致 codex team OAuth quota 耗尽时 self-drive cycle 全部失败
-- 修复：将 profile-anthropic 的 thalamus 重置为 anthropic claude-haiku-4-5-20251001

UPDATE model_profiles
SET config = jsonb_set(config, '{thalamus}', '{"model": "claude-haiku-4-5-20251001", "provider": "anthropic"}'::jsonb),
    updated_at = NOW()
WHERE name = 'profile-anthropic'
  AND config->'thalamus'->>'provider' != 'anthropic';
