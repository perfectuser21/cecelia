-- Migration 489: recurring_tasks.skip_streak（定时引擎复活，任务 3d0db274）
--
-- 叠单跳过计数：到点时同模板已有 queued/in_progress/paused/blocked 实例 → 不建单、last_run_status='skipped_overlap'、
-- skip_streak+1，连续 3 次告警；成功建单归 0。recurring.js runRecurringTasksJob 读写。

ALTER TABLE recurring_tasks
  ADD COLUMN IF NOT EXISTS skip_streak integer NOT NULL DEFAULT 0;

INSERT INTO schema_version (version, description)
VALUES ('489', 'recurring_tasks.skip_streak：定时引擎叠单跳过计数（任务 3d0db274）')
ON CONFLICT (version) DO NOTHING;
