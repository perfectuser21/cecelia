-- Migration 267: DB schema drift recovery
--
-- 背景：
--   两处 schema 漂移导致 brain-error.log 持续报错（non-fatal 但污染 metrics）：
--
--   1. progress_ledger 缺 UNIQUE(task_id, run_id, step_sequence)
--      之前的 264_fix_progress_ledger_unique.sql 没 apply（schema_version 表
--      记录 264 已 apply，实际是同号的 264_failure_type_dispatch_constraint.sql；
--      migration runner alphabetical 顺序跑第一个文件后 schema_version 标 done，
--      跳过第二个 264 文件）。
--      表现：[execution-callback] Progress step recording failed:
--             there is no unique or exclusion constraint matching ON CONFLICT
--
--   2. task_execution_metrics 表完全不存在（routes/execution.js 期望写入此表）
--      表现：[execution-callback] task_execution_metrics write failed (non-fatal):
--             relation "task_execution_metrics" does not exist
--
-- 修复：
--   - 用 IF NOT EXISTS / EXCEPTION 块保证 idempotent，重复 apply 不报错
--   - 兜底 264_fix_progress_ledger_unique，加 UNIQUE constraint
--   - 创建 task_execution_metrics 表 + 必要索引

-- ============================================================
-- Part 1: progress_ledger UNIQUE constraint （兜底 264_fix）
-- ============================================================

DO $$ BEGIN
    ALTER TABLE progress_ledger
        ADD CONSTRAINT uk_progress_ledger_step
        UNIQUE (task_id, run_id, step_sequence);
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
END $$;

-- ============================================================
-- Part 2: task_execution_metrics 表
-- ============================================================
-- 字段对齐 routes/execution.js:458 INSERT 语句：
-- (task_id, account_id, duration_ms, est_requests, status)

CREATE TABLE IF NOT EXISTS task_execution_metrics (
    id SERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    account_id TEXT,
    duration_ms INTEGER,
    est_requests NUMERIC(10, 2),
    status TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_execution_metrics_task
    ON task_execution_metrics (task_id);

CREATE INDEX IF NOT EXISTS idx_task_execution_metrics_created
    ON task_execution_metrics (created_at);

CREATE INDEX IF NOT EXISTS idx_task_execution_metrics_account
    ON task_execution_metrics (account_id) WHERE account_id IS NOT NULL;
