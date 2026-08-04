-- Migration 384: decisions.category NFR 类别定家
--
-- 目的：
--   1. 将 category 从无约束 varchar(50) 升格为有正式 CHECK 约束的枚举型列
--   2. 'nfr' 列入正式许可集（migration 373 已写入 nfr 行但无约束保障）
--   3. 覆盖全部现存线上值（完整枚举，含 release-gate/process/scope-decision 等历史类别）
--
-- 幂等：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT，对已有约束安全重跑。

ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_category_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_category_chk
  CHECK (
    category IS NULL
    OR category IN (
      '__probe__',
      'architecture',
      'bug-fix',
      'decision',
      'deferred',
      'deployment',
      'feature',
      'general',
      'governance',
      'infra',
      'invariant',
      'issue',
      'judgment',
      'known-limitation',
      'kr3-config',
      'learning',
      'nfr',
      'ops-cleanup',
      'process',
      'process-exception',
      'product-model',
      'release-gate',
      'scope-decision',
      'small-change',
      'technical',
      'test',
      'testing'
    )
  );

COMMENT ON COLUMN decisions.category IS
  '决策类别。nfr = NFR步骤级决策（目标：由 CI/E2E 闸写回 assertion_ref，禁手填）。';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('384', 'decisions.category formal CHECK constraint incl. nfr', NOW())
ON CONFLICT (version) DO NOTHING;
