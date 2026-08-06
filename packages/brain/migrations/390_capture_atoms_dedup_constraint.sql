-- Migration 390: capture_atoms (capture_id, target_type) UNIQUE 约束
-- 修复 F6加厚 遗留 bug：pushCapture 对 capture_atoms 无幂等处理
--
-- 注意：若生产库已有重复数据，migration 前需先去重（保留最旧一行）。
-- 去重脚本（migration 执行前手动运行）：
--   DELETE FROM capture_atoms
--   WHERE id NOT IN (
--     SELECT DISTINCT ON (capture_id, target_type) id
--     FROM capture_atoms
--     ORDER BY capture_id, target_type, created_at ASC
--   );

ALTER TABLE capture_atoms
  ADD CONSTRAINT uq_capture_atoms_capture_target
  UNIQUE (capture_id, target_type);

INSERT INTO schema_version (version, description)
VALUES ('390', 'capture_atoms unique(capture_id,target_type) — F6加厚幂等修复')
ON CONFLICT (version) DO NOTHING;
