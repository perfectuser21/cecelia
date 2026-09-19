-- 450: Notion 投影注册表（三面模型定稿，决策 297ffee5 / 立项 f5ba8ee3，PR①）
-- 病根：16 个 push 函数散在 9 个文件、Ops 五库 id 藏在 working_memory、无人知道哪张表接了哪个库，
-- 同一库既当入口又当镜子（决策双家）。本表把「面 / 对应表 / 方向 / 血管 / 空间」登记成账，
-- 是 PR②（双血管读表收口）与 PR③（守夜遍历对账）的唯一依据。
-- 命名避开 map_projection_*（产品承诺地图）。notion_db_id 存带连字符小写形式，比较时归一。
CREATE TABLE IF NOT EXISTS notion_projection_map (
  notion_db_id TEXT PRIMARY KEY,                     -- Notion database id（带连字符）
  title        TEXT NOT NULL,                        -- 库名（人读）
  face         TEXT NOT NULL CHECK (face IN ('mirror','inlet','truth')),
  brain_table  TEXT,                                 -- 对应真身表；truth/无表为 NULL
  direction    TEXT NOT NULL DEFAULT 'none' CHECK (direction IN ('push','ingest','both','none')),
  vessel       TEXT,                                 -- 血管：哪个文件/函数/脚本在推或收；pending 时写计划
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant','archived','pending_vessel')),
  space        TEXT NOT NULL DEFAULT 'system' CHECK (space IN ('system','private','staff')),  -- 系统区/主理人私有区/员工区
  reconcile    JSONB NOT NULL DEFAULT '{"count": true}'::jsonb,  -- 守夜对账规则（PR③ 读）
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notion_projection_map_table ON notion_projection_map (brain_table);

-- 种子：2026-09-19 实测盘点的编制库（宪法 ~/AI-CHARTER.md §二 + 补漏 Areas/Goals/员工区/半截血管）
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes) VALUES
-- 🔒 镜子（只有 Brain 写）
('a17c40c2-ba63-82fb-9888-8152cefe29ec','Issues','mirror','issues','push','notion-push-sync.pushIssues','active','system',NULL),
('353c40c2-ba63-81bf-ae3e-f0e6fa3753d7','Skill Registry','mirror','skill_registry','push','notion-push-sync.pushSkillRegistry','active','system','skill 唯一账本投影；9-16 改 upsert 指纹'),
('185c40c2-ba63-828c-973f-81a9c4582cd6','AI Notes','mirror','decisions','push','notion-push-sync.pushDecisions+pushInitiativeContracts','active','system','决策的机器镜子；「决策」库(f93e)为人写入口——双家定案'),
('358c40c2-ba63-8148-bde7-e313d789931a','AI Journey','mirror','journeys','push','notion-push-sync.pushJourneys','active','system',NULL),
('358c40c2-ba63-81e3-96c5-d762b3d34dff','AI Feature','mirror','journey_features','push','notion-push-sync.pushJourneyFeatures','active','system',NULL),
('369c40c2-ba63-812c-9f35-e7e43db25014','AI Steps','mirror','journey_steps','none','(停推：journey_steps 2026-06-09 废弃只读)','archived','system','PR① 从推送链摘除'),
('369c40c2-ba63-81e2-b95a-e5e3d0592676','Backbone-Step Map（Journey-Step 连接表）','mirror','journey_step_links','push','notion-push-sync.pushJourneyStepLinks','active','system',NULL),
('3d3c40c2-ba63-81cb-985d-f44b05e787ee','Ops Runs','mirror','ops_runs','push','notion-push-sync.pushOpsRuns','active','system','只推近期/重要 run'),
('3d3c40c2-ba63-8142-b136-e1541a149bba','Ops Skills','mirror','ops_skills','push','notion-push-sync.pushOpsSkills','active','system','考勤已并入 Skill Registry.metadata.run_stats；PR② 断推后归档'),
('3d3c40c2-ba63-81b1-8c2f-f5631b82ad51','Ops Workflows','mirror','ops_workflows','push','notion-push-sync.pushOpsWorkflows','active','system','机器数据源；人看 Workflow 步骤表/总库'),
('3d3c40c2-ba63-815e-be8a-f5048c070d80','Ops 运行图谱','mirror','ops_agents','push','notion-push-sync.pushOpsGraph','active','system','agent 名册；Area 列已挂 Areas（9-17）'),
('3d5c40c2-ba63-8125-9ac7-f057ecffdcdc','Ops Agent 交流台账','mirror',NULL,'push','ops-collector(OpenClaw 会话直采直推)','active','system','真身=openclaw 会话存储，非 Postgres'),
('3dac40c2-ba63-8138-8e30-e64752e1a6a0','Rules · 规则花名册','mirror',NULL,'none','(rules 表待建)','pending_vessel','system','规矩真身在执行现场，此为投影'),
('dfcc40c2-ba63-8238-a464-01dc04565d15','Events','mirror',NULL,'none',NULL,'dormant','private','行级停更 2026-04-29'),
('3d4c40c2-ba63-816d-b72d-d520f2cd090a','设备清单','mirror','machines','push','~/bin/phone-registry-mirror.sh(每小时)','active','system','列级分权：名称/归属/备注人可写，状态列镜子专属'),
('3d4c40c2-ba63-81fb-9c5f-f646eb6f2f63','Skill Eval — 模型档位评测','mirror','skill_registry','none','(pushSkillEval 待建；真身 metadata.eval_detail 已回填)','pending_vessel','system','31 行 9-07 手工直写'),
('3dbc40c2-ba63-8168-8ec5-ea3aba0f25b9','部门日报','mirror',NULL,'push','(推送方待核)','active','system',NULL),
('37ac40c2-ba63-815d-a782-d6f43ecd5e6d','AI Golden Path','mirror','golden_path','none','(有 notion_id 列无血管——半截)','pending_vessel','system','能力轴 L4 step 表'),
-- ✍️ 入口（人写，Brain 收）
('d5bc40c2-ba63-82ef-965a-8153b7ad81a0','Tasks','inlet','tasks','both','notion-push-sync.pushTasks+pullNotionTasks / inbox-push','active','private','唯一双向血管；人建行 lane=待分拣'),
('d83c40c2-ba63-8323-8dc7-01cc291c4d9b','Projects','inlet','okr_projects','both','project-compare','active','private',NULL),
('f93e1918-56c1-4f31-9a41-36aa76a1c9c2','决策','inlet','decisions','ingest','(PR② 接 ingest；ChatGPT/主理人【决定】前缀行)','pending_vessel','private','双家定案：本库=入口，AI Notes=镜子'),
('9dfc40c2-ba63-83db-9b75-019088ac1804','Resources','inlet',NULL,'none',NULL,'dormant','private','行级停更 2026-04-29'),
('3d8c40c2-ba63-808b-b7c2-eb7de269a92e','账号登录明细','inlet',NULL,'none',NULL,'active','private',NULL),
('034c40c2-ba63-8323-8f1b-81e54ebcf38e','平台账号配置','inlet',NULL,'none',NULL,'dormant','private','空库'),
('300c40c2-ba63-82d5-9ec1-81990d181950','Areas','inlet','areas','both','notion-sync','active','private','组织轴唯一（部门=Area/Sub-Area；Ops Departments 已并入）'),
('29ec40c2-ba63-8301-99c1-8110bfd84d9b','Goals','inlet',NULL,'none',NULL,'active','private','OKR 挂 Area'),
('3d9c40c2-ba63-8195-a41b-f529056a4aa8','Workflow 步骤表(活仪表盘)','inlet',NULL,'none',NULL,'active','private','主理人 9-12 建的人看门面'),
('3d9c40c2-ba63-8145-bfa8-f4c0c006e0af','Workflows 总库','inlet',NULL,'none',NULL,'active','private','主理人 9-12 建'),
('53d4654b-26de-433e-b733-8c542e6f20d5','Ai超级员工系统｜Skill库','inlet','skill_evals','ingest','(PR② 接：zip 提交→skill_evals 审核队列)','pending_vessel','staff','员工提交台；审核过入 skill_registry source=staff'),
('b8cddb44-16d4-46e0-887c-4f6e4b6e5677','Ai超级员工系统｜Agent库','inlet',NULL,'none',NULL,'active','staff',NULL),
('edad5640-ce91-4dc7-a1ff-7e4a59c7fe30','Ai超级员工系统｜Workflow库','inlet',NULL,'none',NULL,'active','staff',NULL),
('7e5bc869-522c-4dde-8911-c443ae8259e0','Ai超级员工系统｜功能库','inlet',NULL,'none',NULL,'dormant','staff','停更 2026-07-10；判决单待勾'),
('d523f650-2f36-4e04-96b0-475a2acc1c78','公域与朋友圈运营｜部门任务与 AI 能力映射库','inlet',NULL,'none',NULL,'active','staff','运营操作台'),
-- 📚 Notion 即真身
('770c40c2-ba63-83ea-86d0-01eba832c218','Knowledge_Reference','truth','knowledge','none','notion-sync(仅索引)','active','private',NULL),
('7b7c40c2-ba63-8364-9f76-81203bb3d1de','Knowledge_Operational','truth','knowledge','none','notion-sync(仅索引)','active','private',NULL),
('351c40c2-ba63-80c0-ada0-e527f051a9ec','Insights','truth','knowledge','none','notion-sync(仅索引)','active','private',NULL),
('092c40c2-ba63-83e8-aaf6-81cfdcb3f5f2','Ideas','truth','ideas','none',NULL,'active','private','内容链起点'),
('228c40c2-ba63-83c6-994a-013b5d98ed7d','Content_Seed','truth',NULL,'none',NULL,'dormant','private','停更 2026-05-12；归档/接回待主理人一字'),
('315c40c2-ba63-838d-b6f9-01fcd31d711c','Content_Core','truth',NULL,'none',NULL,'dormant','private','停更 2026-04-29；同上'),
('3d6c40c2-ba63-813e-9552-d7cf50a942ab','发布编排台','truth',NULL,'none','程序只发布，成功回写 tasks 事件','active','private',NULL),
('e9dc40c2-ba63-824f-b0f4-01052ef488a6','作品库','truth',NULL,'none',NULL,'active','private',NULL)
ON CONFLICT (notion_db_id) DO NOTHING;
