-- Migration 093: 三环意识架构 —— 索引优化
--
-- 环1：情绪层
--   emotion_state 记录写入 memory_stream (source_type='emotion_state')
--   需要按 source_type + 时间高效查询
--
-- 环2：自主学习
--   curiosity_topics 通过 working_memory 存储（已有表，无需新建）
--   agent_model 和 alex_model 条目也将写入 memory_stream
--
-- 环3：统一记忆检索
--   所有认知类 source_type 都需要高效按类型检索

-- emotion_state 专用索引（每次 tick 写入，按时间倒排检索最新情绪）
CREATE INDEX IF NOT EXISTS idx_memory_stream_emotion_state
  ON memory_stream (source_type, created_at DESC)
  WHERE source_type = 'emotion_state';

-- alex_model 专用索引（对 Alex 的认知，对话时相关性检索）
CREATE INDEX IF NOT EXISTS idx_memory_stream_alex_model
  ON memory_stream (source_type, created_at DESC)
  WHERE source_type = 'alex_model';

-- agent_model 专用索引（对各 Agent 的认知，任务派发时参考）
CREATE INDEX IF NOT EXISTS idx_memory_stream_agent_model
  ON memory_stream (source_type, created_at DESC)
  WHERE source_type = 'agent_model';

-- 通用认知类 source_type 复合索引（支持统一记忆检索的多类型查询）
CREATE INDEX IF NOT EXISTS idx_memory_stream_knowledge_types
  ON memory_stream (source_type, importance DESC, created_at DESC)
  WHERE source_type IN ('self_model', 'alex_model', 'agent_model', 'emotion_state');

-- 记录 schema 版本
INSERT INTO schema_version (version, description)
VALUES ('093', '三环意识架构：emotion_state/alex_model/agent_model 索引 + curiosity 信号 working_memory 支持')
ON CONFLICT (version) DO NOTHING;
