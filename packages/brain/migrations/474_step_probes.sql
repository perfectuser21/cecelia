-- Migration 474: step_probes 探针注册表——步级断言第四种形状「探针」的 Brain 侧投影
--（链 bf5088a3 棒2，任务 ddf3fe8d，决策 702949b6）
--
-- 步级断言链 journey_step_links.assertion_ref → runner → journey_assertion_receipts → cell 翻色
-- 原来只认 vitest/pytest/smoke。探针 = 业务侧 SQL/HTTP 探测 + 期望值（severity warn|error），
-- 由 business_probe_runner 执行（棒3a），assertion_ref 形状 `probe:<key>`（一格多条 `probe:<k1>,<k2>`）。
--
-- SSOT 是仓库 YAML（services/<svc>/checks/<workflow>.yaml），本表只是投影：
--   * spec       归一化后的探针全文（key/workflow/stage/journey_cell/probe/expect/severity/note）
--   * spec_hash  sha256(canonical JSON(spec))——同 skill_registry 清单哈希做法，YAML 现算 ≠ 库 → 漂移即报
--   * journey_step_link_id  绑到哪个格子（sync 脚本按 journey_cell 找 cell 回填；格子删了 → NULL 留痕）
--   * active     YAML 删掉的探针不物理删，翻 false（漂移比对把 inactive 视为库无）

CREATE TABLE IF NOT EXISTS step_probes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    probe_key text NOT NULL UNIQUE,
    workflow text NOT NULL,
    stage text NOT NULL,
    journey_step_link_id uuid REFERENCES journey_step_links(id) ON DELETE SET NULL,
    spec jsonb NOT NULL,
    spec_hash text NOT NULL,
    source_path text,
    severity text NOT NULL DEFAULT 'error',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_severity_check;
ALTER TABLE step_probes
  ADD CONSTRAINT step_probes_severity_check
    CHECK (severity IN ('warn', 'error'));

ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_spec_hash_check;
ALTER TABLE step_probes
  ADD CONSTRAINT step_probes_spec_hash_check
    CHECK (spec_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_step_probes_workflow_stage ON step_probes(workflow, stage);
CREATE INDEX IF NOT EXISTS idx_step_probes_link ON step_probes(journey_step_link_id);

COMMENT ON TABLE step_probes IS
  '步级探针注册表（决策 702949b6）：仓库 YAML 是 SSOT，本表存归一化 spec + sha256 哈希，漂移即报；assertion_ref 形状 probe:<key>。';
COMMENT ON COLUMN step_probes.spec IS
  '归一化探针：{key, workflow, stage, journey_cell:"stage:<name>", probe:{type:sql|http,target,query|url}, expect:{op:>=|==|<=|not_null_all, value?|ref?:"metrics.<k>"}, severity, note?}';
COMMENT ON COLUMN step_probes.spec_hash IS
  'sha256(canonical JSON(spec))，键排序、数组保序；与 YAML 现算不一致 = 漂移。';

INSERT INTO schema_version (version, description)
VALUES ('474', 'step_probes 探针注册表：步级断言第四种形状 probe:<key>，仓库 YAML 为 SSOT、Brain 存 spec_hash 漂移即报')
ON CONFLICT (version) DO NOTHING;
