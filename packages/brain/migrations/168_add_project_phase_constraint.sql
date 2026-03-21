-- Migration 168: projects.current_phase CHECK 约束 + 初始 roadmap 数据
-- Version: 168
-- Date: 2026-03-21
-- Description: 为 current_phase 添加 CHECK 约束（now/next/later/plan），
--              并根据 status + sequence_order 设置现有 projects 的初始 phase

-- 1. 添加 CHECK 约束（兼容已有 plan 值）
ALTER TABLE projects ADD CONSTRAINT projects_phase_check
  CHECK (current_phase IN ('now', 'next', 'later', 'plan') OR current_phase IS NULL);

-- 2. 根据 status 和 sequence_order 设置初始 phase（仅影响 current_phase IS NULL 的行）
UPDATE projects SET current_phase = 'now'
  WHERE status = 'active' AND sequence_order <= 2 AND current_phase IS NULL;

UPDATE projects SET current_phase = 'next'
  WHERE status IN ('active', 'pending') AND sequence_order BETWEEN 3 AND 5 AND current_phase IS NULL;

UPDATE projects SET current_phase = 'later'
  WHERE status = 'pending' AND sequence_order > 5 AND current_phase IS NULL;

-- schema version
INSERT INTO schema_version (version, description)
VALUES ('168', 'Add CHECK constraint to projects.current_phase + seed initial roadmap phases')
ON CONFLICT (version) DO NOTHING;
