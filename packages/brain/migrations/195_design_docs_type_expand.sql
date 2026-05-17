-- Migration 194: 放开 design_docs 的 type CHECK 约束
-- 原约束：diary/research/architecture/proposal/analysis（5种）
-- 新约束：增加 meeting/strategy/roadmap/retrospective/idea/context（共11种）

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
      'context'
    ));
