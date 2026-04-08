-- Migration 226: solo-company-case 补充 notebook_id
-- 原 YAML 配置已有 notebook_id: 1d928181-4462-47d4-b4c0-89d3696344ab
-- 但 DB content_type_configs 未同步，导致 pipeline 走 LLM 降级路径

UPDATE content_type_configs
SET config = config || '{"notebook_id": "1d928181-4462-47d4-b4c0-89d3696344ab"}'::jsonb,
    updated_at = NOW(),
    updated_by = 'migration-226'
WHERE content_type = 'solo-company-case'
  AND (config->>'notebook_id') IS NULL;
