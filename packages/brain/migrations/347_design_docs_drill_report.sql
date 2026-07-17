-- Migration 347: design_docs.type CHECK 加 'drill_report'
-- canary-death-drill.mjs 落档演习结果时写 type='drill_report'，此前 CHECK 约束缺失导致 500。

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
      'line_ledger',
      'ledger_hygiene',
      'drill_report'
    ));
