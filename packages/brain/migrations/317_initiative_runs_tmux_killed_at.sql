-- Migration 316: initiative_runs 收窗幂等字段 — tmux_killed_at
--
-- 背景（codex-headed-dispatch sprint）：
--   headed 模式下 Brain watchdog 在 run 进入终态 30 分钟后负责 kill 宿主 tmux session。
--   为保证幂等（不重复 kill），需记录 kill 完成时间戳。
--   tmux_killed_at 非空 = 该 run 的 tmux session 已被 watchdog 清理，二次触发直接跳过。

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS tmux_killed_at TIMESTAMPTZ;

COMMENT ON COLUMN initiative_runs.tmux_killed_at IS 'watchdog 执行 tmux kill-session 完成时间戳（headed 模式专用）；非空表示已收窗，幂等保护：watchdog 见此字段非空则跳过 kill';

CREATE INDEX IF NOT EXISTS idx_initiative_runs_tmux_killed_at
  ON initiative_runs(tmux_killed_at)
  WHERE tmux_killed_at IS NOT NULL;
