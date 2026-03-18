-- Migration 157: 切换 thalamus 模型从 MiniMax M2.5-highspeed 到 gpt-5.4-mini
-- 影响 model_profiles 表中所有使用 MiniMax-M2.5-highspeed 作为 thalamus 模型的 profile

UPDATE model_profiles
SET config = jsonb_set(config, '{thalamus}', '{"model": "gpt-5.4-mini", "provider": "openai"}'::jsonb),
    updated_at = NOW()
WHERE config->'thalamus'->>'model' = 'MiniMax-M2.5-highspeed';
