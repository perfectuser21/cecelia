-- 538: 裁判结果落库（决策 de6dff5d 五块模型：树+仓库+账本+裁判+发布线，第 2 步 裁判接线）
-- 一次运行的 span 入库后，Brain 去抖异步对涉及的每个 Activity 跑收敛对账（lib/step-reconcile.js reconcileActivity），
-- 每次裁判追加一行：裁决、连续绿/要求绿、对账窗口运行数、触发方式、完整报告。只追加：UPDATE/DELETE 由触发器拒绝。
-- activity_id 不加外键：Activity 被删时裁判史保留，也不阻塞删除；定义版本不可变（迁移 513），可放心外键。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS activity_judgments (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id                     uuid NOT NULL,
  activity_definition_version_id  uuid REFERENCES activity_definition_versions(id),
  verdict                         text NOT NULL CHECK (verdict IN ('converged', 'converging', 'diverged', 'no_data')),
  converged                       boolean NOT NULL,
  consecutive_green               integer NOT NULL CHECK (consecutive_green >= 0),
  required_green                  integer NOT NULL CHECK (required_green >= 1),
  runs_considered                 integer NOT NULL CHECK (runs_considered >= 0),
  trigger_kind                    text NOT NULL CHECK (trigger_kind IN ('auto', 'manual')),
  trigger_ref                     text,
  report                          jsonb NOT NULL,
  judged_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_judgments_activity_judged ON activity_judgments (activity_id, judged_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_judgments_version ON activity_judgments (activity_definition_version_id)
  WHERE activity_definition_version_id IS NOT NULL;

COMMENT ON TABLE activity_judgments IS '裁判结果（只追加）：每次对 Activity 收敛对账的裁决与完整报告（决策 de6dff5d）';
COMMENT ON COLUMN activity_judgments.activity_definition_version_id IS '对账窗口内最新一条带版本的 span 的 Activity 定义版本；旧协议 span 无版本时为空';
COMMENT ON COLUMN activity_judgments.trigger_ref IS '自动裁判：触发它的运行 run_id';

CREATE OR REPLACE FUNCTION activity_judgments_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '裁判结果只追加：禁止 UPDATE/DELETE activity_judgments';
END $$;

DROP TRIGGER IF EXISTS activity_judgments_append_only ON activity_judgments;
CREATE TRIGGER activity_judgments_append_only BEFORE UPDATE OR DELETE ON activity_judgments
  FOR EACH ROW EXECUTE FUNCTION activity_judgments_append_only();

INSERT INTO schema_version (version, description)
VALUES ('538', '裁判结果 activity_judgments：Activity 收敛对账每次一行，只追加')
ON CONFLICT (version) DO NOTHING;

COMMIT;
