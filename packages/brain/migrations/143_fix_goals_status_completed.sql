-- Migration 143: 批量修正虚标 KR status
-- 将 progress>=100 但 status 仍为 in_progress 的 goals 更新为 completed
-- 背景：有 11 个 goals 记录 progress=100 但 status 仍为 in_progress，导致汇报失真、规划误判

UPDATE goals
SET status = 'completed',
    updated_at = NOW()
WHERE progress >= 100
  AND status = 'in_progress';
