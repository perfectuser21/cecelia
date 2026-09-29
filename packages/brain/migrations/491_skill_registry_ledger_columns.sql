-- Migration 491: skill_registry 台账列（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396 / 4b1f4230 / 4b1da4ca）
--
-- 真身 = Brain skill_registry，Notion Skill Registry = 列级分权的可操作投影：
--   机器列：由 skill-inventory-sync 每 2h 经 ssh mmv 扫三平台写入，推 Notion 单向覆盖
--   人管列：主理人在 Notion 改，三方基线合并（PR1b 推送 / PR3 回拉），扫描永不碰
--   系统列：推送基线与失败退避
-- eval_score 刻意不建数值列：生产 48 行多为自由文本（'EVA v2'、'manual-review (...)'），转 numeric 类型会让迁移失败、Brain 起不来。

ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS platforms_installed TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS presence TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS absent_since TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS source_path TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS assigned_agents TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS content_md TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS content_digest TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS copies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS drift_copies INT NOT NULL DEFAULT 0;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS files TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS tier_suggested TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS platforms_target TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS openclaw_tier TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS business_line TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_baseline JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_push_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE skill_registry ADD COLUMN IF NOT EXISTS notion_next_retry_at TIMESTAMPTZ;

ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_presence_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_presence_check
  CHECK (presence IN ('unknown','present','broken','gone'));
ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_openclaw_tier_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_openclaw_tier_check
  CHECK (openclaw_tier IS NULL OR openclaw_tier IN ('A','B','C'));
ALTER TABLE skill_registry DROP CONSTRAINT IF EXISTS skill_registry_tier_suggested_check;
ALTER TABLE skill_registry ADD CONSTRAINT skill_registry_tier_suggested_check
  CHECK (tier_suggested IS NULL OR tier_suggested IN ('A','B','C'));

CREATE INDEX IF NOT EXISTS idx_skill_registry_presence ON skill_registry (presence);

-- 人管列「分类」从 metadata 回填（64 行有值；只填空的，重放不覆盖人后来改的）
UPDATE skill_registry SET category = metadata->>'category'
 WHERE category IS NULL AND COALESCE(metadata->>'category', '') <> '';

-- 去 openclaw/ 前缀（判定点 11af333b：同名即同一 skill）。
-- ① 先把带派发绑定、未写命令的前缀行命令固定为原值——skill-binding-registry 默认命令是 '/' || name，改名会悄悄改派发
UPDATE skill_registry SET dispatch_command = '/' || name
 WHERE name LIKE 'openclaw/%' AND task_types <> '{}' AND dispatch_command IS NULL;
-- ② 就地改名，notion_id 不变；撞名的行原样保留（2026-09-29 生产实测零撞名）
UPDATE skill_registry r
   SET name = substring(r.name from 10),
       metadata = COALESCE(r.metadata, '{}'::jsonb) || jsonb_build_object('renamed_from', r.name),
       updated_at = NOW()
 WHERE r.name LIKE 'openclaw/%'
   AND NOT EXISTS (SELECT 1 FROM skill_registry x WHERE x.name = substring(r.name from 10));

-- 投影注册表：镜子 → 入口面 both（列级分权，同 Tasks）。A8 镜子被人改 / 镜子标签 / A10 按 mirror 筛，改面后不再误报；
-- 行数对账由 A6 接住（lib/skill-ledger-assertion.js）。
UPDATE notion_projection_map
   SET face = 'inlet',
       direction = 'both',
       vessel = 'skill-inventory-sync（扫描入账）+ skill-registry-projection（PR1b 推送）+ 回拉（PR3）',
       notes = '列级分权：机器列 Brain 单向覆盖，人管列三方基线合并（决策 19391396 / 判定点 24736022）',
       updated_at = NOW()
 WHERE notion_db_id = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table = 'skill_registry';

INSERT INTO schema_version (version, description)
VALUES ('491', 'skill_registry 台账列（三平台扫描机器列/人管列/推送基线）+ 去 openclaw/ 前缀 + Skill Registry 改入口面')
ON CONFLICT (version) DO NOTHING;
