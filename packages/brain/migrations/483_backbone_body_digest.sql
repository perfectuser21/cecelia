-- 483_backbone_body_digest.sql
-- Backbone Activities 页面正文（主理人 2026-09-28：契约内容放 page content 给人读，任务 d852c852）。
-- 正文完全由 journey_steps.contract 生成、单向只读（决策 0834e2fb）；notion_body_digest 记已写入正文的指纹，
-- 指纹没变不打 Notion，变了才整段替换。与属性指纹 notion_digest 分开：改正文不重推属性，反之亦然。
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS notion_body_digest text;

INSERT INTO schema_version (version, description)
VALUES ('483', 'journey_steps.notion_body_digest：Backbone Activities 页面正文指纹（正文由契约生成，指纹变才重写）');
