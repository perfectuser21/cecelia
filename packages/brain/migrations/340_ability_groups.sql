-- Migration 340: 激活能力轴 L2 子领域 —— 独立 ability_groups 表 + golden_paths 挂载列
-- 决策：decision 13013a49（能力轴 5 层）。M2 第一半：只做 DB + API 骨架，不做 Notion 同步。
-- 只动 schema，纯增量（新表 + 可空列），向后兼容，不破坏现有行。
--   L1 领域 = journeys；L2 子领域 = ability_groups（本表，新建）；L3 提案态 = golden_paths。
-- 幂等：IF NOT EXISTS 守卫，重复执行安全。

-- ─────────────────────────────────────────────────────────────
-- L2 子领域表：每个子领域必属于一个 L1 领域（journeys）
CREATE TABLE IF NOT EXISTS ability_groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id       uuid REFERENCES journeys(id),   -- L1 领域
  name             varchar NOT NULL,               -- 子领域名，如「微信客户沟通」
  notion_id        varchar,                        -- Notion 子领域库回填（第二步同步用，本 PR 不写）
  notion_synced_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ability_groups_journey_name_uniq UNIQUE (journey_id, name)  -- 同域内子领域名唯一
);
CREATE INDEX IF NOT EXISTS idx_ability_groups_journey ON ability_groups(journey_id);

COMMENT ON TABLE ability_groups IS '能力轴 L2 子领域（decision 13013a49）；L1 journeys 之下、L3 golden_paths 之上';
COMMENT ON COLUMN ability_groups.journey_id IS 'L1 领域挂载（journeys.id）';
COMMENT ON COLUMN ability_groups.notion_id IS 'Notion 子领域库回填 id；本 PR 只建列不同步（Notion 同步是 M2 第二步）';

-- ─────────────────────────────────────────────────────────────
-- golden_paths（L3 提案态）挂到 L2 子领域。本 PR 只建列（默认 NULL），M4 负责写入。
-- ON DELETE SET NULL：删子领域不连带砸 GP 提案历史。
ALTER TABLE golden_paths
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES ability_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_golden_paths_group ON golden_paths(group_id);

COMMENT ON COLUMN golden_paths.group_id IS 'L2 子领域挂载（ability_groups.id，decision 13013a49）；本 PR 建列默认 NULL，M4 写入';

-- ─────────────────────────────────────────────────────────────
INSERT INTO schema_version (version, description)
VALUES ('340', 'Add ability_groups (L2 sub-domain) table + golden_paths.group_id column')
ON CONFLICT (version) DO NOTHING;
