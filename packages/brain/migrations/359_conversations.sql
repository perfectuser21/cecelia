-- Migration 359: conversations 表 + conversation_messages 表
-- Task 264b8c8d-aad6-4f1c-84d1-274880beb3da — PR1 对话会话基础层
-- 幂等：所有 CREATE 使用 IF NOT EXISTS

-- 生产库中曾存在一张同名的 legacy conversations 表。只按表名幂等会跳过
-- 新表创建，随后在 journey_id 索引处失败。先按新合同的判别列识别并保留旧表。
DO $migration$
DECLARE
  conversations_exists BOOLEAN;
  has_journey_id BOOLEAN;
  backup_exists BOOLEAN;
BEGIN
  SELECT to_regclass(format('%I.conversations', current_schema())) IS NOT NULL
    INTO conversations_exists;

  SELECT to_regclass(
    format('%I.conversations_legacy_pre_359', current_schema())
  ) IS NOT NULL
    INTO backup_exists;

  IF conversations_exists THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'conversations'
        AND column_name = 'journey_id'
    )
      INTO has_journey_id;

    IF NOT has_journey_id THEN
      IF backup_exists THEN
        RAISE EXCEPTION
          'migration 359: incompatible conversations and conversations_legacy_pre_359 both exist';
      END IF;

      EXECUTE format(
        'ALTER TABLE %I.conversations RENAME TO conversations_legacy_pre_359',
        current_schema()
      );

      -- ALTER TABLE RENAME 不会释放旧主键约束/索引名；先改旧约束名，
      -- 让下方新表仍能使用标准的 conversations_pkey。
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = current_schema()
          AND t.relname = 'conversations_legacy_pre_359'
          AND c.conname = 'conversations_pkey'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.conversations_legacy_pre_359 RENAME CONSTRAINT conversations_pkey TO conversations_legacy_pre_359_pkey',
          current_schema()
        );
      END IF;
    END IF;
  END IF;
END
$migration$;

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
