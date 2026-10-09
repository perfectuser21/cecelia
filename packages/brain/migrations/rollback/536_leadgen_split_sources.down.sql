-- 只撤销536写过的metadata；不能覆盖后来的人为状态/来源决定，版本历史一律保留。
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('shared-activity-contracts'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM migration_536_backup b LEFT JOIN workflows w ON w.id=b.id
  WHERE w.id IS NULL OR jsonb_build_object('source_repo',w.source_repo,'source_path',w.source_path,'source_workflow',w.source_workflow,
    'source_capability',w.source_capability,'status',w.status) IS DISTINCT FROM b.applied)
 THEN RAISE EXCEPTION 'LEADGEN_SPLIT_ROLLBACK_CONFLICT: current metadata differs from migration receipt'; END IF;
END $$;
UPDATE workflows w SET source_repo=b.row->>'source_repo',source_path=b.row->>'source_path',
 source_workflow=b.row->>'source_workflow',source_capability=b.row->>'source_capability',status=b.row->>'status',
 updated_at=(b.row->>'updated_at')::timestamptz FROM migration_536_backup b WHERE w.id=b.id;
DELETE FROM schema_version WHERE version='536';
DROP TABLE migration_536_backup;
COMMIT;
