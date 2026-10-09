-- 441: ops_skill_versions — skill 版本历史（运行舱刀7，task e085ecae）
-- 主理人诉求："迭代完原来的副本应该有，才能知道一路怎么走过来"。
-- 现状硬伤：skill_registry 只存最新一版（180 个 skill 无版本字段），
-- eval 分数只留最新值——上一代考多少分、什么时候升的档，全丢。
-- 本表一代一行、只追加永不覆盖，是四表里唯一需要"历史"的关系（形状同 ops_runs 之于 ops_workflows）。

-- 先给 ops_skills 补当前态字段（当前第几代/当前分数/当前档位）
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS eval_score INTEGER;        -- 0-100，非分数文本时为 NULL（禁编造）
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS eval_baseline INTEGER;     -- 对照组（without_skill）分数
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS eval_raw TEXT;             -- 原文，保留 "EVA v2" 这类非分数值
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS disco_stage TEXT;          -- software3 | disco | code
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS stage_reason TEXT;         -- 凭什么判这档
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS stage_confident BOOLEAN;   -- false=数据不全，等人确认
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS has_postcondition BOOLEAN; -- 有无探针（无探针不许固化）

CREATE TABLE IF NOT EXISTS ops_skill_versions (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES ops_skills(id) ON DELETE CASCADE,  -- 真外键（本表是唯一强关联）
  skill_name TEXT NOT NULL,          -- 冗余存名，便于人读与 skill 被删后追溯
  generation INTEGER NOT NULL,
  eval_score INTEGER,
  eval_baseline INTEGER,
  eval_raw TEXT,
  disco_stage TEXT,
  stage_reason TEXT,
  change_note TEXT,                  -- 这代改了什么
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (skill_id, generation)      -- 一代一行，重复记录不产生第二行
);
CREATE INDEX IF NOT EXISTS idx_ops_skill_versions_name ON ops_skill_versions (skill_name, generation);
