-- 006_exploratory_support.sql
-- 支持探索型任务闭环：OKR → Feature → Task → 回调秋米

-- projects 表加字段（Feature 层）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS decomposition_mode VARCHAR(20) DEFAULT 'known';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kr_id UUID REFERENCES goals(id);

-- 注释
COMMENT ON COLUMN projects.decomposition_mode IS '拆解模式: known=一次拆完, exploratory=边做边拆';
COMMENT ON COLUMN projects.kr_id IS '关联的 KR (部门 OKR)';

-- tasks 表加字段
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prd_content TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_profile VARCHAR(50);

-- 注释
COMMENT ON COLUMN tasks.prd_content IS '秋米写的 PRD 内容';
COMMENT ON COLUMN tasks.execution_profile IS '执行配置: US_CLAUDE_OPUS, US_CLAUDE_SONNET, HK_MINIMAX, HK_N8N';

-- 记录迁移
INSERT INTO schema_version (version, description) VALUES ('006', 'exploratory_support')
ON CONFLICT (version) DO NOTHING;
