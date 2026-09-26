-- Migration 473: org_units 组织真身骨架——company→department→leader→members 自动升格模型
--（链 bf5088a3 棒6，任务 80e9f816，决策 de1e9ba9）
--
-- 主理人 2026-09-26 拍板：不填清单（组织架构本就不存在），建一个从 0 到大的自动升格模型。
-- 目标形态 company→department→leader→members(agent|human)；起点只种一行代表当前真实状态
-- （一人公司 + agent），department 不手工建，靠"存活法则"（复用决策 ca3c6755：7 天试用期，
-- 连续 3 天无交卷证据自动降级，反过来连续达标则升格）从 Area 自动升格——判定函数见
-- lib/org-unit-promotion.js，本迁移只建骨架，不接调度、不自动建 department 行。
--
-- 设计：
--   * org_units：unit_type 只支持 company|department（为将来层级扩展留口，不预留列）；
--     parent_id 自引用——company 级 NULL，department 级指向其 company；
--     area_id 关联 areas（department 升格自哪个 Area），company 级 NULL；
--     status：active=正式在编，incubating=存活法则观察期中，demoted=被降级。
--   * org_unit_members 是独立轻表，不是 org_units 的列（members 是多值关系，不塞 JSON/数组列）。
--     human 类型只在真人真的加入时手工插一行，不预建空位；agent 类型若落库要标注是观察快照，
--     不代表真实雇佣关系（本迁移暂不落 agent 行，由查询侧从 ops_agents/ops_workflows 反推展示）。
--   * 种子：一行 company，代表当前真实状态，不装大、不编造清单。

CREATE TABLE IF NOT EXISTS org_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    unit_type varchar(20) NOT NULL,
    parent_id uuid REFERENCES org_units(id),
    name text NOT NULL,
    leader text,
    area_id uuid REFERENCES areas(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    survival_started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_units DROP CONSTRAINT IF EXISTS org_units_unit_type_check;
ALTER TABLE org_units
  ADD CONSTRAINT org_units_unit_type_check
    CHECK (unit_type IN ('company', 'department'));

ALTER TABLE org_units DROP CONSTRAINT IF EXISTS org_units_status_check;
ALTER TABLE org_units
  ADD CONSTRAINT org_units_status_check
    CHECK (status IN ('active', 'incubating', 'demoted'));

CREATE INDEX IF NOT EXISTS idx_org_units_parent_id ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_area_id ON org_units(area_id);

COMMENT ON TABLE org_units IS
  '组织真身（决策 de1e9ba9）：company/department 两级；department 靠存活法则从 Area 自动升格，不手工建清单。';
COMMENT ON COLUMN org_units.status IS
  'active=正式在编 | incubating=存活法则观察期中 | demoted=被降级。';

CREATE TABLE IF NOT EXISTS org_unit_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    org_unit_id uuid NOT NULL REFERENCES org_units(id),
    member_type varchar(10) NOT NULL,
    member_ref text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_unit_members DROP CONSTRAINT IF EXISTS org_unit_members_member_type_check;
ALTER TABLE org_unit_members
  ADD CONSTRAINT org_unit_members_member_type_check
    CHECK (member_type IN ('agent', 'human'));

CREATE INDEX IF NOT EXISTS idx_org_unit_members_org_unit_id ON org_unit_members(org_unit_id);

COMMENT ON TABLE org_unit_members IS
  'org_units 的成员轻表（决策 de1e9ba9）：human 只在真人真的加入时手工插一行，不预建空位；agent 行是观察快照，不代表真实雇佣关系。';

-- 种子：当前真实状态——一人公司，代表主理人本人，不编造部门/人员清单
INSERT INTO org_units (unit_type, parent_id, name, leader, area_id, status)
SELECT 'company', NULL, 'Cecelia/ZenithJoy', 'Alex', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM org_units WHERE unit_type = 'company');

INSERT INTO schema_version (version, description)
VALUES ('473', 'org_units + org_unit_members：company/department/leader/members 自动升格骨架，种一行代表当前真实状态')
ON CONFLICT (version) DO NOTHING;
