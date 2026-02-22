-- 054_inbox_proposal_system.sql
-- 将 pending_actions 从"危险操作审批"升级为"通用提案系统"
-- Phase 1: 收件箱 + 提案系统

-- 新增列：提案分类
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  category TEXT DEFAULT 'approval';
  -- 'approval'（原有审批）, 'proposal'（提案）, 'info'（通知）

-- 新增列：对话记录
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  comments JSONB DEFAULT '[]'::jsonb;
  -- [{role: "cecelia"|"user", text: "...", ts: "..."}]

-- 新增列：选项（异常处理用）
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  options JSONB DEFAULT NULL;
  -- [{id: "a", label: "...", action: {type: "...", params: {...}}, recommended: bool}]

-- 新增列：优先级
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  priority TEXT DEFAULT 'normal';
  -- 'urgent'（24h 内决策）, 'normal'（72h 内决策）, 'info'（纯通知）

-- 新增列：来源
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  source TEXT DEFAULT 'system';
  -- heartbeat_inspection / cortex / planner / okr_decomposer / initiative_closer / manual

-- 新增列：去重签名
ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS
  signature TEXT DEFAULT NULL;
  -- entity_type:entity_id:action_type，24h 去重

-- 复合索引：收件箱列表查询
CREATE INDEX IF NOT EXISTS idx_pending_actions_inbox
  ON pending_actions (status, priority, category, created_at DESC);

-- 签名去重索引
CREATE INDEX IF NOT EXISTS idx_pending_actions_signature
  ON pending_actions (signature, status, created_at DESC)
  WHERE signature IS NOT NULL;

-- 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('054', 'Inbox proposal system: extend pending_actions with category/comments/options/priority/source/signature', NOW())
ON CONFLICT (version) DO NOTHING;
