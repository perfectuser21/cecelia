-- 444: 运行舱四表补「派发语义」人工列（2026-09-14）
-- 背景：Notion Tasks 排单从硬编码 select 改为 relation 选真实 Workflow/Agent 行，
-- 派发所需的入口 URL 与租户模板引用必须落数据行而非代码常量。
-- dispatch 为人工维护列（同 owner_manual 族），ops 采集腿不写不覆盖。
--   ops_workflows.dispatch 例: {"webhook_url": "https://.../webhook/xxx/run"}
--   ops_agents.dispatch    例: {"template": "yueshengyun-daily.json"}
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS dispatch jsonb;
ALTER TABLE ops_agents    ADD COLUMN IF NOT EXISTS dispatch jsonb;
