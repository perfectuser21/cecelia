-- 用户决定 26e8e446-b2b0-4857-ad4f-a758a8daa39c：新四流程替代旧两入口。
-- 仅登记契约真身与退役状态；新流程首次登记仍paused，验收前不得激活。
-- source_capability是技术contract_key；业务capability_id不改，旧owner及历史版本不删。
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('shared-activity-contracts'));
CREATE TEMP TABLE m536_targets(id uuid PRIMARY KEY,key text,source_capability text,source_workflow text,is_new boolean) ON COMMIT DROP;
INSERT INTO m536_targets VALUES
 ('b1000000-0000-4000-8000-000000000001','douyin_keyword_leadgen','keyword_acquisition','social-keyword-leadgen',false),
 ('b1000000-0000-4000-8000-000000000002','douyin_benchmark_leadgen','benchmark_link_acquisition','social-benchmark-leadgen',false),
 ('b1000000-0000-4000-8000-000000000101','douyin_video_discovery','douyin_video_discovery','douyin-video-discovery',true),
 ('b1000000-0000-4000-8000-000000000102','douyin_video_processing','douyin_video_processing','douyin-video-processing',true),
 ('b1000000-0000-4000-8000-000000000103','douyin_comment_scoring','douyin_comment_scoring','douyin-comment-scoring',true),
 ('b1000000-0000-4000-8000-000000000104','douyin_lead_outreach','douyin_lead_outreach','douyin-lead-outreach',true);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM workflows w JOIN m536_targets t USING(id);
 -- 全空仅容许无业务种子的隔离/新库；部分骨架或身份冲突不许记迁移成功。
 IF n NOT IN (0,6) THEN RAISE EXCEPTION 'LEADGEN_SPLIT_REGISTRATION_INCOMPLETE: found %/6 workflows',n; END IF;
 IF EXISTS(SELECT 1 FROM workflows w JOIN m536_targets t USING(id) WHERE w.key<>t.key
   OR (t.is_new AND w.capability_id IS DISTINCT FROM 'a1000000-0000-4000-8000-000000000001'::uuid)
   OR (NOT t.is_new AND (w.source_repo,w.source_path,w.source_workflow,w.source_capability) IS DISTINCT FROM
     ('perfectuser21/zenithjoy-workspace','product-map/contracts/'||t.source_capability||'.yaml',t.source_workflow,t.source_capability))
   OR (t.is_new AND NOT ((w.status='paused' AND w.source_repo IS NULL AND w.source_path IS NULL AND w.source_workflow IS NULL AND w.source_capability IS NULL)
     OR ((w.source_repo,w.source_path,w.source_workflow,w.source_capability) IS NOT DISTINCT FROM
       ('perfectuser21/zenithjoy-workspace','product-map/contracts/'||t.source_capability||'.yaml',t.source_workflow,t.source_capability)))))
 THEN RAISE EXCEPTION 'LEADGEN_SPLIT_REGISTRATION_IDENTITY_CONFLICT'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS migration_536_backup(id uuid PRIMARY KEY,row jsonb NOT NULL,applied jsonb NOT NULL);
INSERT INTO migration_536_backup(id,row,applied)
SELECT w.id,to_jsonb(w),jsonb_build_object(
 'source_repo','perfectuser21/zenithjoy-workspace','source_path','product-map/contracts/'||t.source_capability||'.yaml',
 'source_workflow',t.source_workflow,'source_capability',t.source_capability,
 'status',CASE WHEN NOT t.is_new THEN 'retired' WHEN w.source_repo IS NULL THEN 'paused' ELSE w.status END)
 FROM workflows w JOIN m536_targets t USING(id)
ON CONFLICT(id) DO NOTHING;
UPDATE workflows w SET source_repo='perfectuser21/zenithjoy-workspace',source_path='product-map/contracts/'||t.source_capability||'.yaml',
 source_workflow=t.source_workflow,source_capability=t.source_capability,status='paused',updated_at=now()
 FROM m536_targets t WHERE w.id=t.id AND t.is_new
 AND (w.source_repo,w.source_path,w.source_workflow,w.source_capability) IS DISTINCT FROM
   ('perfectuser21/zenithjoy-workspace','product-map/contracts/'||t.source_capability||'.yaml',t.source_workflow,t.source_capability);
UPDATE workflows w SET status='retired',updated_at=now() FROM m536_targets t
 WHERE w.id=t.id AND NOT t.is_new AND w.status IS DISTINCT FROM 'retired';
-- REGISTRATIONS_SQL保留retired定义owner；sync消费者过滤retired，后续固定commit同步创建新current版本。
-- 不移动/删除steps、activity_cells、workflow_definition_versions、release_versions或冻结run bindings。
INSERT INTO schema_version(version,description) VALUES('536','智能获客四新source登记paused，旧两workflow退役并保留定义owner及历史') ON CONFLICT(version) DO NOTHING;
COMMIT;
