-- Migration 233: 修复 thalamus provider — bridge → anthropic-api
-- 根因：claude -p bridge 以 exit code 1 退出，导致内容审核链路 Bridge /llm-call 500 错误
-- 解决：thalamus 改用 anthropic-api 直连 REST（稳定，无 CLI 依赖）
-- 同时将模型降为 haiku（审核场景无需 sonnet，速度更快）
-- 并添加 fallbacks 配置，让 callLLM 在 anthropic-api 失败时自动降级到 bridge

-- Step 1: 修正 thalamus provider + model
UPDATE model_profiles
SET config = jsonb_set(
  jsonb_set(
    config,
    '{thalamus,provider}',
    '"anthropic-api"'
  ),
  '{thalamus,model}',
  '"claude-haiku-4-5-20251001"'
)
WHERE id = 'profile-anthropic';

-- Step 2: 添加 fallbacks（bridge 作为降级）
UPDATE model_profiles
SET config = jsonb_set(
  config,
  '{thalamus,fallbacks}',
  '[{"provider": "anthropic", "model": "claude-haiku-4-5-20251001"}]'::jsonb
)
WHERE id = 'profile-anthropic';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('233', 'Fix thalamus provider: bridge→anthropic-api，消除内容审核 /llm-call 500 错误', NOW())
ON CONFLICT (version) DO NOTHING;
