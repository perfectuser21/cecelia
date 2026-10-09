-- 443: 运行舱驾驶舱化——流程活性告警 + 人工可写列
--
-- 背景：2026-09-08 查出业务流程停跑 20.4 小时无人察觉。四表看板只答"跑过多少次"，
-- 不答"还会不会跑"。同时 Notion 作为主理人驾驶舱只能看不能改，所有人工判断无处落脚。
--
-- 两类列严格分区（决策：机器列单向 / 人工列回写）：
--   机器列 = 采集器每轮 UPSERT 覆盖，人在 Notion 改了会被冲掉
--   人工列 = 只由 Notion 回读写入，采集器永不触碰（现有 UPSERT 的 SET 子句不含这些列）

-- ── 流程活性（机器算，只读）────────────────────────────────
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS baseline_interval_sec INTEGER;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS liveness TEXT;           -- ok|warn|dead|cold
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS silent_sec INTEGER;      -- 距上次运行秒数
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS warn_after_sec INTEGER;  -- 黄线（透出判据）
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS dead_after_sec INTEGER;  -- 红线
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS liveness_at TIMESTAMPTZ;

COMMENT ON COLUMN ops_workflows.baseline_interval_sec IS '近30天相邻运行的中位间隔（秒），该流程的正常节奏';
COMMENT ON COLUMN ops_workflows.liveness IS 'ok=正常 warn=超5倍基线 dead=超20倍基线 cold=运行不足10次基线不可信';

-- ── 人工列：流程（Notion 回写，机器不碰）──────────────────
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS owner_manual TEXT;      -- 负责人
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS note_manual TEXT;       -- 备注
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS priority_manual TEXT;   -- P0/P1/P2/P3
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS starred BOOLEAN;        -- 关注标记
-- 停用意图：主理人拍板「直接生效，真去停 n8n」（判定点已登记，误触风险已知悉）。
-- enable_intent 记录人在 Notion 表达的意图，enable_applied_at/enable_error 记录执行结果，
-- 三列合起来提供留痕（改前状态在 active 列）、幂等（意图与已执行态一致则跳过）、
-- 失败可见（enable_error 非空时看板显红，不静默）。
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS enable_intent BOOLEAN;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS enable_intent_at TIMESTAMPTZ;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS enable_applied_at TIMESTAMPTZ;
ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS enable_error TEXT;

COMMENT ON COLUMN ops_workflows.enable_intent IS '主理人在 Notion 表达的启用/停用意图；与 active 不一致时由 ingest 调 n8n API 落实';
COMMENT ON COLUMN ops_workflows.enable_error IS 'n8n 停用/启用调用失败原因；非空即在看板显红，禁止静默吞掉';

-- ── 人工列：agent（数字员工的组织身份）─────────────────────
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS org_manual TEXT;        -- 部门
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS role_manual TEXT;       -- 角色
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS owner_manual TEXT;      -- 负责人
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS note_manual TEXT;
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS priority_manual TEXT;
ALTER TABLE ops_agents ADD COLUMN IF NOT EXISTS starred BOOLEAN;

COMMENT ON COLUMN ops_agents.org_manual IS '人工指定的部门归属；机器推断值在 org 列，生效值取人工优先';

-- ── 人工列：skill（含 DisCo 档位人工覆盖）──────────────────
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS stage_manual TEXT;      -- software3|disco|code
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS owner_manual TEXT;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS note_manual TEXT;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS priority_manual TEXT;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS starred BOOLEAN;

COMMENT ON COLUMN ops_skills.stage_manual IS 'DisCo 档位人工覆盖；自动判定值在 disco_stage 列，生效值取人工优先（人工空则用自动）';

-- 回读游标：按 last_edited_time 增量拉 Notion，避免每轮全量扫
CREATE TABLE IF NOT EXISTS ops_notion_ingest_cursor (
  db_key      TEXT PRIMARY KEY,      -- agents|workflows|skills
  last_seen   TIMESTAMPTZ,           -- 已处理到的 Notion last_edited_time
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
