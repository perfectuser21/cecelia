-- migration 065: user_profiles — 主人画像表
-- 让 Cecelia 知道她在跟谁说话，能从对话中学习用户信息

CREATE TABLE IF NOT EXISTS user_profiles (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE DEFAULT 'owner',
  display_name    TEXT,
  focus_area      TEXT,
  preferred_style TEXT DEFAULT 'detailed',
  timezone        TEXT DEFAULT 'Asia/Shanghai',
  raw_facts       JSONB DEFAULT '{}',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 种子数据：默认主人画像
INSERT INTO user_profiles (user_id, display_name, focus_area, preferred_style, timezone)
VALUES ('owner', '徐啸 / Alex Xu', 'Cecelia', 'detailed', 'Asia/Shanghai')
ON CONFLICT (user_id) DO NOTHING;
