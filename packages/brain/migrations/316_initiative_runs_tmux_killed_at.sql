-- Migration 316: initiative_runs 新增 tmux_killed_at 列
-- Sprint: sprints/07071654-codex-headed-dispatch
-- task_id: 4cedf175-3b56-4d41-91b6-73de559f58c9
--
-- 用途：headed（tmux）模式收窗幂等标记。
-- run 终态后 kill-session 前设置此列；再次触发收窗时检测到非 NULL，直接跳过，
-- 防止重复 ssh kill-session（收窗幂等，B-05 合同要求）。
-- additive + 幂等。

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS tmux_killed_at TIMESTAMPTZ;

COMMENT ON COLUMN initiative_runs.tmux_killed_at
  IS 'headed 模式：tmux session 已被 kill-session 的时间戳；非 NULL = 已收窗，跳过重复 kill（幂等）';
