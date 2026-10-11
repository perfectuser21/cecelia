-- 迁移 551（任务 0a70684f，派发总闸 F）：清理生产里无人领的卡死单。
--
-- 先列清单再动（2026-10-12 00:40 上海时间，经 GET /api/brain/tasks?status=queued 逐条核对 83 条 queued）：
--   救（550 已按规则迁新类型，本文件不重复）：
--     c8fab3c8-c85e-4e7e-a610-ce776c4aefe2  data + coding_workflow，漏 headed_manual，runner 不认、tick 也不派 → coding_workflow
--   处置（本文件）：
--     a55c7664-befc-4083-b4a1-690fed30e7f6  trigger_backup queued 自 10-10 18:00Z：location=us 落已退役 Claude 桥接，
--       全仓无 trigger_backup 执行者（真备份由 MMV launchd com.cecelia.backup-db 承担）→ cancelled
--     02383d3f-f77b-41b9-97e5-686bcc1e125d  技能工厂执行单 in_progress 自 10-11 14:08Z：factory-dispatcher 14:00Z
--       「本轮异常：fetch failed」中断守望，会话已退出且已写 result.delivery（claimed_result=blocked，lock_released=true），
--       派发器只看 queued 不会再回来收，按派发器自己的规则（会话退出无终态 → failed）收成 failed；
--       它占着推进器「在途」位，不收则该台账永远不建下一轮。
--   不动（不是路由问题，留给 handoff）：d2c33328（有头接管单，manual_takeover，问题仍复现）、cc7a4410（磁盘告警，
--     内联 handler 路由有效）、0f376d48（script_run 路由有效）、content-pipeline ×5（ZJ pipeline-worker 自领）、
--     project 容器行、其余 headed_manual 人工待办。
-- 每条处置按 id + 当前状态守卫（状态已变则空操作，幂等），并写 task_events（dispatch_gate_cleanup）。
-- 回滚：见 rollback/551（只回状态，不删留痕）。
BEGIN;

WITH done AS (
  UPDATE tasks
     SET status = 'cancelled',
         completed_at = NOW(),
         updated_at = NOW(),
         error_message = 'no_executor_for_task_type: trigger_backup 无可用执行者（location=us 落已退役 Claude 桥接）；派发总闸 F 清理（任务 0a70684f）'
   WHERE id = 'a55c7664-befc-4083-b4a1-690fed30e7f6'
     AND task_type = 'trigger_backup'
     AND status = 'queued'
  RETURNING id
)
INSERT INTO task_events (task_id, event_type, payload, created_at)
SELECT id, 'dispatch_gate_cleanup', jsonb_build_object(
  'action', 'cancelled', 'from_status', 'queued', 'migration', '551', 'task', '0a70684f',
  'reason', 'trigger_backup 无可用执行者：location=us 落已退役 Claude 桥接，queued 无人领；真备份由 MMV launchd com.cecelia.backup-db 承担'), NOW()
  FROM done;

WITH done AS (
  UPDATE tasks
     SET status = 'failed',
         completed_at = NOW(),
         updated_at = NOW(),
         error_message = 'dispatcher_watch_lost: factory-dispatcher 守望中断（fetch failed），会话已交付 blocked；派发总闸 F 清理（任务 0a70684f）',
         result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
           'fail_reason', 'dispatcher_watch_lost: factory-dispatcher 2026-10-11T14:00Z 本轮异常 fetch failed 中断守望；会话已退出并写 result.delivery（claimed_result=blocked），无终态',
           'factory_dispatcher', jsonb_build_object('watch_lost_at', '2026-10-11T14:00:15Z', 'cleanup', 'migration 551'))
   WHERE id = '02383d3f-f77b-41b9-97e5-686bcc1e125d'
     AND status = 'in_progress'
     AND result ? 'delivery'
  RETURNING id
)
INSERT INTO task_events (task_id, event_type, payload, created_at)
SELECT id, 'dispatch_gate_cleanup', jsonb_build_object(
  'action', 'failed', 'from_status', 'in_progress', 'migration', '551', 'task', '0a70684f',
  'reason', 'factory-dispatcher 守望中断后无人收的执行单：会话已交付 blocked，按派发器「会话退出无终态 → failed」规则收口，放开推进器在途位'), NOW()
  FROM done;

INSERT INTO schema_version (version, description)
VALUES ('551', '派发总闸 F：清理无人领卡死单（a55c7664 cancelled / 02383d3f failed），逐条写 task_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
