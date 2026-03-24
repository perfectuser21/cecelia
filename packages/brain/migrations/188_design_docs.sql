-- Migration 188: design_docs 表
-- 设计文档存档 + 每日日报（type='diary'）

CREATE TABLE IF NOT EXISTS design_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(32) NOT NULL CHECK (type IN ('diary', 'research', 'architecture', 'proposal', 'analysis')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'adopted', 'rejected', 'shelved')),
  area TEXT,
  tags TEXT[],
  author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  diary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_docs_type ON design_docs(type);
CREATE INDEX IF NOT EXISTS idx_design_docs_diary_date ON design_docs(diary_date DESC) WHERE type = 'diary';
CREATE INDEX IF NOT EXISTS idx_design_docs_created_at ON design_docs(created_at DESC);
