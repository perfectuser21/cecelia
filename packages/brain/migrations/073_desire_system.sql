-- Migration 073: Cecelia 欲望系统（Desire System）
--
-- 建立六层主动意识架构所需的数据库表：
--   memory_stream: 短/中/长期记忆流，存储感知观察和反思洞察
--   desires: 欲望记录，包含类型、内容、紧迫度、证据
--
-- 这两张表与现有 working_memory 表配合使用：
--   - desire_importance_accumulator: 重要性累积分（触发反思用）
--   - last_feishu_at: 上次发 Feishu 的时间（计算 silence_penalty 用）

-- ============================================================
-- 1. memory_stream 表
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_stream (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT NOT NULL,
  importance  INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
  memory_type VARCHAR(16) NOT NULL CHECK (memory_type IN ('short', 'mid', 'long')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ -- NULL = 永久（long 类型）
);

CREATE INDEX IF NOT EXISTS idx_memory_stream_type_created
  ON memory_stream (memory_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_stream_expires
  ON memory_stream (expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- 2. desires 表
-- ============================================================
CREATE TABLE IF NOT EXISTS desires (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(16) NOT NULL CHECK (type IN ('inform', 'propose', 'warn', 'celebrate', 'question')),
  content         TEXT NOT NULL,
  insight         TEXT,
  proposed_action TEXT,
  urgency         INTEGER NOT NULL CHECK (urgency BETWEEN 1 AND 10),
  evidence        JSONB DEFAULT '{}',
  status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'expressed', 'expired', 'suppressed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_desires_status_urgency
  ON desires (status, urgency DESC);

CREATE INDEX IF NOT EXISTS idx_desires_expires
  ON desires (expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- 3. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('073', 'Desire System: memory_stream + desires 表，六层主动意识架构')
ON CONFLICT (version) DO NOTHING;
