-- Migration 292: tasks 加 driver_heartbeat_at（OPEN-2 harness 驱动器心跳）
--
-- 根因：harness_initiative parent graph 在 planner interrupt 后，由 planner-callback
-- 的一次性 in-memory invoke 同步驱动到 END（ganLoop 数分钟 + run_sub_task 最长 90min）。
-- 驱动器丢失（brain 重启/部署/异常）后，任务 park 在非-END checkpoint：dispatcher 只
-- claim queued、唯一 re-driver startup-sync 仅 boot 跑 → 任务死等下次重启（48 条卡 B_task_loop）。
--
-- 修法：活驱动（executor stream loop / run_sub_task poll）每 ~30s 刷 driver_heartbeat_at，
-- tick 级看门狗据此判断驱动器是否还活着，只重排心跳陈旧(>3min)且停在 B_task_loop 的任务。

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS driver_heartbeat_at TIMESTAMPTZ;

-- 看门狗按 (task_type, status, driver_heartbeat_at) 扫陈旧驱动，建偏索引加速。
CREATE INDEX IF NOT EXISTS idx_tasks_harness_driver_heartbeat
  ON tasks (driver_heartbeat_at)
  WHERE task_type = 'harness_initiative' AND status = 'in_progress';

INSERT INTO schema_version (version, description)
VALUES ('292', 'tasks 加 driver_heartbeat_at（OPEN-2 harness 驱动器心跳看门狗）')
ON CONFLICT (version) DO NOTHING;
