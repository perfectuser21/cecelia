-- Migration 309: component_evolutions 添加 source_repo 字段
-- evolution-scanner.js 用 source_repo + pr_number 联合去重，表中缺此列导致 scanner_stale

ALTER TABLE component_evolutions
  ADD COLUMN IF NOT EXISTS source_repo VARCHAR(100);

-- 历史数据补默认值（scanner 只写 'cecelia'）
UPDATE component_evolutions SET source_repo = 'cecelia' WHERE source_repo IS NULL;

-- 为去重查询加索引
CREATE INDEX IF NOT EXISTS idx_component_evolutions_source_pr
  ON component_evolutions(source_repo, pr_number);
