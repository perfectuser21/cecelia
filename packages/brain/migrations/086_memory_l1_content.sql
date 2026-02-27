-- Migration 085: memory_stream 加 l1_content 列
-- L1 中间层：核心信息 + 使用场景（200-300字），供 AI 规划决策使用
-- L0 (summary) → 快筛；L1 (l1_content) → 决策层；L2 (content) → 深度阅读

ALTER TABLE memory_stream ADD COLUMN IF NOT EXISTS l1_content TEXT DEFAULT NULL;
