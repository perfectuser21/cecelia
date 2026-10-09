-- 436: ops_workflows — 业务流程投影（运行舱刀4，task c2f6b4dd / 决策延续 ac7a0911）
-- 与 ops_agents 的区别：workflow 是业务流程（智能获客 8 阶段、编码流水线 9 阶段），
-- agent 是执行资源。流程换个 agent 执行还是那条流程，故独立成表（主理人 2026-09-06 纠正：
-- OpenClaw 的 allowAgents 是"谁能召唤谁"的权限，不是 workflow）。
-- 数据源：n8n 画布（ssh hk → n8n export:workflow --all），agent 归属经子流程传递闭包解析。
CREATE TABLE IF NOT EXISTS ops_workflows (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,             -- n8n | brain（brain=journeys 价值流，留待后续）
  wf_id TEXT NOT NULL,              -- n8n 画布 id，如 AwrSocialLeadgenV4
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  node_count INTEGER,
  stage_count INTEGER,              -- 「阶段 X」节点数 = 业务阶段数
  uses_agents JSONB NOT NULL DEFAULT '[]',  -- 传递闭包解析出的 agent 名数组
  meta JSONB NOT NULL DEFAULT '{}',         -- {stages:[阶段名有序]}；白名单，禁整份画布入库
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, wf_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_workflows_active ON ops_workflows (active, source);
