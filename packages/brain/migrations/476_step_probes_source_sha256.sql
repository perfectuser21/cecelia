-- Migration 476: step_probes 加 source_sha256——探针文件整文件哈希（链 bf5088a3 棒2 后续，决策 702949b6）
--
-- 哈希两级并存：
--   * spec_hash     逐条 sha256(canonical JSON(spec))：哪条探针变了
--   * source_sha256 整文件原文 sha256（与 workspace checks/probes-lib.js loadChecks().sha256 同口径）：
--                   仓库那份 YAML 是不是库里登记的这一版；同 workflow 下多个值并存 = 半同步，drift-check 判不匹配
-- 可空：旧行/未带文件哈希的写入不强制。

ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS source_sha256 text;

ALTER TABLE step_probes DROP CONSTRAINT IF EXISTS step_probes_source_sha256_check;
ALTER TABLE step_probes
  ADD CONSTRAINT step_probes_source_sha256_check
    CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN step_probes.source_sha256 IS
  '探针 YAML 整文件原文 sha256（同 workspace probes-lib loadChecks().sha256）；与逐条 spec_hash 并存。';

INSERT INTO schema_version (version, description)
VALUES ('476', 'step_probes.source_sha256：探针文件整文件哈希，与逐条 spec_hash 两级并存')
ON CONFLICT (version) DO NOTHING;
