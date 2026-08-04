-- Migration 384: decisions.category NFR 类别定家
--
-- 目的：
--   1. 将 category 从无约束 varchar(50) 升格为有正式 CHECK 约束的枚举型列
--   2. 'nfr' 列入正式许可集（migration 373 已写入 nfr 行但无约束保障）
--   3. 覆盖全部现存线上值（architecture/bug-fix/decision/feature/governance/
--      infra/invariant/judgment/nfr/small-change/technical）
--
-- 幂等：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT，对已有约束安全重跑。

ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_category_chk;
ALTER TABLE decisions ADD CONSTRAINT decisions_category_chk
  CHECK (
    category IS NULL
    OR category IN (
      'architecture',
      'bug-fix',
      'decision',
      'feature',
      'governance',
      'infra',
      'invariant',
      'judgment',
      'nfr',
      'small-change',
      'technical'
    )
  );

COMMENT ON COLUMN decisions.category IS
  '决策类别。nfr = NFR步骤级决策（目标：由 CI/E2E 闸写回 assertion_ref，禁手填）。';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('384', 'decisions.category formal CHECK constraint incl. nfr', NOW())
ON CONFLICT (version) DO NOTHING;
