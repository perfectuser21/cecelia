-- Migration 202: design_docs 增加对话历史字段
-- chat_history: 持久化每个文档的聊天记录 [{role, content, ts}]
-- analyze_watermark: 上次 analyze 的消息索引，用于增量去重

ALTER TABLE design_docs
  ADD COLUMN IF NOT EXISTS chat_history jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS analyze_watermark integer NOT NULL DEFAULT 0;
