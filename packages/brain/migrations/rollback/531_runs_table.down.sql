-- 531 回滚：拆掉汇总视图、触发器、spans 新列与外键、runs 表（runs 里的定时任务运行记录随之丢弃；spans 不受影响）
BEGIN;

DROP VIEW IF EXISTS v_activity_span_stats;
DROP VIEW IF EXISTS v_workflow_run_stats;

DROP TRIGGER IF EXISTS spans_rollup_run ON spans;
DROP TRIGGER IF EXISTS spans_ensure_run ON spans;
DROP FUNCTION IF EXISTS spans_rollup_run();
DROP FUNCTION IF EXISTS spans_ensure_run();

ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_run_id_fkey;
DROP INDEX IF EXISTS idx_spans_parent;
ALTER TABLE spans DROP COLUMN IF EXISTS span_level;
ALTER TABLE spans DROP COLUMN IF EXISTS parent_span_id;

DROP TABLE IF EXISTS runs;

DELETE FROM schema_version WHERE version = '531';

COMMIT;
