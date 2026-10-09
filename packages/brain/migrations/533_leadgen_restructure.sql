-- Migration 533: 获客重组为「智能获客」+ 四条抖音流程（决策 eb9f8f77，任务 82acbfff）
--
-- 目标结构：能力「智能获客」（原「关键词获客」改名，保留 id）下四条流程——
--   抖音·视频发现（每天 1~2 次，占手机）：预检 → 取源（关键词/对标两种找法）→ 过滤去重 → 取链接写视频表 → 收尾
--   抖音·视频处理（一天多轮，占手机）：预检 → 判定视频 → 采集评论 → 收尾
--   抖音·评论评分（有新评论就跑，不占手机）：评分 → 标记人
--   抖音·线索触达（全天每 30 分钟，占手机）：预检 → 发私信 → 回填 → 收尾
--
-- 新旧并存，不能把线上采收搞停：
--   * 旧流程「抖音·关键词获客」「抖音·对标获客」、它们的定义版本、workflow_activity_refs、release_versions 一律不碰。
--     线上脚本的运行绑定只认冻结的 release_versions / release_observations（lib/run-definition-binding.js），
--     不读 workflows / activities / refs 的现值，所以改名、新建流程不影响今晚的采收。
--   * 复用的 预检/判定/采集/评分/触达 只改 name 与展示用的 promise/inputs/outputs/readback 四列；
--     contract、contract_sha256、current_definition_version_id 不动——定义版本由 git 契约 + backbone-contract-sync 维护，
--     在这里出新版本会被每 30 分钟的契约同步改回 YAML 版本（definition-versions.saveVersion 重置 current 指针）。
--   * Step 一行都不挪：获客 56 个 Step 全部由契约同步按 key 维护（synchronizeSteps），挪到新 Activity 会在下一轮同步被改回；
--     Step 的新归属在脚本切换、契约改版时由契约同步落地（映射见 PR 报告）。
--   * 新流程 source_repo 留空：契约同步只认 source_repo=zenithjoy-workspace 的登记，留空才不会被它当成待加载契约。
--   * workflows 表没有说明字段，旧流程无法标「迁移中」（status 只允许 active/paused/retired，改了会影响运行），见报告。
-- 闹钟总账：commander 定时发起 ×3、harvest-cron 保底 ×8 → 抖音·视频发现；outreach-tick → 抖音·线索触达；
--   在用的看护项 ×20 摘除（workflow_id 置空，不新建看护节点）；停用/过期项不动。
-- 先把被改的行整行备份进 migration_533_backup，回滚脚本按备份还原。基础数据不在（测试库）时每段都是空操作。

BEGIN;

CREATE TABLE IF NOT EXISTS migration_533_backup (
  kind text NOT NULL,
  id   text NOT NULL,
  row  jsonb NOT NULL,
  PRIMARY KEY (kind, id)
);

INSERT INTO migration_533_backup (kind, id, row)
SELECT 'capability', c.id::text, to_jsonb(c) FROM capabilities c
 WHERE c.id IN ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                '5265cb99-ca28-45a8-9c33-6d63124bda96', 'cc21a3c0-cd97-4b14-8cc9-7d90a3267353')
ON CONFLICT (kind, id) DO NOTHING;

INSERT INTO migration_533_backup (kind, id, row)
SELECT 'activity', a.id::text, to_jsonb(a) - 'contract' FROM activities a
 WHERE a.id IN ('d27e18c9-709f-4c44-899c-85d6fb83671b', '27973f66-3033-4127-82d2-6248443e739b', '9b8988e9-a22d-483c-a101-8091728b9e04',
                '81e8a55f-1939-454c-b61b-f320055ee5d5', 'bb4fdc47-a543-4374-9078-8e78151b69c6')
ON CONFLICT (kind, id) DO NOTHING;

INSERT INTO migration_533_backup (kind, id, row)
SELECT 'schedule_entry', e.id::text, jsonb_build_object('id', e.id, 'label', e.label, 'workflow_id', e.workflow_id) FROM ops_schedule_entries e
 WHERE e.workflow_id = 'b1000000-0000-4000-8000-000000000001'
   AND e.id IN (321856, 321860, 321863, 508370, 508371, 508372, 508373, 508374, 508375, 508390, 508391,
                508368,
                508324, 508325, 508353, 507761, 431537, 485365, 478538, 527141, 545628, 508389,
                64634, 507760, 507762, 508303, 64609, 508392, 508369, 64601, 64597, 64611)
ON CONFLICT (kind, id) DO NOTHING;

-- ===== 能力：关键词获客 → 智能获客；对标/视频链接/直播获客标废弃 =====
UPDATE capabilities
   SET name = '智能获客',
       description = '从抖音找到意向客户并私信触达：视频发现（关键词/对标两种找法）→ 视频处理（判定、采评论）→ 评论评分 → 线索触达（决策 eb9f8f77）',
       updated_at = NOW()
 WHERE id = 'a1000000-0000-4000-8000-000000000001' AND name IS DISTINCT FROM '智能获客';

UPDATE capabilities
   SET status = 'deprecated',
       description = '已并入智能获客，作为发现的找法。' || COALESCE('（原说明：' || NULLIF(description, '') || '）', ''),
       updated_at = NOW()
 WHERE id IN ('a1000000-0000-4000-8000-000000000002', '5265cb99-ca28-45a8-9c33-6d63124bda96', 'cc21a3c0-cd97-4b14-8cc9-7d90a3267353')
   AND COALESCE(description, '') NOT LIKE '已并入智能获客%';

-- ===== 复用的 Activity：改名 + 新合同（只写展示列，见文件头） =====
UPDATE activities SET name = '预检',
  promise = '开工前确认手机和账号可用：拿到设备锁、确认手机上登录的是本流程要用的号；触达流程还要确认号可用、当日额度未满',
  inputs = '[{"type":"Account","fields":["platform","profile","sender_id"]},{"type":"Device","fields":["serial","host"]}]'::jsonb,
  outputs = '[{"type":"Device","effect":"update","fields":["lock_holder"]},{"type":"Account","effect":"update","fields":["logged_in","dm_paused","daily_cap_left"]}]'::jsonb,
  readback = '[{"probe":"pf_lock_acquired","asserts":"设备锁由本次运行持有"},{"probe":"pf_account_confirmed","asserts":"手机上登录的是本流程指定的号"},{"probe":"pf_quota_ok","asserts":"（触达流程）号未熔断且当日额度未满"}]'::jsonb,
  updated_at = NOW()
 WHERE id = 'd27e18c9-709f-4c44-899c-85d6fb83671b';

UPDATE activities SET name = '判定视频',
  promise = '视频表里每条「待判定」的视频都被逐个判出合格/不合格，并写明理由',
  inputs = '[{"type":"Video","cardinality":"many","fields":["line_key","video_id","video_url","title","judgment_status=待判定"]}]'::jsonb,
  outputs = '[{"type":"Video","effect":"update","cardinality":"many","fields":["judgment_status=合格|不合格","judgment_reason"]}]'::jsonb,
  readback = '[{"probe":"qual_none_pending","asserts":"本轮取到的待判定视频全部有结论"},{"probe":"qual_reason_present","asserts":"每个结论都带理由"}]'::jsonb,
  updated_at = NOW()
 WHERE id = '27973f66-3033-4127-82d2-6248443e739b';

UPDATE activities SET name = '采集评论',
  promise = '只对判定合格的视频采评论，评论表新增行，状态「待评分」',
  inputs = '[{"type":"Video","cardinality":"many","fields":["line_key","video_id","video_url","judgment_status=合格"]}]'::jsonb,
  outputs = '[{"type":"Comment","effect":"create","cardinality":"many","fields":["line_key","dedup_key","nickname","douyin_id","profile_url","body","video_id","status=待评分"]},{"type":"Video","effect":"update","cardinality":"many","fields":["process_status=评论已采"]}]'::jsonb,
  readback = '[{"probe":"coll_only_qualified","asserts":"新增评论都来自判定合格的视频"},{"probe":"coll_pending_score","asserts":"新增评论状态为待评分"}]'::jsonb,
  updated_at = NOW()
 WHERE id = '9b8988e9-a22d-483c-a101-8091728b9e04';

UPDATE activities SET name = '评分',
  promise = '评论表里每条「待评分」的评论都被逐条判出意向等级',
  inputs = '[{"type":"Comment","cardinality":"many","fields":["dedup_key","body","nickname","douyin_id","status=待评分"]},{"type":"Video","cardinality":"many","fields":["title","transcript"]}]'::jsonb,
  outputs = '[{"type":"Comment","effect":"update","cardinality":"many","fields":["intent_grade","relevance"]}]'::jsonb,
  readback = '[{"probe":"score_none_pending","asserts":"本轮取到的待评分评论全部有意向等级"}]'::jsonb,
  updated_at = NOW()
 WHERE id = '81e8a55f-1939-454c-b61b-f320055ee5d5';

UPDATE activities SET name = '发私信',
  promise = '按额度逐条给「待触达」线索发私信，满额即停；每条都有送达/受限/失败结果',
  inputs = '[{"type":"Lead","cardinality":"many","fields":["douyin_id","profile_url","intent_grade","status=待触达"]},{"type":"Account","fields":["profile","sender_id","daily_cap_left"]}]'::jsonb,
  outputs = '[{"type":"OutreachOrder","effect":"create","cardinality":"many","fields":["lead_record_id","douyin_id","sender_id","script_id","message","result=送达|受限|失败"]}]'::jsonb,
  readback = '[{"probe":"out_result_present","asserts":"本轮发出的每条都有送达/受限/失败结果"},{"probe":"out_stop_at_cap","asserts":"当日额度满后不再发"}]'::jsonb,
  updated_at = NOW()
 WHERE id = 'bb4fdc47-a543-4374-9078-8e78151b69c6';

-- ===== 新 Activity（固定 id，回滚按 id 删） =====
INSERT INTO activities (id, name, description, status, executor_kind, promise, inputs, outputs, readback, backbone_version)
SELECT v.id::uuid, v.name, v.description, 'planned', v.executor, v.promise, v.inputs::jsonb, v.outputs::jsonb, v.readback::jsonb, '3.0'
  FROM (VALUES
  ('c1000000-0000-4000-8000-000000000101', '取源', '分支：关键词 / 对标两种找法（原「发现」「对标发现」的取源部分）', 'code',
   '按本次的找法（关键词搜索 / 对标账号主页）拿到候选视频卡片',
   '[{"type":"Keyword","cardinality":"many","fields":["line_key","word"],"branch":"关键词"},{"type":"BenchmarkAccount","cardinality":"many","fields":["platform","sec_uid","profile_url"],"branch":"对标"}]',
   '[{"type":"VideoCard","effect":"create","cardinality":"many","fields":["title","author"]}]',
   '[{"probe":"src_cards_found","asserts":"每个关键词或对标账号都取到了视频卡片（无结果要记明）"}]'),
  ('c1000000-0000-4000-8000-000000000102', '过滤去重', '按标题+作者去掉已处理过的视频，排除自家账号', 'code',
   '只把没处理过、不是自家账号的视频交给下一步',
   '[{"type":"VideoCard","cardinality":"many","fields":["title","author"]}]',
   '[{"type":"VideoCard","effect":"filter","cardinality":"many","fields":["title","author","is_new=true"]}]',
   '[{"probe":"dedup_no_seen","asserts":"输出里没有视频表已有的 标题+作者"},{"probe":"dedup_no_own","asserts":"输出里没有自家账号的视频"}]'),
  ('c1000000-0000-4000-8000-000000000103', '取链接写视频表', '取视频链接并写进视频表（吸收原「配送」的视频落池与业务线读回）', 'code',
   '每条新视频都写进视频表，状态「待判定」',
   '[{"type":"VideoCard","cardinality":"many","fields":["title","author","is_new=true"]}]',
   '[{"type":"Video","effect":"create","cardinality":"many","fields":["line_key","video_id","video_url","title","author","harvest_batch","judgment_status=待判定"]}]',
   '[{"probe":"vt_rows_written","asserts":"新视频都在视频表里，数量一致"},{"probe":"vt_line_key","asserts":"每行业务线不为空"}]'),
  ('c1000000-0000-4000-8000-000000000104', '标记人', '把有意向的评论人写进线索表（吸收原「配送」的推表职责）', 'code',
   '有意向的人都进线索表、状态「待触达」；已触达过或多次出现的人打上标记，人不删',
   '[{"type":"Comment","cardinality":"many","fields":["douyin_id","nickname","profile_url","intent_grade"]}]',
   '[{"type":"Lead","effect":"upsert","cardinality":"many","fields":["line_key","douyin_id","nickname","profile_url","intent_grade","status=待触达","reached_before","repeat_hits"]}]',
   '[{"probe":"lead_rows_written","asserts":"有意向的评论人都在线索表"},{"probe":"lead_no_delete","asserts":"已有线索没有被删，只更新标记"}]'),
  ('c1000000-0000-4000-8000-000000000105', '回填', '把发私信的结果写回线索表', 'code',
   '每条发过的线索在线索表里都有最新的触达状态',
   '[{"type":"OutreachOrder","cardinality":"many","fields":["lead_record_id","result"]}]',
   '[{"type":"Lead","effect":"update","cardinality":"many","fields":["send_status","reached_at","sender_id","script_id"]}]',
   '[{"probe":"out_no_stuck_inflight","asserts":"收工后线索表没有悬空的「触达中」"}]'),
  ('c1000000-0000-4000-8000-000000000106', '收尾', '关闭 App、回安全桌面、放锁（原「归位」）', 'code',
   '每次占手机的运行结束都关掉 App、让手机回到安全桌面、放掉设备锁',
   '[{"type":"Device","fields":["serial","lock_holder"]}]',
   '[{"type":"Device","effect":"update","fields":["app_closed","safe_desktop","lock_holder=null"]}]',
   '[{"probe":"cl_app_closed","asserts":"抖音已关闭"},{"probe":"cl_lock_released","asserts":"设备锁已释放"}]')
  ) AS v(id, name, description, executor, promise, inputs, outputs, readback)
 WHERE EXISTS (SELECT 1 FROM capabilities WHERE id = 'a1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ===== 四条新流程（source_repo 留空，见文件头）=====
INSERT INTO workflows (id, capability_id, key, name, channel, form, version, status)
SELECT v.id::uuid, 'a1000000-0000-4000-8000-000000000001', v.key, v.name, 'douyin', v.form, '1.0', 'paused'
  FROM (VALUES
  ('b1000000-0000-4000-8000-000000000101', 'douyin_video_discovery',  '抖音·视频发现', 'android_rpa'),
  ('b1000000-0000-4000-8000-000000000102', 'douyin_video_processing', '抖音·视频处理', 'android_rpa'),
  ('b1000000-0000-4000-8000-000000000103', 'douyin_comment_scoring',  '抖音·评论评分', 'pipeline'),
  ('b1000000-0000-4000-8000-000000000104', 'douyin_lead_outreach',    '抖音·线索触达', 'android_rpa')
  ) AS v(id, key, name, form)
 WHERE EXISTS (SELECT 1 FROM capabilities WHERE id = 'a1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, active)
SELECT r.workflow_id::uuid, r.slot_key, r.activity_id::uuid, r.seq, true
  FROM (VALUES
  ('b1000000-0000-4000-8000-000000000101', 'preflight',     'd27e18c9-709f-4c44-899c-85d6fb83671b', 1),
  ('b1000000-0000-4000-8000-000000000101', 'source',        'c1000000-0000-4000-8000-000000000101', 2),
  ('b1000000-0000-4000-8000-000000000101', 'dedup',         'c1000000-0000-4000-8000-000000000102', 3),
  ('b1000000-0000-4000-8000-000000000101', 'write_videos',  'c1000000-0000-4000-8000-000000000103', 4),
  ('b1000000-0000-4000-8000-000000000101', 'cleanup',       'c1000000-0000-4000-8000-000000000106', 5),
  ('b1000000-0000-4000-8000-000000000102', 'preflight',     'd27e18c9-709f-4c44-899c-85d6fb83671b', 1),
  ('b1000000-0000-4000-8000-000000000102', 'qualification', '27973f66-3033-4127-82d2-6248443e739b', 2),
  ('b1000000-0000-4000-8000-000000000102', 'collection',    '9b8988e9-a22d-483c-a101-8091728b9e04', 3),
  ('b1000000-0000-4000-8000-000000000102', 'cleanup',       'c1000000-0000-4000-8000-000000000106', 4),
  ('b1000000-0000-4000-8000-000000000103', 'scoring',       '81e8a55f-1939-454c-b61b-f320055ee5d5', 1),
  ('b1000000-0000-4000-8000-000000000103', 'mark_leads',    'c1000000-0000-4000-8000-000000000104', 2),
  ('b1000000-0000-4000-8000-000000000104', 'preflight',     'd27e18c9-709f-4c44-899c-85d6fb83671b', 1),
  ('b1000000-0000-4000-8000-000000000104', 'send_dm',       'bb4fdc47-a543-4374-9078-8e78151b69c6', 2),
  ('b1000000-0000-4000-8000-000000000104', 'write_back',    'c1000000-0000-4000-8000-000000000105', 3),
  ('b1000000-0000-4000-8000-000000000104', 'cleanup',       'c1000000-0000-4000-8000-000000000106', 4)
  ) AS r(workflow_id, slot_key, activity_id, seq)
 WHERE EXISTS (SELECT 1 FROM workflows w WHERE w.id = r.workflow_id::uuid)
   AND EXISTS (SELECT 1 FROM activities a WHERE a.id = r.activity_id::uuid)
ON CONFLICT (workflow_id, slot_key) DO NOTHING;

-- ===== 闹钟总账改挂（只动仍挂在旧「抖音·关键词获客」上的行；不碰 updated_at——ops-collector 用它判本轮未见即下线） =====
UPDATE ops_schedule_entries SET workflow_id = 'b1000000-0000-4000-8000-000000000101'
 WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001'
   AND id IN (321856, 321860, 321863, 508370, 508371, 508372, 508373, 508374, 508375, 508390, 508391)
   AND EXISTS (SELECT 1 FROM workflows WHERE id = 'b1000000-0000-4000-8000-000000000101');

UPDATE ops_schedule_entries SET workflow_id = 'b1000000-0000-4000-8000-000000000104'
 WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001' AND id = 508368
   AND EXISTS (SELECT 1 FROM workflows WHERE id = 'b1000000-0000-4000-8000-000000000104');

-- 在用的看护项：护航 / 日志桥 / 哨兵 / 锁回收 / 手机恢复 / Manager 巡检与晨会对账 / 情报日报 / 判定抽查 / 漂移 / liveness / 对账 / lost-deadline / trend
UPDATE ops_schedule_entries SET workflow_id = NULL
 WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001' AND enabled
   AND id IN (508324, 508325, 508353, 507761, 431537, 485365, 478538, 527141, 545628, 508389,
              64634, 507760, 507762, 508303, 64609, 508392, 508369, 64601, 64597, 64611);

INSERT INTO schema_version (version, description)
VALUES ('533', '获客重组：智能获客 + 抖音·视频发现/视频处理/评论评分/线索触达，旧流程并存')
ON CONFLICT (version) DO NOTHING;

COMMIT;
