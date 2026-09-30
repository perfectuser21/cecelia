-- Migration 492: steps / enablers / enabler_calls（决策 3e867cad 13 张表第一批，任务 8345a8dc，词表决策 f425e3fd）
--
-- 09-30 凌晨批次 cmd09300230：归位（back-to-results）134/134 走兜底重搜，一批 6 小时只出 4 条线索，
-- 而 delivery/scoring 的结果探针全绿——"采集"这一格从画出来那天起就是灰的，格子有、里面是空的。
-- 根因是两层缺口：① 43 步契约只在仓库 step-dod.json，Brain 地图只到 8 个活动，探针挂不到"归位"这一步；
-- ② 归位这类横切件（Enabler）被 back-to-results / back-to-profile 各抄一份、各修各的，没有单份定义。
--
-- 三表：
--   steps          Step 投影。真身 = zenithjoy-workspace product-map → step-dod.json；
--                  sync-steps-from-workspace.mjs 按 activity_key 挂到 journey_steps（backbone_activities 视图）。
--                  source_sha256 = sha256(canonical JSON(step))，与仓库现算不一致 = 漂移。
--   enablers       使能件注册表（客户看不见、多 workflow 共用、单份定义多处引用）。kind = 谁来干（code|agent），
--                  与"是不是 Enabler"是两根轴。impl_ref 指向真身位置（仓库:路径#符号）。
--   enabler_calls  谁调用谁。caller_type=activity 时 caller_id 指 journey_steps.id；=step 时指 steps.id。
--                  不做外键（两种目标表），靠 CHECK + 唯一约束。
--
-- 种子：enabler return_to_results（归位）挂到 keyword_acquisition 最新骨干的 collection 活动。
-- ON CONFLICT DO NOTHING——重跑迁移不覆盖后来人改的值。

CREATE TABLE IF NOT EXISTS steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  key text NOT NULL UNIQUE,
  activity_key text NOT NULL,
  mode text NOT NULL DEFAULT 'checkpoint',
  readback jsonb NOT NULL DEFAULT '{}'::jsonb,
  contract jsonb,
  source_sha256 text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_steps_activity ON steps (activity_id, step_order);

COMMENT ON TABLE steps IS
  'Step 投影（决策 3e867cad）：真身在仓库 step-dod.json，sync-steps-from-workspace.mjs 灌入；探针可精确挂到某一步。';
COMMENT ON COLUMN steps.source_sha256 IS
  'sha256(canonical JSON(step))，键排序；与仓库现算不一致 = 漂移。';

CREATE TABLE IF NOT EXISTS enablers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  impl_ref text,
  owner text,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enablers_kind_check CHECK (kind IN ('code', 'agent'))
);

COMMENT ON TABLE enablers IS
  '使能件注册表（词表决策 f425e3fd）：客户看不见、多 workflow 共用、单份定义多处引用。kind 是执行体轴，与 Enabler 身份无关。';

CREATE TABLE IF NOT EXISTS enabler_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  caller_type text NOT NULL,
  caller_id uuid NOT NULL,
  enabler_id uuid NOT NULL REFERENCES enablers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enabler_calls_caller_type_check CHECK (caller_type IN ('activity', 'step')),
  CONSTRAINT enabler_calls_unique UNIQUE (caller_type, caller_id, enabler_id)
);

CREATE INDEX IF NOT EXISTS idx_enabler_calls_enabler ON enabler_calls (enabler_id);

COMMENT ON TABLE enabler_calls IS
  '活动/步骤 → 使能件 的调用关系。caller_type=activity → journey_steps.id；=step → steps.id。';

INSERT INTO enablers (key, name, kind, impl_ref, owner, description)
VALUES (
  'return_to_results',
  '归位',
  'code',
  'zenithjoy-workspace:services/phone-adb-controller/douyin-phone-adb#back_to_results,back_to_profile',
  'line02',
  '处理完一张卡片后退回来源列表页（搜索结果页 / 对标主页网格），被关键词获客与对标获客共用；兜底重搜触发率 = 1 − 一次做对率。'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO enabler_calls (caller_type, caller_id, enabler_id)
SELECT 'activity', js.id, e.id
  FROM enablers e
  JOIN LATERAL (
    SELECT id FROM journey_steps
     WHERE capability_key = 'keyword_acquisition' AND activity_key = 'collection'
     ORDER BY backbone_version DESC, step_number ASC
     LIMIT 1
  ) js ON TRUE
 WHERE e.key = 'return_to_results'
ON CONFLICT (caller_type, caller_id, enabler_id) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('492', 'steps / enablers / enabler_calls：Step 进 Brain（仓库 step-dod.json 为真身）+ 使能件注册表 + 调用关系，种子归位 enabler')
ON CONFLICT (version) DO NOTHING;
