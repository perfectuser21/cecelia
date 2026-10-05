-- 526: 树+仓库 v3.0 第 5 刀①——没有流程的 Activity 挂进流程
-- 树是 价值流 → 能力 → 流程 → Activity。128 个未退役 Activity 里只有 52 个挂进了流程，另外 76 个是老的「黄金路径步骤」，
-- 直接记在能力下（activities.journey_id），中间没有流程。清理旧直挂列之前，先让每个 Activity 都经流程挂在能力下：
--   ① 所属能力下恰好一个流程 → 挂进去；没有流程或有多个流程 → 新建「主线」流程（key=gp_steps_<能力id前8位>）再挂，不替别的流程做主；
--   ② 引用的顺序取 step_number，槽位 step_<n>；source_ref 留空表示「定义归属」（被别的流程共用时，别的流程那条引用才有 source_ref）；
--   ③ 只处理未退役、且没有生效引用的 Activity，已有引用的不动，重跑幂等；本迁移挂的引用 source_path 标 migration:526，便于回滚。
BEGIN;

INSERT INTO workflows (capability_id, key, name, channel, version, status)
SELECT c.id, 'gp_steps_' || left(c.id::text, 8), c.name || ' · 主线', 'internal', '1.0', 'active'
  FROM capabilities c
 WHERE EXISTS (
         SELECT 1 FROM activities a
          WHERE a.journey_id = c.id AND a.status <> 'deprecated'
            AND NOT EXISTS (SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id = a.id AND r.active))
   AND (SELECT count(*) FROM workflows w WHERE w.capability_id = c.id AND w.key NOT LIKE 'gp_steps_%') <> 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, source_path, active)
SELECT wf.id, 'step_' || a.step_number, a.id, a.step_number, 'migration:526', true
  FROM activities a
  JOIN LATERAL (
         SELECT w.id FROM workflows w
          WHERE w.capability_id = a.journey_id
          ORDER BY (w.key = 'gp_steps_' || left(a.journey_id::text, 8)) DESC, w.created_at
          LIMIT 1) wf ON true
 WHERE a.status <> 'deprecated'
   AND a.step_number > 0
   AND NOT EXISTS (SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id = a.id AND r.active)
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('526', 'v3.0 第 5 刀①：无生效流程引用的 Activity 挂进所属能力的流程（无流程/多流程的能力建 gp_steps 主线流程），为清理 journey_id/step_number 旧直挂列铺路')
ON CONFLICT (version) DO NOTHING;

COMMIT;
