-- 回滚 551：只回状态（留痕 task_events 保留，不删）。仅当两条仍是 551 写下的终态时才回退。
BEGIN;
UPDATE tasks SET status = 'queued', completed_at = NULL, error_message = NULL, updated_at = NOW()
 WHERE id = 'a55c7664-befc-4083-b4a1-690fed30e7f6' AND status = 'cancelled'
   AND error_message LIKE 'no_executor_for_task_type:%';
UPDATE tasks SET status = 'in_progress', completed_at = NULL, error_message = NULL,
       result = result - 'fail_reason' - 'factory_dispatcher', updated_at = NOW()
 WHERE id = '02383d3f-f77b-41b9-97e5-686bcc1e125d' AND status = 'failed'
   AND error_message LIKE 'dispatcher_watch_lost:%';
DELETE FROM schema_version WHERE version = '551';
COMMIT;
