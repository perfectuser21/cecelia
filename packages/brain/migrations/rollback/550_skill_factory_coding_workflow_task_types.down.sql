-- 回滚 550：在途 skill_factory_run / coding_workflow 单先迁回借壳类型（插接班收据，同 550 手法），再从约束里去掉两个值。
-- 终态的新类型行无法迁回（约束仍会拦），需先人工处置这些行再执行；处置前本脚本对它们报错中止。
BEGIN;
DO $$
DECLARE
  rec RECORD;
  old_receipt work_routing_receipts%ROWTYPE;
  new_receipt_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE task_type IN ('skill_factory_run', 'coding_workflow')
              AND status NOT IN ('queued', 'in_progress')) THEN
    RAISE EXCEPTION '存在终态 skill_factory_run / coding_workflow 行，先人工处置再回滚';
  END IF;
  FOR rec IN
    SELECT id, CASE WHEN task_type = 'skill_factory_run' THEN 'research' ELSE 'data' END AS to_type
      FROM tasks WHERE task_type IN ('skill_factory_run', 'coding_workflow')
  LOOP
    new_receipt_id := NULL;
    SELECT * INTO old_receipt FROM work_routing_receipts
     WHERE task_id = rec.id ORDER BY anchor_generation DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO work_routing_receipts
      SELECT (jsonb_populate_record(NULL::work_routing_receipts, to_jsonb(old_receipt) || jsonb_build_object(
        'id', gen_random_uuid(), 'canonical_task_type', rec.to_type, 'supersedes_receipt_id', old_receipt.id,
        'anchor_generation', old_receipt.anchor_generation + 1, 'created_at', clock_timestamp()))).*
      RETURNING id INTO new_receipt_id;
    END IF;
    UPDATE tasks
       SET task_type = rec.to_type,
           kind = 'agent',
           payload = payload || jsonb_build_object('headed_manual', 'true')
             || CASE WHEN new_receipt_id IS NULL THEN '{}'::jsonb
                     ELSE jsonb_build_object('routing_receipt_id', new_receipt_id::text) END,
           updated_at = NOW()
     WHERE id = rec.id;
  END LOOP;
END $$;
DO $$ DECLARE definition TEXT; BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_task_type_check';
  IF definition IS NULL THEN RETURN; END IF;
  definition := replace(definition, ' OR ((task_type)::text = ''skill_factory_run''::text)', '');
  definition := replace(definition, ' OR ((task_type)::text = ''coding_workflow''::text)', '');
  ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check;
  EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check ' || definition;
END $$;
DELETE FROM schema_version WHERE version = '550';
COMMIT;
