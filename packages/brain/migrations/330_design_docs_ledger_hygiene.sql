-- Migration 330: design_docs.type CHECK 加 'ledger_hygiene'
-- 账本保鲜守卫（九要素 T1）每晚卫生分落库用。先例：328 加 line_ledger 同法。

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
      'ledger_hygiene'
    ));
