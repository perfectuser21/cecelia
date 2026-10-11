-- 552: decisions_made_by_check 补 ai（只增不减）
--
-- 迁移 193 给 decisions.made_by 定了列级 CHECK（user/cecelia/system），AI 判定点写 made_by='ai' 被拒。
-- 按列而非按约束名找出所有涉及 made_by 的 CHECK（防迁移外改名/另加），取值求并集后补 ai，收敛成唯一一个 decisions_made_by_check。
-- 多列 CHECK 或无法解析取值的定义直接报错回滚，不留一个照样拒 ai 的约束。
-- NOT VALID：不扫存量行；不动列类型与默认值。重跑并集不变，幂等。
BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  made_by_attnum smallint;
  con record;
  con_vals text[];
  vals text[] := ARRAY[]::text[];
  found_any boolean := false;
BEGIN
  SELECT attnum INTO made_by_attnum
  FROM pg_attribute
  WHERE attrelid = 'decisions'::regclass AND attname = 'made_by' AND NOT attisdropped;

  FOR con IN
    SELECT conname, conkey, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'decisions'::regclass AND contype = 'c' AND made_by_attnum = ANY(conkey)
  LOOP
    IF array_length(con.conkey, 1) > 1 THEN
      RAISE EXCEPTION 'decisions 上约束 % 是涉及 made_by 的多列 CHECK，无法安全补 ai：%', con.conname, con.def;
    END IF;

    SELECT array_agg(m[1]) INTO con_vals
    FROM regexp_matches(con.def, '''([^'']+)''::', 'g') AS m;
    IF con_vals IS NULL THEN
      RAISE EXCEPTION 'decisions 上约束 % 无法解析出 made_by 取值：%', con.conname, con.def;
    END IF;

    vals := vals || con_vals;
    found_any := true;
  END LOOP;

  IF NOT found_any THEN
    vals := ARRAY['user','cecelia','system'];
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO vals
  FROM unnest(vals || ARRAY['ai']) AS v;

  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'decisions'::regclass AND contype = 'c' AND made_by_attnum = ANY(conkey)
  LOOP
    EXECUTE format('ALTER TABLE decisions DROP CONSTRAINT %I', con.conname);
  END LOOP;

  EXECUTE format(
    'ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(vals) AS v)
  );
END $$;

INSERT INTO schema_version (version, description)
VALUES ('552', 'decisions_made_by_check 补 ai（只增不减）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
