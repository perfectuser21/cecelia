-- Migration 152: profile-anthropic cortex.provider 切换为 anthropic-api
-- 直连 Anthropic REST API（走 API key，速度快 5-8x，无 bridge 中间层）

UPDATE model_profiles
SET config = jsonb_set(config, '{cortex,provider}', '"anthropic-api"'),
    updated_at = NOW()
WHERE id = 'profile-anthropic';

-- 记录 migration 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('152', 'profile-anthropic cortex.provider 切换为 anthropic-api（直连快 5-8x）', NOW())
ON CONFLICT (version) DO NOTHING;
