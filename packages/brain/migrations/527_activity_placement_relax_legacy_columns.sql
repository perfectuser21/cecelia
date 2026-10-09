-- 527: 树+仓库 v3.0 第 5 刀②——Activity 在树里的位置改由流程引用推出
-- 树是 价值流 → 能力 → 流程 → Activity。Activity 上的旧直挂列（journey_id 指向能力、step_number 记顺序）与这条树重复，要清理。
-- 本迁移只做「先把路铺好」，不删列（等读者与写入方都迁完，下一迁移再删）：
--   ① activity_placement 视图：每个 Activity 一行，位置（能力 / 流程 / 顺序 / 槽位）从生效的流程引用推出；
--      被多个流程共用时，定义归属那条（引用的 source_ref 为空）优先，其余按流程创建先后。读者改读它，不再碰旧列。
--   ② journey_id / step_number 放开非空，去掉按它们唯一的约束与索引：新写入的 Activity 不再带这两列。
--   ③ Activity 身份改按 (capability_key, activity_key) 唯一（合同来源的 Activity 一直是这个身份；原先靠 journey_id 的那条唯一索引随 ② 删除）。
BEGIN;

CREATE VIEW activity_placement AS
SELECT DISTINCT ON (r.activity_id)
       r.activity_id,
       w.capability_id,
       w.id AS workflow_id,
       r.sequence_no AS step_number,
       r.slot_key,
       (r.source_ref IS NULL) AS is_owner
  FROM workflow_activity_refs r
  JOIN workflows w ON w.id = r.workflow_id
 WHERE r.active
 ORDER BY r.activity_id, (r.source_ref IS NULL) DESC, w.created_at, r.id;

COMMENT ON VIEW activity_placement IS '每个 Activity 在树里的位置（从生效的流程引用推出）：capability_id / workflow_id / step_number（流程内顺序）/ slot_key / is_owner（定义归属那条引用）。取代 activities.journey_id / step_number。';

ALTER TABLE activities ALTER COLUMN journey_id DROP NOT NULL;
ALTER TABLE activities ALTER COLUMN step_number DROP NOT NULL;

DROP INDEX IF EXISTS uq_journey_steps_activity;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_journey_id_step_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_capability_activity ON activities (capability_key, activity_key) WHERE activity_key IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('527', 'v3.0 第 5 刀②：activity_placement 视图（位置由流程引用推出），journey_id/step_number 放开非空并去掉按它们唯一的约束，Activity 身份改按 (capability_key, activity_key) 唯一')
ON CONFLICT (version) DO NOTHING;

COMMIT;
