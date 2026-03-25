-- Migration 192: 知识文档系统 — 补全 author/made_by 字段
-- 给 decisions/learnings/knowledge/dev_records/ideas 各表加 author 和 made_by 字段
-- author: 写入者名字（'user'/'cecelia'/'system'）
-- made_by: 发起方（'user'=人类发起, 'cecelia'=AI自主, 'system'=系统自动）

-- decisions 表：加 author/made_by/priority/area/alternatives/decided_at
ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS made_by VARCHAR(20) NOT NULL DEFAULT 'system'
    CHECK (made_by IN ('user', 'cecelia', 'system')),
  ADD COLUMN IF NOT EXISTS priority VARCHAR(4) NOT NULL DEFAULT 'P2'
    CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS alternatives TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- learnings 表：加 author/made_by
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS made_by VARCHAR(20) NOT NULL DEFAULT 'cecelia'
    CHECK (made_by IN ('user', 'cecelia', 'system'));

-- knowledge 表：加 author/made_by
ALTER TABLE knowledge
  ADD COLUMN IF NOT EXISTS author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS made_by VARCHAR(20) NOT NULL DEFAULT 'system'
    CHECK (made_by IN ('user', 'cecelia', 'system'));

-- dev_records 表：加 author
ALTER TABLE dev_records
  ADD COLUMN IF NOT EXISTS author VARCHAR(32) NOT NULL DEFAULT 'cecelia';

-- ideas 表：加 author/made_by
ALTER TABLE ideas
  ADD COLUMN IF NOT EXISTS author VARCHAR(32) NOT NULL DEFAULT 'cecelia',
  ADD COLUMN IF NOT EXISTS made_by VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (made_by IN ('user', 'cecelia', 'system'));

-- 索引：decisions 按 made_by 过滤
CREATE INDEX IF NOT EXISTS idx_decisions_made_by ON decisions(made_by);
CREATE INDEX IF NOT EXISTS idx_decisions_author ON decisions(author);
CREATE INDEX IF NOT EXISTS idx_decisions_priority ON decisions(priority);
