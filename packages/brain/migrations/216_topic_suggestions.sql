-- Migration 216: 选题推荐队列表
-- 数据驱动选题闭环 I5：在"生成选题"→"创建内容Pipeline"之间增加推荐审核层
-- Alex 可 approve/reject；2小时内无操作则 auto_promoted 自动进入内容队列

CREATE TABLE IF NOT EXISTS topic_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selected_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  keyword         TEXT NOT NULL,
  content_type    VARCHAR(100) NOT NULL DEFAULT 'solo-company-case',
  title_candidates JSONB,
  hook            TEXT,
  why_hot         TEXT,
  priority_score  NUMERIC(4,3) DEFAULT 0.5,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','auto_promoted')),
  pipeline_task_id UUID,               -- 审批/自动晋级后创建的 content-pipeline task id
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每日每个关键词只有一条记录（避免重复推荐）
CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_suggestions_date_keyword
  ON topic_suggestions (selected_date, keyword);

-- 按日期查询（推荐列表）
CREATE INDEX IF NOT EXISTS idx_topic_suggestions_date_status
  ON topic_suggestions (selected_date DESC, status);

-- 按状态查询（auto-promote 扫描）
CREATE INDEX IF NOT EXISTS idx_topic_suggestions_status_created
  ON topic_suggestions (status, created_at)
  WHERE status = 'pending';

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('215', 'topic_suggestions 表 - 选题推荐审核队列', NOW())
ON CONFLICT (version) DO NOTHING;
