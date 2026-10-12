/**
 * 迁移 552：decisions_made_by_check 补 ai（只增不减）。
 * 在一个事务里造出各种约束形态（迁移外加宽 / 被删 / 被改名 / 多列）→ 跑迁移正文 → 断言 → 整体 ROLLBACK。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const UP = readFileSync(new URL('../../../migrations/552_decisions_made_by_allow_ai.sql', import.meta.url), 'utf8')
  .split('\n').filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query('BEGIN');
});
afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

const all = async (sql, params) => (await client.query(sql, params)).rows;
const madeByChecks = () => all(`SELECT c.conname, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'decisions'::regclass AND c.contype = 'c' AND a.attname = 'made_by' ORDER BY c.conname`);
const dropAllMadeByChecks = async () => {
  for (const { conname } of await madeByChecks()) await client.query(`ALTER TABLE decisions DROP CONSTRAINT "${conname}"`);
};
const expectValues = (def, values) => {
  for (const v of values) expect(def).toContain(`'${v}'`);
};

describe('迁移 552：decisions_made_by_check 补 ai（只增不减）', () => {
  let firstDef;

  it('预览库已有显式 varchar→text ARRAY 约束可回放，保留取值并补 ai', async () => {
    await client.query('SAVEPOINT preview_cast');
    try {
      await dropAllMadeByChecks();
      await client.query(`ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check
        CHECK (made_by::text = ANY (ARRAY[('user'::character varying)::text,
          ('cecelia'::character varying)::text, ('system'::character varying)::text,
          ('owner''x'::character varying)::text])) NOT VALID`);
      await client.query(UP);
      const checks = await madeByChecks();
      expectValues(checks[0].def, ['user', 'cecelia', 'system', "owner''x", 'ai']);
      const rows = await all(`INSERT INTO decisions (topic, decision, category, made_by)
        VALUES ('t552-preview-ai', 'x', 'judgment', 'ai'), ('t552-preview-owner', 'x', 'judgment', 'owner''x') RETURNING made_by`);
      expect(rows.map((r) => r.made_by)).toEqual(['ai', "owner'x"]);
      await client.query(UP);
      expect(await madeByChecks()).toEqual(checks);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT preview_cast');
    }
  });

  it('迁移外加宽过的取值全部保留，并补上 ai', async () => {
    await dropAllMadeByChecks();
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','owner_x')) NOT VALID");
    await client.query(UP);
    const checks = await madeByChecks();
    expect(checks.map((c) => c.conname)).toEqual(['decisions_made_by_check']);
    expectValues(checks[0].def, ['user', 'cecelia', 'system', 'owner_x', 'ai']);
    firstDef = checks[0].def;
  });

  it('重跑一遍约束定义完全不变（幂等）', async () => {
    await client.query(UP);
    const checks = await madeByChecks();
    expect(checks).toEqual([{ conname: 'decisions_made_by_check', def: firstDef }]);
  });

  it('约束被删过时以 193 三值为底重建并补 ai', async () => {
    await dropAllMadeByChecks();
    await client.query(UP);
    const checks = await madeByChecks();
    expect(checks.map((c) => c.conname)).toEqual(['decisions_made_by_check']);
    expectValues(checks[0].def, ['user', 'cecelia', 'system', 'ai']);
    expect(checks[0].def.match(/'[^']+'::/g)).toHaveLength(4);
  });

  it('约束改过名 / 另有同列约束：全部并入后收敛为唯一的 decisions_made_by_check', async () => {
    await dropAllMadeByChecks();
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_legacy_chk CHECK (made_by IN ('user','cecelia','system','owner_y')) NOT VALID");
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_extra_chk CHECK (made_by IN ('user','owner_z')) NOT VALID");
    await client.query(UP);
    const checks = await madeByChecks();
    expect(checks.map((c) => c.conname)).toEqual(['decisions_made_by_check']);
    expectValues(checks[0].def, ['user', 'cecelia', 'system', 'owner_y', 'owner_z', 'ai']);
  });

  it('迁移外取值含空串与单引号转义时原样保留（commander 裁决 2：J-1）', async () => {
    await client.query('SAVEPOINT special_vals');
    await dropAllMadeByChecks();
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','','owner''x')) NOT VALID");
    await client.query(UP);
    const checks = await madeByChecks();
    expect(checks.map((c) => c.conname)).toEqual(['decisions_made_by_check']);
    expectValues(checks[0].def, ['user', 'cecelia', 'system', "owner''x", 'ai']);
    expect(checks[0].def).toMatch(/[[ ]''::/);
    const rows = await all(`INSERT INTO decisions (topic, decision, category, made_by)
      VALUES ('t552-empty', 'x', 'judgment', ''), ('t552-quote', 'x', 'judgment', 'owner''x') RETURNING made_by`);
    expect(rows.map((r) => r.made_by)).toEqual(['', "owner'x"]);
    const def = checks[0].def;
    await client.query(UP);
    expect(await madeByChecks()).toEqual([{ conname: 'decisions_made_by_check', def }]);
    await client.query('ROLLBACK TO SAVEPOINT special_vals');
  });

  it('取值列表含 NULL 等抽不全的形态时报错，不静默收窄（commander 裁决 2：J-1）', async () => {
    await client.query('SAVEPOINT null_item');
    await dropAllMadeByChecks();
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system', NULL)) NOT VALID");
    await expect(client.query(UP)).rejects.toThrow(/无法解析/);
    await client.query('ROLLBACK TO SAVEPOINT null_item');
  });

  it('存在涉及 made_by 的多列 CHECK 时报错，不静默留一个照样拒 ai 的约束', async () => {
    await client.query('SAVEPOINT multi_col');
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_multi_chk CHECK (made_by <> 'ai' OR category IS NOT NULL)");
    await expect(client.query(UP)).rejects.toThrow(/多列/);
    await client.query('ROLLBACK TO SAVEPOINT multi_col');
  });

  it('made_by 的单列 CHECK 无法解析出取值时报错', async () => {
    await client.query('SAVEPOINT unparsable');
    await client.query("ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_len_chk CHECK (length(made_by) > 0)");
    await expect(client.query(UP)).rejects.toThrow(/无法解析/);
    await client.query('ROLLBACK TO SAVEPOINT unparsable');
  });

  it('ai 能写入；约束外取值仍被拒（23514）', async () => {
    const [row] = await all(`INSERT INTO decisions (topic, decision, category, made_by)
      VALUES ('t552-ai', 'x', 'judgment', 'ai') RETURNING made_by`);
    expect(row.made_by).toBe('ai');
    await client.query('SAVEPOINT bogus');
    await expect(client.query(`INSERT INTO decisions (topic, decision, category, made_by)
      VALUES ('t552-bogus', 'x', 'judgment', 'bogus')`)).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT bogus');
  });

  it('列类型与默认值不变：varchar(20)，默认 system', async () => {
    const [col] = await all(`SELECT data_type, character_maximum_length, column_default
      FROM information_schema.columns WHERE table_name = 'decisions' AND column_name = 'made_by'`);
    expect(col).toEqual({ data_type: 'character varying', character_maximum_length: 20, column_default: "'system'::character varying" });
    const [row] = await all("INSERT INTO decisions (topic, decision, category) VALUES ('t552-default', 'x', 'judgment') RETURNING made_by");
    expect(row.made_by).toBe('system');
  });
});
