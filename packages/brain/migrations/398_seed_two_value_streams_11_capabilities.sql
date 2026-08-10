-- Migration 398: 插入 2 条价值流顶层行 + 归位 11 个 Capability
-- Sprint: 08101234-cecelia-map-reorg
-- Task: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
-- 2026-08-10
--
-- 承诺地图结构：
--   VS_FACTORY（工厂线）
--     F0  工厂 · F0 提案拍板闭环    743f0e7c-d551-4105-8126-6b32de096f71
--     F1  工厂 · F1 开发闭环        e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
--     F2  工厂 · F2 部署闭环        2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
--     F3  工厂 · F3 夜间体检        ec4eb591-e064-4886-a7b6-4452cdf333d2
--     F4  工厂 · F4 故障自愈        91c17939-225c-4491-92f3-67d8b0ace4d9
--     MJ5 工厂 · MJ5 承诺地图闭环   51754939-247e-4b22-8f93-f8464a8eb985
--
--   VS_STEWARD（管家线）
--     G1  指挥舱（原 F5）           8bb8252f-29b4-4c34-acb9-1accda7ddfcf
--     G2  收件箱归位（原 F6）        824ee0f5-aeb9-4972-909d-37dd17b75617
--     G3  [新建] 凭据与安全守卫       新 UUID
--     G4  记忆与知识（原 F7）        a824b567-b05e-432d-9d83-0fafbc941e78
--     G5  [新建] 算力与基础设施调度    新 UUID
--
-- 幂等：INSERT ON CONFLICT DO UPDATE 仅更新 capability_code / parent_journey_id
--       在生产 DB（行已存在）等效于原 UPDATE；在新建 CI DB 也能正确插入行。

-- ── Step 1: 插入 VS_FACTORY 顶层价值流行 ──────────────────────────────────────
INSERT INTO journeys (
  id,
  name,
  description,
  journey_type,
  maturity,
  status,
  biz_area,
  capability_code,
  parent_journey_id
) VALUES (
  'aaaaaaaa-f0f0-4000-8000-000000000001',
  '工厂价值流',
  'Cecelia 工厂线顶层价值流：涵盖从提案拍板到开发、部署、体检、自愈和承诺地图闭环的全工厂域能力（F0-F4, MJ5）。',
  'dev_pipeline',
  'mvp',
  'active',
  'cecelia',
  'VS_FACTORY',
  NULL
) ON CONFLICT DO NOTHING;

-- ── Step 2: 插入 VS_STEWARD 顶层价值流行 ──────────────────────────────────────
INSERT INTO journeys (
  id,
  name,
  description,
  journey_type,
  maturity,
  status,
  biz_area,
  capability_code,
  parent_journey_id
) VALUES (
  'bbbbbbbb-f0f0-4000-8000-000000000002',
  '管家价值流',
  'Cecelia 管家线顶层价值流：涵盖系统运营与治理能力——指挥舱、收件箱归位、凭据安全守卫、记忆知识管理、算力调度（G1-G5）。',
  'autonomous',
  'mvp',
  'active',
  'cecelia',
  'VS_STEWARD',
  NULL
) ON CONFLICT DO NOTHING;

-- ── Step 3: 归位工厂线 Capability（F0/F1/F2/F3/F4/MJ5）─────────────────────
-- INSERT ON CONFLICT DO UPDATE：生产 DB 更新 capability_code/parent；新建 DB 插入行

-- F0 提案拍板闭环
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '743f0e7c-d551-4105-8126-6b32de096f71',
  '工厂 · F0 提案拍板闭环',
  'Cecelia 工厂线 F0：从战略目标到任务落地的提案拍板全闭环，含 OKR 对齐、Golden Path 审批和决策留痕。',
  'dev_pipeline', 'mvp', 'active', 'cecelia',
  'F0', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'F0',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'F0';

-- F1 开发闭环（关键锚，anchor 不断裂）
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29',
  '工厂 · F1 开发闭环',
  'Cecelia 工厂线 F1：代码研发全链路闭环，含 /dev 流程、DevGate 门禁、CI 守卫和 PR 合并验收。',
  'dev_pipeline', 'mvp', 'active', 'cecelia',
  'F1', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'F1',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'F1';

-- F2 部署闭环
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6',
  '工厂 · F2 部署闭环',
  'Cecelia 工厂线 F2：从 PR 合并到生产就绪的部署闭环，含分支策略、deploy preview、staging E2E 和生产验证。',
  'dev_pipeline', 'mvp', 'active', 'cecelia',
  'F2', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'F2',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'F2';

-- F3 夜间体检
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  'ec4eb591-e064-4886-a7b6-4452cdf333d2',
  '工厂 · F3 夜间体检',
  'Cecelia 工厂线 F3：系统定时健康自检，含服务存活探测、DB 连通性、CI 成功率等指标巡检。',
  'autonomous', 'mvp', 'active', 'cecelia',
  'F3', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'F3',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'F3';

-- F4 故障自愈
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '91c17939-225c-4491-92f3-67d8b0ace4d9',
  '工厂 · F4 故障自愈',
  'Cecelia 工厂线 F4：生产故障自动检测与恢复，含告警触发、回滚决策和状态恢复验证。',
  'autonomous', 'mvp', 'active', 'cecelia',
  'F4', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'F4',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'F4';

-- MJ5 承诺地图闭环
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '51754939-247e-4b22-8f93-f8464a8eb985',
  '工厂 · MJ5 承诺地图闭环',
  'Cecelia 工厂线 MJ5：维护和更新承诺地图（能力树/价值流），确保系统状态与 Brain 知识库一致。',
  'dev_pipeline', 'mvp', 'active', 'cecelia',
  'MJ5', 'aaaaaaaa-f0f0-4000-8000-000000000001'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'MJ5',
  parent_journey_id  = 'aaaaaaaa-f0f0-4000-8000-000000000001'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'MJ5';

-- ── Step 4: 归位管家线 Capability（G1/G2/G4，原 F5/F6/F7）─────────────────

-- G1 指挥舱（原 F5，关键锚）
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '8bb8252f-29b4-4c34-acb9-1accda7ddfcf',
  '管家 · G1 指挥舱',
  'Cecelia 管家线 G1：系统运行全景仪表盘，整合 OKR 进度、任务状态、CI 健康和告警中枢。',
  'autonomous', 'mvp', 'active', 'cecelia',
  'G1', 'bbbbbbbb-f0f0-4000-8000-000000000002'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'G1',
  parent_journey_id  = 'bbbbbbbb-f0f0-4000-8000-000000000002'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'G1';

-- G2 收件箱归位（原 F6）
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  '824ee0f5-aeb9-4972-909d-37dd17b75617',
  '管家 · G2 收件箱归位',
  'Cecelia 管家线 G2：用户需求与外部信号的收件箱分拣，将输入归位到对应的 Golden Path 格子。',
  'autonomous', 'mvp', 'active', 'cecelia',
  'G2', 'bbbbbbbb-f0f0-4000-8000-000000000002'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'G2',
  parent_journey_id  = 'bbbbbbbb-f0f0-4000-8000-000000000002'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'G2';

-- G4 记忆与知识（原 F7）
INSERT INTO journeys (
  id, name, description, journey_type, maturity, status, biz_area, capability_code, parent_journey_id
) VALUES (
  'a824b567-b05e-432d-9d83-0fafbc941e78',
  '管家 · G4 记忆与知识',
  'Cecelia 管家线 G4：Brain 知识库管理，含语义搜索、设计文档归档和跨会话上下文记忆。',
  'autonomous', 'mvp', 'active', 'cecelia',
  'G4', 'bbbbbbbb-f0f0-4000-8000-000000000002'
) ON CONFLICT (id) DO UPDATE SET
  capability_code    = 'G4',
  parent_journey_id  = 'bbbbbbbb-f0f0-4000-8000-000000000002'
WHERE journeys.capability_code IS NULL OR journeys.capability_code = 'G4';

-- ── Step 5: 新建 G3（凭据与安全守卫）──────────────────────────────────────
INSERT INTO journeys (
  id,
  name,
  description,
  journey_type,
  maturity,
  status,
  biz_area,
  capability_code,
  parent_journey_id
) VALUES (
  'cccccccc-f0f0-4000-8000-000000000003',
  '管家 · G3 凭据与安全守卫',
  'Cecelia 管家线 G3：负责凭据存储/轮转/访问控制（1Password 同步、API Key 安全管理、多写者竞态消除），守护所有组件的凭据安全。',
  'autonomous',
  'not_started',
  'active',
  'cecelia',
  'G3',
  'bbbbbbbb-f0f0-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

-- ── Step 6: 新建 G5（算力与基础设施调度）──────────────────────────────────
INSERT INTO journeys (
  id,
  name,
  description,
  journey_type,
  maturity,
  status,
  biz_area,
  capability_code,
  parent_journey_id
) VALUES (
  'dddddddd-f0f0-4000-8000-000000000004',
  '管家 · G5 算力与基础设施调度',
  'Cecelia 管家线 G5：负责西安机群/HK VPS/AutoDL 算力资源的调度与监控，确保任务派发时算力就绪。',
  'autonomous',
  'not_started',
  'active',
  'cecelia',
  'G5',
  'bbbbbbbb-f0f0-4000-8000-000000000002'
) ON CONFLICT DO NOTHING;

-- ── 注释：F1 挂片分拣（人工核查，不自动迁移）──────────────────────────────
-- 以下 SQL 仅用于人工核查，不在本 migration 自动执行：
-- SELECT id, name, "group", status FROM journey_features
-- WHERE journey_id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'
-- ORDER BY "group", name;
--
-- ZenithJoy 相关行（含 'zenithjoy'/'智能客服'/'客户' 关键字）的 journey_id
-- 应在产品确认后迁入 zenithjoy biz_area 的相应 journey。
-- 本合同不自动执行该迁移（AC-5 为人工核查型验收）。
