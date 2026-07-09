-- Migration 322: issues.journey_id — 关联 issue 到 Journey
-- journey_id 可为 NULL（旧数据 + 未指定 journey 的 issue 均允许）

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_journey_id ON issues (journey_id) WHERE journey_id IS NOT NULL;

COMMENT ON COLUMN issues.journey_id IS '所属 Journey ID；warroom 指挥页连接全景图"open_issues"查此列';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('322', 'issues: add journey_id column', NOW())
ON CONFLICT (version) DO NOTHING;
