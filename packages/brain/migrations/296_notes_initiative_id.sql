-- Migration 296: notes 表加 initiative_id 列，关联 initiative_runs
-- 用途：harness-report 写 PrepPRD/Contract/Report Notes 时记录来源 Sprint，
--       支持按 initiative 查询该次 Run 产生的所有 Notes。

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiative_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_initiative_id ON notes(initiative_id);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('296', 'notes: add initiative_id FK to initiative_runs', NOW())
ON CONFLICT (version) DO NOTHING;
