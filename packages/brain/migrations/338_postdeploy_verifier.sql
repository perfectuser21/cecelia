-- Migration 338: 第5环部署验证支撑索引
-- 背景：五环机器化（2026-07-12 决策），pending_postdeploy 状态 + postdeploy-verifier tick job
-- 本迁移只加索引（tasks.status 是自由文本列，无需 ALTER TABLE）。

-- 加速 postdeploy-verifier 的批量扫描查询（按 updated_at 排序取最早的 pending 任务）
CREATE INDEX IF NOT EXISTS idx_tasks_pending_postdeploy
  ON tasks (updated_at ASC)
  WHERE status = 'pending_postdeploy';

INSERT INTO schema_version (version, description)
VALUES ('338', 'Add pending_postdeploy index for fifth-ring deploy verifier')
ON CONFLICT (version) DO NOTHING;
