-- 项目 AI 参与档位：已有项目与新建项目默认知情；Notion 页只关联一个项目。
-- 上线前可只读检查重复关联：
-- SELECT notion_props->>'notion_id', count(*) FROM projects
-- WHERE notion_props->>'notion_id' IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- 如有历史重复，唯一索引使事务整体失败，保留原数据，禁止擅自删除或改写关联。
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_tier text NOT NULL DEFAULT '知情';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'projects'::regclass AND conname = 'projects_ai_tier_check'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_ai_tier_check
      CHECK (ai_tier IN ('知情', '盯着', '介入'));
  END IF;
END $$;
COMMENT ON COLUMN projects.ai_tier IS 'AI 参与档位：知情（默认）、盯着、介入；由用户指定，不自动升级。';

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_notion_id_unique
  ON projects ((notion_props->>'notion_id'))
  WHERE notion_props->>'notion_id' IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('552', '项目 AI 参与档位默认知情，限制知情/盯着/介入；Notion 页与项目唯一关联')
ON CONFLICT (version) DO NOTHING;

COMMIT;
