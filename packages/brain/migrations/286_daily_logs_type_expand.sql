-- Migration 286: Expand daily_logs.type to VARCHAR(50) and add nightly types
-- 根因: daily_logs.type 是 VARCHAR(20)，'nightly_orchestration'(21字符) 超出 + 不在 CHECK 约束内
-- → NightlyOrchestrator 每次夜间 cycle 后报 "value too long for type character varying(20)"

ALTER TABLE daily_logs ALTER COLUMN type TYPE VARCHAR(50);

ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_type_check;

ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_type_check
  CHECK (type IN ('repo', 'summary', 'nightly_orchestration', 'consolidation', 'nightly_tick'));

COMMENT ON COLUMN daily_logs.type IS
  'Log type: repo/summary/nightly_orchestration/consolidation/nightly_tick (VARCHAR(50) after migration 286)';
