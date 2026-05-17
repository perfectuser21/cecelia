-- Migration 197: 建立 captures 表 + owner 字段
-- captures 表：统一收件箱，支持多来源用户数据捕获
-- owner 字段：区分用户数据 vs Cecelia 系统数据

-- ===================== Table: captures =====================
CREATE TABLE IF NOT EXISTS captures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content      TEXT NOT NULL,
  source       VARCHAR(50) NOT NULL DEFAULT 'dashboard',
    -- dashboard / feishu / diary / api
  status       VARCHAR(20) NOT NULL DEFAULT 'inbox',
    -- inbox / processing / done / archived
  area_id      UUID REFERENCES areas(id) ON DELETE SET NULL,
  project_id   UUID REFERENCES okr_projects(id) ON DELETE SET NULL,
  extracted_to JSONB NOT NULL DEFAULT '{}',
  owner        VARCHAR(20) NOT NULL DEFAULT 'user',
    -- user / cecelia
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
CREATE INDEX IF NOT EXISTS idx_captures_source ON captures(source);
CREATE INDEX IF NOT EXISTS idx_captures_owner ON captures(owner);
CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_area_id ON captures(area_id) WHERE area_id IS NOT NULL;

-- ===================== owner 字段：区分用户数据 vs 系统数据 =====================
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS owner VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS owner VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE key_results
  ADD COLUMN IF NOT EXISTS owner VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE okr_projects
  ADD COLUMN IF NOT EXISTS owner VARCHAR(20) NOT NULL DEFAULT 'user';

-- 更新 trigger 以维护 captures.updated_at
CREATE OR REPLACE FUNCTION update_captures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS captures_updated_at ON captures;
CREATE TRIGGER captures_updated_at
  BEFORE UPDATE ON captures
  FOR EACH ROW EXECUTE FUNCTION update_captures_updated_at();
