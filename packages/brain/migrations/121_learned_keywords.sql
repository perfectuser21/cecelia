-- Migration 120: learned_keywords 表 + 修复 chk_signal_type 约束遗留问题

-- 1. 修复 migration 119 遗留的约束名问题
--    119 只删了不存在的 person_signals_signal_type_check（旧版名），
--    真正需要删除的是 chk_signal_type（原始建表时的名字）
ALTER TABLE person_signals
  DROP CONSTRAINT IF EXISTS chk_signal_type;

-- 2. 创建 learned_keywords 表
--    存储 Haiku 发现但正则漏掉的关键词，用于反哺正则词库
CREATE TABLE IF NOT EXISTS learned_keywords (
  id           SERIAL PRIMARY KEY,
  person_id    TEXT NOT NULL,
  keyword      TEXT NOT NULL,
  polarity     TEXT NOT NULL DEFAULT 'positive'
                 CHECK (polarity IN ('positive', 'negative', 'habit', 'recent')),
  source       TEXT NOT NULL DEFAULT 'haiku'
                 CHECK (source IN ('haiku', 'manual')),
  use_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_learned_keywords_person
  ON learned_keywords (person_id);
