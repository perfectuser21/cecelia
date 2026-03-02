-- Migration 100: Alex 个人数据表
-- 扩展 areas 表，新增 ideas、knowledge 两张表，并为 notes 表加 owner 字段
-- 这些表与 OKR（goals/projects/tasks）共享 cecelia 数据库

-- ============================================================
-- 1. areas 表扩展
--    000_base_schema.sql 已建 areas 表（OKR 用途），这里只补 Alex 个人字段
--    domain: 生活领域分类（Study / Life / Work / System）
--    archived: 是否归档
--    notion_id: Notion page ID，用于同步追踪
--    updated_at: 更新时间
-- ============================================================
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS domain    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS archived  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notion_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- UNIQUE 约束（notion_id 不重复），用 DO $$ 保证幂等
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'areas_notion_id_key'
  ) THEN
    ALTER TABLE areas ADD CONSTRAINT areas_notion_id_key UNIQUE (notion_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_areas_domain   ON areas (domain);
CREATE INDEX IF NOT EXISTS idx_areas_archived ON areas (archived) WHERE archived = false;

-- ============================================================
-- 2. ideas - 灵感捕获（对应 Notion XX_Ideas database）
-- ============================================================
CREATE TABLE IF NOT EXISTS ideas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT,
  intent_type VARCHAR(30),                -- Task / Project Note / Knowledge Notes / Daily Notes / Content
  status      VARCHAR(30) DEFAULT 'Capture', -- Capture / AI Analysis / Selection Done / Subideas Created / Dropped / Done
  area_id     UUID REFERENCES areas(id) ON DELETE SET NULL,
  parent_id   UUID REFERENCES ideas(id) ON DELETE SET NULL,
  notion_id   VARCHAR(100) UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ideas_status      ON ideas (status);
CREATE INDEX IF NOT EXISTS idx_ideas_intent_type ON ideas (intent_type);
CREATE INDEX IF NOT EXISTS idx_ideas_area_id     ON ideas (area_id);

-- ============================================================
-- 3. knowledge - 操作性知识（对应 Notion Knowledge_Operational）
--    存 Alex 自己的框架、提示词、流程、模板
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        VARCHAR(30),                -- Template / Framework / Prompt / Process / Documentation / Skill
  status      VARCHAR(20) DEFAULT 'Draft', -- Draft / Active / Archived
  sub_area    VARCHAR(60),                -- AI Workflow / Prompting / Social Media Strategy / Business Strategy 等
  content     TEXT,
  version     VARCHAR(10),
  changelog   TEXT,
  area_id     UUID REFERENCES areas(id) ON DELETE SET NULL,
  notion_id   VARCHAR(100) UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_type     ON knowledge (type);
CREATE INDEX IF NOT EXISTS idx_knowledge_status   ON knowledge (status) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_knowledge_sub_area ON knowledge (sub_area);

-- ============================================================
-- 4. notes 表新增 owner 字段
--    区分这条笔记属于 Alex 还是 Cecelia
--    先确保 notes 表存在（CI 环境从零建库时无此表）
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category   VARCHAR(50),
  title      VARCHAR(200),
  content    TEXT,
  source     VARCHAR(200),
  tags       TEXT[],
  area       VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  area_id    UUID,
  type       VARCHAR(50),
  metadata   JSONB DEFAULT '{}'
);

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS owner VARCHAR(20) NOT NULL DEFAULT 'cecelia';

CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes (owner);

-- 知识库 skill 存入的笔记标记为 alex
-- （迁移脚本会处理历史数据，这里只设默认值）
