-- 544: decisions_category_chk 补 general（只增不减）
--
-- 路由 POST /api/brain/strategic-decisions 不带 category 时默认写 'general'，Dashboard 决策登记台也显式传 'general'，
-- 但迁移 384 的白名单不含它：从迁移建出的库（CI 空库 / 全新部署）上这类请求直接被约束拒绝。
-- 线上约束已在迁移外加宽过（26 值），所以这里读出现有取值与 {'general'} 求并集重建，绝不收窄。
-- NOT VALID：不扫存量行，历史数据不会让迁移失败；新写入照样受约束。重跑并集不变，幂等。
BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  cur_def text;
  vals text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO cur_def
  FROM pg_constraint
  WHERE conrelid = 'decisions'::regclass AND conname = 'decisions_category_chk';

  IF cur_def IS NULL THEN
    vals := ARRAY['architecture','bug-fix','decision','deployment','feature','governance',
                  'infra','invariant','judgment','nfr','small-change','technical','testing'];
  ELSE
    SELECT array_agg(m[1]) INTO vals
    FROM regexp_matches(cur_def, '''([^'']+)''::', 'g') AS m;
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO vals
  FROM unnest(COALESCE(vals, ARRAY[]::text[]) || ARRAY['general']) AS v;

  ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_category_chk;
  EXECUTE format(
    'ALTER TABLE decisions ADD CONSTRAINT decisions_category_chk CHECK (category IS NULL OR category IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(vals) AS v)
  );
END $$;

INSERT INTO schema_version (version, description)
VALUES ('544', 'decisions_category_chk 补 general（只增不减）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
