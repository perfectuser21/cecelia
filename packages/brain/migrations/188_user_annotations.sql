-- Migration 188: user_annotations 表
-- 用户对任意记录的标注/备注（多态）

CREATE TABLE IF NOT EXISTS user_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('dev_record', 'decision', 'design_doc')),
  entity_id UUID NOT NULL,
  field_path TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_annotations_entity ON user_annotations(entity_type, entity_id);
