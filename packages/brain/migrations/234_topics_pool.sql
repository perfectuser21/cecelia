-- Migration 234: 主理人选题池表
-- 目标：让选题源头从 AI 自动扩词回归到主理人手里
-- 主理人在 Dashboard 写清单，系统按节奏（daily_limit）从 status='已通过' 拉取创建 pipeline
-- 与 topic_suggestions（AI 自动推荐审核队列）并列但独立

CREATE TABLE IF NOT EXISTS topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  angle           TEXT,                                      -- 创作角度/切入点
  priority        INTEGER NOT NULL DEFAULT 50,               -- 优先级 0-100，越高越早发布
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', '已通过', '已发布', '已废弃')),
  target_platforms JSONB NOT NULL DEFAULT '[]',              -- 目标平台数组，如 ["xiaohongshu", "douyin"]
  scheduled_date  DATE,                                      -- 主理人期望发布日期（可选）
  pipeline_task_id UUID,                                     -- 创建 pipeline 后回写 task id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按状态快速过滤（调度器每 tick 扫 status='已通过'）
CREATE INDEX IF NOT EXISTS idx_topics_status
  ON topics (status);

-- 按优先级排序（调度器优先取高分）
CREATE INDEX IF NOT EXISTS idx_topics_priority
  ON topics (priority DESC, created_at ASC);

-- 节奏配置表（每日最多触发几个 topic → pipeline）
CREATE TABLE IF NOT EXISTS topics_rhythm_config (
  id          SERIAL PRIMARY KEY,
  daily_limit INTEGER NOT NULL DEFAULT 1
              CHECK (daily_limit >= 0 AND daily_limit <= 50),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初始化默认节奏：1/天
INSERT INTO topics_rhythm_config (daily_limit) VALUES (1)
ON CONFLICT DO NOTHING;

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('234', 'topics 表 + topics_rhythm_config — 主理人选题池', NOW())
ON CONFLICT (version) DO NOTHING;
