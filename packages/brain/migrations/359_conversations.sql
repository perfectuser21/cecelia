-- Migration 359: conversations 表 + conversation_messages 表
-- Task 264b8c8d-aad6-4f1c-84d1-274880beb3da — PR1 对话会话基础层
-- 幂等：所有 CREATE 使用 IF NOT EXISTS

-- ── conversations 表 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id           UUID NOT NULL REFERENCES journeys(id),
  gp_id                UUID REFERENCES golden_path(id),
  title                VARCHAR(200),
  status               VARCHAR(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'resolved', 'suspended', 'archived')),
  current_session_id   TEXT,
  session_compact_count INT NOT NULL DEFAULT 0,
  turn_count           INT NOT NULL DEFAULT 0,
  ttl_expires_at       TIMESTAMPTZ,
  archived_summary     TEXT,
  related_decision_ids UUID[],
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_conversations_journey_id
  ON conversations (journey_id);

CREATE INDEX IF NOT EXISTS idx_conversations_gp_id
  ON conversations (gp_id)
  WHERE gp_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_status
  ON conversations (status);

CREATE INDEX IF NOT EXISTS idx_conversations_ttl_expires_at
  ON conversations (ttl_expires_at)
  WHERE status = 'active';

-- ── conversation_messages 表 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content           TEXT NOT NULL,
  turn_marker       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 复合索引：(conversation_id, created_at ASC)
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_created
  ON conversation_messages (conversation_id, created_at ASC);
