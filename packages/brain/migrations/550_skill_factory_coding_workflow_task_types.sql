-- 迁移 550（任务 0a70684f，派发总闸 F）：技能工厂执行单 / 编码 workflow 各立独立 task_type。
--
-- 一、tasks_task_type_check 追加 skill_factory_run / coding_workflow
--     在现有约束定义上追加（同 504/549 写法），不重抄全量名单，避免与并行迁移互相覆盖。
-- 二、在途借壳单迁到新类型（只动 queued / in_progress；终态行保留历史类型不改写）：
--     research + payload.factory_dispatch=true  → skill_factory_run（kind=agent 不变）
--     data     + payload.coding_workflow=true   → coding_workflow（kind=workflow）
--     tasks 的路由投影受 421 触发器保护（task_type 必须等于最新路由收据 canonical_task_type），收据 append-only（413），
--     所以每条先插一张接班收据（supersedes_receipt_id + anchor_generation+1，其余列原样照抄，同 base-sha-reanchor 手法），
--     再同一条 UPDATE 改 task_type + payload.routing_receipt_id。每条写 task_events（task_type_migrated）。
--     领单方（factory-dispatcher / coding-workflow-runner）同 PR 已兼容新旧两种形状，迁移与代码上线先后无关。
BEGIN;
DO $$ DECLARE definition TEXT; t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['skill_factory_run', 'coding_workflow'] LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
     WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_task_type_check';
    IF definition IS NULL THEN RAISE EXCEPTION 'missing tasks_task_type_check'; END IF;
    IF position(quote_literal(t) IN definition) > 0 THEN CONTINUE; END IF;
    ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check;
    EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK ((%s) OR task_type = %L)',
      substring(definition FROM 8 FOR length(definition) - 8), t);
  END LOOP;
END $$;

DO $$
DECLARE
  rec RECORD;
  old_receipt work_routing_receipts%ROWTYPE;
  new_receipt_id uuid;
  old_receipt_id uuid;
BEGIN
  FOR rec IN
    SELECT id, status, task_type AS from_type,
           CASE WHEN task_type = 'research' THEN 'skill_factory_run' ELSE 'coding_workflow' END AS to_type
      FROM tasks
     WHERE status IN ('queued', 'in_progress')
       AND ((task_type = 'research' AND payload->>'factory_dispatch' = 'true')
         OR (task_type = 'data' AND payload->>'coding_workflow' = 'true'))
     ORDER BY created_at
  LOOP
    new_receipt_id := NULL;
    old_receipt_id := NULL;
    SELECT * INTO old_receipt FROM work_routing_receipts
     WHERE task_id = rec.id ORDER BY anchor_generation DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      old_receipt_id := old_receipt.id;
      INSERT INTO work_routing_receipts
      SELECT (jsonb_populate_record(NULL::work_routing_receipts, to_jsonb(old_receipt) || jsonb_build_object(
        'id', gen_random_uuid(),
        'canonical_task_type', rec.to_type,
        'supersedes_receipt_id', old_receipt.id,
        'anchor_generation', old_receipt.anchor_generation + 1,
        'created_at', clock_timestamp()))).*
      RETURNING id INTO new_receipt_id;
    END IF;

    UPDATE tasks
       SET task_type = rec.to_type,
           kind = CASE WHEN rec.to_type = 'coding_workflow' THEN 'workflow' ELSE kind END,
           payload = CASE WHEN new_receipt_id IS NULL THEN payload
                          ELSE payload || jsonb_build_object('routing_receipt_id', new_receipt_id::text) END,
           updated_at = NOW()
     WHERE id = rec.id;

    INSERT INTO task_events (task_id, event_type, payload, created_at)
    VALUES (rec.id, 'task_type_migrated', jsonb_build_object(
      'from', rec.from_type, 'to', rec.to_type, 'status', rec.status,
      'old_receipt_id', old_receipt_id, 'new_receipt_id', new_receipt_id,
      'migration', '550', 'task', '0a70684f',
      'reason', CASE WHEN rec.to_type = 'skill_factory_run'
        THEN '技能工厂执行单独立类型：不再借 research + headed_manual 挡 tick'
        ELSE '编码 workflow 独立类型：不再借 data + headed_manual + coding_workflow 三件套（c8fab3c8 漏 headed_manual 卡死同病）' END
    ), NOW());
  END LOOP;
END $$;

INSERT INTO schema_version (version, description)
VALUES ('550', 'tasks_task_type_check 纳入 skill_factory_run / coding_workflow，在途借壳单迁新类型（派发总闸 F）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
