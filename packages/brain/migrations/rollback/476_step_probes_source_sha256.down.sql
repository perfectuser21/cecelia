-- 回滚 476：摘掉 step_probes.source_sha256（可空列，无数据依赖）。
BEGIN;
ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_source_sha256_check;
ALTER TABLE step_probes DROP COLUMN IF EXISTS source_sha256;
DELETE FROM schema_version WHERE version = '476';
COMMIT;
