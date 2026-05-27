-- Migration 285: initiative_runs.journey_id — 关联 journey 到 harness run
-- 用途：记录该次 harness pipeline run 属于哪条 Journey，供事后追溯
-- journey_id 可为 NULL（旧数据 + 未指定 journey 的 run 均允许）

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS journey_id UUID NULL;

COMMENT ON COLUMN initiative_runs.journey_id IS
  '所属 Journey ID（来自 task.payload.journey_id，可为 NULL）';
