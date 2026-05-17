-- Migration 108: 统一对话历史表
--
-- 将飞书 P2P、飞书群聊、Dashboard 三个渠道的对话历史
-- 统一到一张表，按 participant_id 存储，不按渠道分割。
--
-- 设计原则：
--   - participant_id：说话的人（feishu open_id 或 'owner'）
--   - channel：消息来源渠道（仅记录，不分割历史）
--   - group_id：群聊 chat_id（P2P 为 NULL）
--   - image_description：图片消息时存 Cecelia 的描述，解决跨轮失忆

CREATE TABLE IF NOT EXISTS unified_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  TEXT NOT NULL,                    -- feishu open_id 或 'owner'
  channel         VARCHAR(20) NOT NULL DEFAULT 'feishu_p2p',  -- feishu_p2p / feishu_group / dashboard
  group_id        TEXT,                             -- 群聊 chat_id（P2P 为 NULL）
  role            VARCHAR(10) NOT NULL,             -- 'user' 或 'assistant'
  content         TEXT NOT NULL,                   -- 消息内容
  image_description TEXT,                          -- 图片消息时，Cecelia 的描述摘要（解决跨轮失忆）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_role CHECK (role IN ('user', 'assistant')),
  CONSTRAINT chk_channel CHECK (channel IN ('feishu_p2p', 'feishu_group', 'dashboard'))
);

-- 按人查历史（最常用）
CREATE INDEX IF NOT EXISTS idx_unified_conv_participant ON unified_conversations(participant_id, created_at DESC);
-- 按群查历史
CREATE INDEX IF NOT EXISTS idx_unified_conv_group ON unified_conversations(group_id, created_at DESC) WHERE group_id IS NOT NULL;
-- 按渠道查（用于分析）
CREATE INDEX IF NOT EXISTS idx_unified_conv_channel ON unified_conversations(channel, created_at DESC);
