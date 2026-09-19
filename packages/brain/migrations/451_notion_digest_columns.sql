-- 451: 镜子表补 notion_digest 指纹列（三面模型 PR②a，决策 297ffee5）
-- 统一推送引擎按「将要发送的 properties」算 sha1 存此列：指纹同→不打 Notion（防限流），
-- 变→PATCH，无 notion_id→POST。此前 9 个 push 函数 insert-only，Brain 改了 Notion 永不更新。
-- tasks(notion_props.pushed_status) 与 skill_registry(metadata.pushed_digest) 已有各自指纹槽，本刀不动。
ALTER TABLE IF EXISTS issues               ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS journeys             ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS journey_features     ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS journey_step_links   ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS decisions            ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS initiative_contracts ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS ops_agents           ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS ops_skills           ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS ops_workflows        ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS ops_runs             ADD COLUMN IF NOT EXISTS notion_digest TEXT;
ALTER TABLE IF EXISTS ops_schedule_entries ADD COLUMN IF NOT EXISTS notion_digest TEXT;
