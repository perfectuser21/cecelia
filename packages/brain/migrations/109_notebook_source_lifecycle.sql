-- Migration 109: synthesis_archive notebook_source_id — source 生命周期追踪
-- 存储写入 NotebookLM 时返回的 source_id，用于后续删除和对账

ALTER TABLE synthesis_archive ADD COLUMN IF NOT EXISTS notebook_source_id VARCHAR(255);

COMMENT ON COLUMN synthesis_archive.notebook_source_id IS
  'NotebookLM 返回的 source UUID，用于生命周期管理（删除/对账）';
