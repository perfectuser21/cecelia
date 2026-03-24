-- Migration 185: 知识文档系统 — dev_records / design_docs / user_annotations

-- ─────────────────────────────────────────────
-- 1. dev_records — 开发记录（PR合并、里程碑等）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dev_records (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT         NOT NULL,
  pr_number       INT,
  pr_url          TEXT,
  branch          TEXT,
  summary         TEXT         NOT NULL DEFAULT '',
  record_type     VARCHAR(32)  NOT NULL DEFAULT 'manual'
                               CHECK (record_type IN ('pr_merge', 'manual', 'daily_summary')),
  area            TEXT,
  components_affected TEXT[]   NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata        JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_dev_records_created_at ON dev_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_records_record_type ON dev_records(record_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_records_pr_number ON dev_records(pr_number)
  WHERE pr_number IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. design_docs — 设计文档（架构/决策/规范）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_docs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT         NOT NULL,
  content         TEXT         NOT NULL DEFAULT '',
  doc_type        VARCHAR(32)  NOT NULL DEFAULT 'design'
                               CHECK (doc_type IN ('architecture', 'design', 'decision', 'spec', 'guide')),
  tags            TEXT[]       NOT NULL DEFAULT '{}',
  status          VARCHAR(16)  NOT NULL DEFAULT 'active'
                               CHECK (status IN ('draft', 'active', 'archived')),
  created_by      TEXT         NOT NULL DEFAULT 'system',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_docs_doc_type ON design_docs(doc_type);
CREATE INDEX IF NOT EXISTS idx_design_docs_status ON design_docs(status);
CREATE INDEX IF NOT EXISTS idx_design_docs_updated_at ON design_docs(updated_at DESC);

-- ─────────────────────────────────────────────
-- 3. user_annotations — 用户批注（日记/笔记/洞察）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_annotations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type    TEXT,
  subject_id      TEXT,
  content         TEXT         NOT NULL,
  tags            TEXT[]       NOT NULL DEFAULT '{}',
  annotation_type VARCHAR(32)  NOT NULL DEFAULT 'note'
                               CHECK (annotation_type IN ('note', 'daily_diary', 'insight', 'question')),
  diary_date      DATE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_annotations_annotation_type ON user_annotations(annotation_type);
CREATE INDEX IF NOT EXISTS idx_user_annotations_diary_date ON user_annotations(diary_date DESC)
  WHERE annotation_type = 'daily_diary';
CREATE INDEX IF NOT EXISTS idx_user_annotations_subject ON user_annotations(subject_type, subject_id)
  WHERE subject_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_annotations_diary_unique ON user_annotations(diary_date)
  WHERE annotation_type = 'daily_diary';

-- ─────────────────────────────────────────────
-- 记录迁移版本
-- ─────────────────────────────────────────────
INSERT INTO schema_version (version, description, applied_at)
VALUES ('185', 'add knowledge docs system: dev_records, design_docs, user_annotations', NOW())
ON CONFLICT (version) DO NOTHING;
