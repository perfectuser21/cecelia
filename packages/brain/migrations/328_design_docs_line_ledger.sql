-- Migration 328: design_docs 加 line_ledger 类型 + journey_id 列
-- dreaming L1：line 级夜间蒸馏 job 落库用。

ALTER TABLE design_docs
  DROP CONSTRAINT IF EXISTS design_docs_type_check;

ALTER TABLE design_docs
  ADD CONSTRAINT design_docs_type_check
    CHECK (type IN (
      'diary',
      'research',
      'architecture',
      'proposal',
      'analysis',
      'meeting',
      'strategy',
      'roadmap',
      'retrospective',
      'idea',
      'context',
      'battle_report',
      'line_ledger'
    ));

ALTER TABLE design_docs
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_design_docs_journey_id
  ON design_docs (journey_id) WHERE journey_id IS NOT NULL;
