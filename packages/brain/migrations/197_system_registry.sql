-- Migration 197: system_registry 表
-- 记录系统里所有东西的位置和状态（skill/cron/api/machine/integration/config）
-- 目标：Claude 创建任何东西前先查这里，彻底解决孤岛和重复问题

CREATE TABLE IF NOT EXISTS system_registry (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         VARCHAR(50)  NOT NULL,           -- skill/cron/api/machine/integration/config/workflow
  name         VARCHAR(200) NOT NULL,            -- 唯一标识名（如 /dev、brain-tasks、xian-m1）
  location     TEXT,                             -- 文件路径 或 URL 或 host:port
  description  TEXT,                             -- 解决的问题（一句话）
  status       VARCHAR(20)  NOT NULL DEFAULT 'active',  -- active/deprecated/unknown
  depends_on   TEXT[]       DEFAULT '{}',        -- 依赖哪些其他条目的 name
  metadata     JSONB        DEFAULT '{}',        -- 额外信息（触发词、版本、owner 等）
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(type, name)
);

CREATE INDEX IF NOT EXISTS idx_system_registry_type   ON system_registry(type);
CREATE INDEX IF NOT EXISTS idx_system_registry_status ON system_registry(status);
CREATE INDEX IF NOT EXISTS idx_system_registry_name   ON system_registry(name);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_system_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_registry_updated_at ON system_registry;
CREATE TRIGGER trg_system_registry_updated_at
  BEFORE UPDATE ON system_registry
  FOR EACH ROW EXECUTE FUNCTION update_system_registry_updated_at();

-- 初始数据：机器节点
INSERT INTO system_registry (type, name, location, description, metadata) VALUES
  ('machine', 'mac-mini-m4-us',  '38.23.47.81',       '美国 Mac mini M4，主力研发机，Brain + Claude Code', '{"tailscale":"100.71.151.105","ssh_alias":"mmv","auto_login":"administrator"}'),
  ('machine', 'mac-mini-m1-xian','100.88.166.55',      '西安 Mac mini M1，Codex 工作节点',                  '{"tailscale":"100.88.166.55","ssh_alias":"xian-m1","auto_login":"xx-macmini"}'),
  ('machine', 'mac-mini-m4-xian','100.86.57.69',       '西安 Mac mini M4，Codex 主力机',                   '{"tailscale":"100.86.57.69","ssh_alias":"xian-mac","auto_login":"jinnuoshengyuan"}'),
  ('machine', 'vps-hk',          '124.156.138.116',    '香港 VPS，CI runner + 公网 IP',                    '{"tailscale":"100.86.118.99","ssh":"ssh root@100.86.118.99"}'),
  ('machine', 'vps-us',          '134.199.234.147',    '美国 VPS，公网中转 exit node',                      '{"tailscale":"100.79.41.61"}')
ON CONFLICT (type, name) DO NOTHING;

-- 初始数据：Brain API 核心端点
INSERT INTO system_registry (type, name, location, description) VALUES
  ('api', '/api/brain/tasks',     'localhost:5221', 'Brain 任务 CRUD'),
  ('api', '/api/brain/decisions', 'localhost:5221', 'Brain 决策记录'),
  ('api', '/api/brain/context',   'localhost:5221', 'Brain 全景摘要（OKR+PR+任务+决策）'),
  ('api', '/api/brain/registry',  'localhost:5221', '系统注册表 — 本表的查询接口')
ON CONFLICT (type, name) DO NOTHING;
INSERT INTO schema_version (version, description)
VALUES ('197', 'system_registry')
ON CONFLICT (version) DO NOTHING;
