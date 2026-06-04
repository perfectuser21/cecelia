-- Migration 293: initiative_run_events phase metrics columns
-- 给 initiative_run_events 加 ts_end / cost_usd / model 三列
-- 扩展 status CHECK 接受 'completed'（原有 running/done/failed 保留）

ALTER TABLE initiative_run_events
  ADD COLUMN IF NOT EXISTS ts_end   BIGINT,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS model    TEXT;

ALTER TABLE initiative_run_events
  DROP CONSTRAINT IF EXISTS initiative_run_events_status_check;

ALTER TABLE initiative_run_events
  ADD CONSTRAINT initiative_run_events_status_check
    CHECK (status IN ('running', 'done', 'failed', 'completed'));
