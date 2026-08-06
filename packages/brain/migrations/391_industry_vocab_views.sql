-- 391: 行业词汇视图别名（词汇决策 a340f100 第三阶段·纯增量零风险）
-- 表本名不动；新代码/新查询一律用行业名视图。任务 7b550e31。
-- 对照：journeys→value_streams / golden_paths→capabilities / journey_steps→backbone_activities
--      journey_features→features_registry / journey_step_links→acceptance_criteria / advancement_items→work_items
-- 注：features 名与部分工具表述易撞，视图取 features_registry；其余按决策原名。

CREATE OR REPLACE VIEW value_streams AS SELECT * FROM journeys;
COMMENT ON VIEW value_streams IS '行业名视图（Value Stream=业务线/价值流）→ journeys；决策 a340f100';

-- 注：capabilities 名被 capability-scanner 老表占用（37行在用），视图取 capabilities_registry
CREATE OR REPLACE VIEW capabilities_registry AS SELECT * FROM golden_paths;
COMMENT ON VIEW capabilities_registry IS '行业名视图（Capability=路/Golden Path）→ golden_paths；决策 a340f100';

CREATE OR REPLACE VIEW backbone_activities AS SELECT * FROM journey_steps;
COMMENT ON VIEW backbone_activities IS '行业名视图（Backbone Activity=骨干步骤）→ journey_steps；决策 a340f100';

CREATE OR REPLACE VIEW features_registry AS SELECT * FROM journey_features;
COMMENT ON VIEW features_registry IS '行业名视图（Feature/Enabler=挂片）→ journey_features；kind=ability 为历史值；决策 a340f100';

CREATE OR REPLACE VIEW acceptance_criteria AS SELECT * FROM journey_step_links;
COMMENT ON VIEW acceptance_criteria IS '行业名视图（Acceptance Criteria=格子/验收标准）→ journey_step_links；决策 a340f100';

CREATE OR REPLACE VIEW work_items AS SELECT * FROM advancement_items;
COMMENT ON VIEW work_items IS '行业名视图（Work Item=推进项）→ advancement_items；决策 a340f100';

-- 表注释同步（老表挂新名说明，读到老名的人立刻知道正式名）
COMMENT ON TABLE journeys IS '价值流 Value Stream（正式名，视图 value_streams）；决策 a340f100';
COMMENT ON TABLE golden_paths IS '能力 Capability（正式名，视图 capabilities_registry）；Golden Path 为内部别名；决策 a340f100';
COMMENT ON TABLE journey_steps IS '主干活动 Backbone Activities（视图 backbone_activities）；决策 a340f100';
COMMENT ON TABLE journey_features IS '特性/使能项 Features & Enablers（视图 features_registry）；kind=ability 为历史值；决策 a340f100';
COMMENT ON TABLE journey_step_links IS '验收标准 Acceptance Criteria（视图 acceptance_criteria）；决策 a340f100';
COMMENT ON TABLE advancement_items IS '工作项 Work Items（视图 work_items）；决策 a340f100';
