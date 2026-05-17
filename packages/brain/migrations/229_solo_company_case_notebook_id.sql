-- Migration 229: solo-company-case 补充 notebook_id
-- 原 YAML 配置已有 notebook_id: 1d928181-4462-47d4-b4c0-89d3696344ab
-- 但 DB content_type_configs 未同步，导致 pipeline 走 LLM 降级路径
-- (原为 228，因冲突重命名为 229)

UPDATE content_type_configs
SET config = config || '{"notebook_id": "1d928181-4462-47d4-b4c0-89d3696344ab"}'::jsonb,
    updated_at = NOW(),
    updated_by = 'migration-229'
WHERE content_type = 'solo-company-case'
  AND (config->>'notebook_id') IS NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('229', 'solo-company-case: add notebook_id to content_type_configs', NOW())
ON CONFLICT (version) DO NOTHING;
