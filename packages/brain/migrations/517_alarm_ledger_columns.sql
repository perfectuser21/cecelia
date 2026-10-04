-- 517: 闹钟总账——扩现成的排程台账 ops_schedule_entries（统一树+闹钟总账第二阶段第4步，task fe10d1a0，决策 9e9d90b6）
-- 不建新表、不另起注册系统：ops_schedule_entries（433）本来就是"排程台账"，缺的只是
--   ① 机器列：多久响一次/是否启用/上次运行/上次成功/最近状态/活性/登记状态
--   ② 挂树列：journey_id（直接挂能力）、workflow_id（有正式 workflow 的再挂）、ops_workflow_id（运行实现）
--   ③ 人工列：owner_manual / note_manual / tree_bucket_manual —— 只由人（Notion 回写）写，机器写入的 SET 子句永不出现
-- 全部 ADD COLUMN IF NOT EXISTS，幂等；既有行取默认值（enabled=TRUE、ledger_status='unregistered'），不改任何既有语义。
BEGIN;

ALTER TABLE ops_schedule_entries
  ADD COLUMN IF NOT EXISTS interval_sec INTEGER,                    -- 有效触发间隔（秒）；钟点型取近似周期（日=86400/周=604800），算不准=NULL
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,   -- 是否启用（采集腿由 last_state='disabled' 推出）
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status TEXT
    CHECK (last_status IS NULL OR last_status IN ('正常','失败','静默','无记录')),
  ADD COLUMN IF NOT EXISTS liveness TEXT
    CHECK (liveness IS NULL OR liveness IN ('ok','warn','dead','cold')),
  ADD COLUMN IF NOT EXISTS silent_sec INTEGER,
  ADD COLUMN IF NOT EXISTS registered_via TEXT
    CHECK (registered_via IS NULL OR registered_via IN ('brain-job','brain-loop','recurring','external-legacy','exempt')),
  ADD COLUMN IF NOT EXISTS ledger_status TEXT NOT NULL DEFAULT 'unregistered'
    CHECK (ledger_status IN ('registered','unregistered','exempt')),
  ADD COLUMN IF NOT EXISTS note TEXT,                               -- 机器备注（盘点/采集写）；人写的在 note_manual
  ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ops_workflow_id BIGINT REFERENCES ops_workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_manual TEXT,
  ADD COLUMN IF NOT EXISTS note_manual TEXT,
  ADD COLUMN IF NOT EXISTS tree_bucket_manual TEXT;                 -- 树上暂时挂不上时的自由文字归属

COMMENT ON COLUMN ops_schedule_entries.ledger_status IS
  'registered=在总账有身份（经 Brain scheduler 注册，或存量基线 external-legacy）；unregistered=采集到但没人登记（棘轮只许降）；exempt=显式豁免';
COMMENT ON COLUMN ops_schedule_entries.registered_via IS
  'brain-job=JOBS 声明 | brain-loop=进程内循环清单 | recurring=recurring_tasks 模板 | external-legacy=存量基线（盘点快照/采集腿存量）| exempt=豁免';
COMMENT ON COLUMN ops_schedule_entries.journey_id IS
  '闹钟挂在 journeys 唯一树的哪个节点（能力优先，退而求其次价值流）；决策 c0948785';
COMMENT ON COLUMN ops_schedule_entries.owner_manual IS '人工列：机器写入的 SET 子句永不出现（同 443 的分区规则）';

CREATE INDEX IF NOT EXISTS idx_ops_schedule_entries_journey ON ops_schedule_entries(journey_id) WHERE journey_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_schedule_entries_ledger ON ops_schedule_entries(ledger_status, registered_via);

INSERT INTO schema_version (version, description)
VALUES ('517', '闹钟总账：ops_schedule_entries 加机器列/挂树列/人工列（不建新表）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
