-- Migration 287: harness_messages — Agent 消息通信持久化表
-- 供 WS4 harness 消息 API 端点（GET/POST /api/brain/harness/messages/:initiativeId/:subTaskId）使用
-- 容器内 poll 消费消息；consumed_at IS NULL 表示未消费

CREATE TABLE IF NOT EXISTS harness_messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id  UUID        NOT NULL,
  sub_task_id    TEXT        NOT NULL,
  message        TEXT        NOT NULL,
  consumed_at    TIMESTAMPTZ DEFAULT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_messages_initiative ON harness_messages (initiative_id);
CREATE INDEX IF NOT EXISTS idx_harness_messages_sub_task   ON harness_messages (initiative_id, sub_task_id);
CREATE INDEX IF NOT EXISTS idx_harness_messages_unconsumed ON harness_messages (initiative_id, sub_task_id) WHERE consumed_at IS NULL;
