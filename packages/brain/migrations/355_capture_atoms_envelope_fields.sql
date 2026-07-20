-- migration 355: capture_atoms 扩展字段
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS nature VARCHAR(50);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS repo VARCHAR(100);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS lane VARCHAR(100);
ALTER TABLE capture_atoms ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- 删除旧 check（如有）
ALTER TABLE capture_atoms DROP CONSTRAINT IF EXISTS capture_atoms_status_extended_check;
-- 扩展 status check，加 parked/routed/enriched
ALTER TABLE capture_atoms ADD CONSTRAINT capture_atoms_status_extended_check
  CHECK (status IN ('pending_review','pending','confirmed','dismissed','dropped','parked','routed','enriched'));

-- 迁移：ai_reason LIKE '[triage:%' 且 status='pending_review' → parked
UPDATE capture_atoms
  SET status = 'parked'
  WHERE status = 'pending_review' AND ai_reason LIKE '[triage:%';
