-- 546: decisions_made_by_check 补 ai（只增不减）
--
-- 判定点写入（规格 Q-5 的 coding-workflow 请求形状）POST /api/brain/strategic-decisions 带 made_by:'ai'，
-- 但迁移 193 的约束只允许 user/cecelia/system：从迁移建出的库（CI 空库 / 预览环境 / 全新部署）上
-- 这类请求直接被约束拒绝 → 500 且透出约束名。这里读出现有取值与 {'ai'} 求并集重建，绝不收窄（线上若已在迁移外加宽，照样保留）。
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
  WHERE conrelid = 'decisions'::regclass AND conname = 'decisions_made_by_check';

  IF cur_def IS NULL THEN
    vals := ARRAY['cecelia', 'system', 'user'];
  ELSE
    SELECT array_agg(m[1]) INTO vals
    FROM regexp_matches(cur_def, '''([^'']+)''::', 'g') AS m;
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO vals
  FROM unnest(COALESCE(vals, ARRAY[]::text[]) || ARRAY['ai']) AS v;

  ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_made_by_check;
  EXECUTE format(
    'ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(vals) AS v)
  );
END $$;

INSERT INTO schema_version (version, description)
VALUES ('546', 'decisions_made_by_check 补 ai（只增不减）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
