-- Migration 316: design_docs type 白名单加 battle_report
-- 原约束（Migration 195）：11 种白名单
-- 新约束：11 种 + battle_report（每日作战日报，battle-report.js 写入）

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
      'battle_report'
    ));
