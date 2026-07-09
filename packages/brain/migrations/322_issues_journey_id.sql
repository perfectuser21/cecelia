-- Migration 322: issues.journey_id — 关联 issue 到所属 Journey
-- issues 表原先无 journey_id，导致 warroom Line 指挥页无法展示关联 issue

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_journey_id ON issues (journey_id) WHERE journey_id IS NOT NULL;

COMMENT ON COLUMN issues.journey_id IS '所属 Journey ID（可为 NULL，空 = 系统级 issue）';
