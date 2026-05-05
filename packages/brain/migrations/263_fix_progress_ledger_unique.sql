-- Migration 263: fix progress_ledger missing UNIQUE constraint
-- 背景：088_progress_ledger.sql 建表时漏掉 UNIQUE(task_id, run_id, step_sequence)，
-- 导致 progress-ledger.js 里的 ON CONFLICT 子句每次都报
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"。
-- 该错误被 callback-processor.js catch 块吞掉，progress_ledger 步骤记录永远写不进去。
-- Spec: docs/superpowers/specs/2026-05-05-fix-progress-ledger-unique-constraint-design.md

DO $$ BEGIN
    ALTER TABLE progress_ledger
        ADD CONSTRAINT uk_progress_ledger_step
        UNIQUE (task_id, run_id, step_sequence);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
