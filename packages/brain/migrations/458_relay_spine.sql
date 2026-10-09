-- Migration 458: 接力棒·脊柱（任务链真列 + project 根类型）
--
-- 主理人 2026-09-23 拍板：任务留痕与长链要进系统，不能靠人脑记。
-- 病根实测（tasks 表 2026-09-22）：
--   · payload->>'parent_task_id' 只有 75 条且塞在 json 里，POST 传的 parent_task_id 被静默丢弃；
--   · 没有"项目"对象：initiative_contracts 409 行全是 approved/superseded，是合同不是进度；
--   · handoff 写了没人读（getRecentHandoffs 零调用），next_steps 不会变成下一棒。
-- 本刀只铺地基（列 + 类型 + 回填），接棒/闸/投影在后两刀。
--
-- 一、tasks.parent_task_id / sequence_no 真列
--     parent_task_id 指向同表（project 根或上一级），ON DELETE SET NULL 防级联删历史。
--     sequence_no = 在父下的顺序号，项目里程碑按它排。
-- 二、回填：payload.parent_task_id 是合法 uuid 且父存在且不指向自己 → 抄进真列。
-- 三、task_type 加 'project'：DO 块读当前约束定义、在 ARRAY 末尾插入，
--     不重抄 82 个值（457 的教训：抄旧列表会把后加的值打死）。
-- 全部幂等：CI 会重放全部 migration。

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sequence_no INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_parent_task_id_fkey'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_parent_task_id_fkey
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

COMMENT ON COLUMN tasks.parent_task_id IS
  '接力棒脊柱：父任务（project 根或上一级）。同表自引用，ON DELETE SET NULL。派发时沿它找根注入项目上下文。';
COMMENT ON COLUMN tasks.sequence_no IS
  '在父任务下的顺序号（里程碑序）。next_steps 自动登记时取 max+1。';

UPDATE tasks t
   SET parent_task_id = (t.payload->>'parent_task_id')::uuid
 WHERE t.parent_task_id IS NULL
   AND t.payload->>'parent_task_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   AND (t.payload->>'parent_task_id')::uuid <> t.id
   AND EXISTS (SELECT 1 FROM tasks p WHERE p.id = (t.payload->>'parent_task_id')::uuid);

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_task_type_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'tasks_task_type_check 不存在，拒绝盲加 project';
  END IF;
  IF def LIKE '%''project''%' THEN
    RETURN;
  END IF;
  -- 在 ARRAY[...] 的第一个 ']' 前插入 'project'
  def := regexp_replace(def, '\]', ', ''project''::character varying]');
  EXECUTE 'ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_check';
  EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check ' || def;
END $$;
