-- 552: decisions_made_by_check 补 ai（只增不减）
--
-- 迁移 193 给 decisions.made_by 定了列级 CHECK（user/cecelia/system），AI 判定点写 made_by='ai' 被拒。
-- 按列而非按约束名找出所有涉及 made_by 的 CHECK（防迁移外改名/另加），取值求并集后补 ai，收敛成唯一一个 decisions_made_by_check。
-- 多列 CHECK、或取值抽不全（抽出值回放重建后与原表达式不一致）的定义直接报错回滚，不留拒 ai 的约束也不静默丢值。
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
  made_by_type text;
  probe_expr text;
BEGIN
  SELECT attnum, format_type(atttypid, atttypmod) INTO made_by_attnum, made_by_type
  FROM pg_attribute
  WHERE attrelid = 'decisions'::regclass AND attname = 'made_by' AND NOT attisdropped;

  FOR con IN
    SELECT conname, conkey, pg_get_constraintdef(oid) AS def, pg_get_expr(conbin, conrelid) AS expr
    FROM pg_constraint
    WHERE conrelid = 'decisions'::regclass AND contype = 'c' AND made_by_attnum = ANY(conkey)
  LOOP
    IF array_length(con.conkey, 1) > 1 THEN
      RAISE EXCEPTION 'decisions 上约束 % 是涉及 made_by 的多列 CHECK，无法安全补 ai：%', con.conname, con.def;
    END IF;

    -- 字面量可为空串、可含 SQL 双单引号转义：抽取后把 '' 还原成 '
    SELECT array_agg(replace(m.v[1], '''''', '''') ORDER BY m.n) INTO con_vals
    FROM regexp_matches(con.expr, '''((?:[^'']|'''')*)''::', 'g') WITH ORDINALITY AS m(v, n);
    IF con_vals IS NULL THEN
      RAISE EXCEPTION 'decisions 上约束 % 无法解析出 made_by 取值：%', con.conname, con.def;
    END IF;

    -- 回放校验：用抽出的取值在同类型探针列上重建 IN 约束，表达式须与原约束逐字一致，否则（含 NULL 项等）报错回滚
    EXECUTE format('CREATE TEMP TABLE pg_temp.decisions_made_by_probe (made_by %s, CONSTRAINT probe_chk CHECK (made_by IN (%s))) ON COMMIT DROP',
      made_by_type, (SELECT string_agg(quote_literal(v), ', ') FROM unnest(con_vals) AS v));
    SELECT pg_get_expr(conbin, conrelid) INTO probe_expr
    FROM pg_constraint WHERE conrelid = 'pg_temp.decisions_made_by_probe'::regclass AND conname = 'probe_chk';
    DROP TABLE pg_temp.decisions_made_by_probe;
    IF probe_expr IS DISTINCT FROM con.expr THEN
      RAISE EXCEPTION 'decisions 上约束 % 无法解析出完整的 made_by 取值（回放不一致）：%', con.conname, con.def;
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
