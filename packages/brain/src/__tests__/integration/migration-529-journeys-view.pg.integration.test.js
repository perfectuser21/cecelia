/**
 * 迁移 529 的行为：在已迁移到最新的 CI 测试库里核对 journeys 是只读视图、子表不再继承、守卫仍按两张子表判存在。
 * 全部在事务里做完回滚，不留数据。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
});
afterAll(async () => { await client?.end(); });

const one = async (sql, params) => (await client.query(sql, params)).rows[0];

describe('迁移 529：journeys 父表改只读视图', () => {
  it('journeys 是视图，价值流与能力是两张互不继承的真表', async () => {
    expect((await one("SELECT relkind FROM pg_class WHERE relname='journeys' AND relnamespace='public'::regnamespace")).relkind).toBe('v');
    expect((await one("SELECT count(*)::int AS n FROM pg_inherits WHERE inhrelid IN ('value_streams'::regclass,'capabilities'::regclass)")).n).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_journeys_route_insert'")).n).toBe(0);
  });

  it('视图行数 = 两张子表行数之和，列与子表一致', async () => {
    const r = await one("SELECT (SELECT count(*) FROM journeys)::int AS v, (SELECT count(*) FROM value_streams)::int + (SELECT count(*) FROM capabilities)::int AS s");
    expect(r.v).toBe(r.s);
    const cols = async t => (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [t])).rows.map(x => x.column_name);
    expect(await cols('journeys')).toEqual(await cols('value_streams'));
  });

  it('视图只读：INSERT / UPDATE / DELETE 都被拒', async () => {
    for (const sql of ["INSERT INTO journeys(name,journey_type) VALUES('x','autonomous')", "UPDATE journeys SET name='x'", "DELETE FROM journeys"]) {
      await client.query('BEGIN');
      await expect(client.query(sql)).rejects.toMatchObject({ code: '55000' });
      await client.query('ROLLBACK');
    }
  });

  it('journey_id 守卫：价值流 id、能力 id 都放行，不存在的 id 拒绝（外键违例）', async () => {
    await client.query('BEGIN');
    try {
      const vs = (await one("INSERT INTO value_streams(name,journey_type) VALUES('migration-529-vs','autonomous') RETURNING id")).id;
      const cap = (await one("INSERT INTO capabilities(name,journey_type,parent_journey_id) VALUES('migration-529-cap','autonomous',$1) RETURNING id", [vs])).id;
      await client.query("INSERT INTO issues(title,journey_id) VALUES('m529 vs',$1)", [vs]);
      await client.query("INSERT INTO issues(title,journey_id) VALUES('m529 cap',$1)", [cap]);
      await client.query('SAVEPOINT ghost');
      await expect(client.query("INSERT INTO issues(title,journey_id) VALUES('m529 ghost','00000000-0000-4000-8000-0000000000aa')")).rejects.toMatchObject({ code: '23503' });
    } finally { await client.query('ROLLBACK'); }
  });

  it('身份锁仍在：价值流不能被改成能力', async () => {
    await client.query('BEGIN');
    try {
      const vs = (await one("INSERT INTO value_streams(name,journey_type) VALUES('migration-529-lock','autonomous') RETURNING id")).id;
      const other = (await one("INSERT INTO value_streams(name,journey_type) VALUES('migration-529-lock2','autonomous') RETURNING id")).id;
      await expect(client.query('UPDATE value_streams SET parent_journey_id=$1 WHERE id=$2', [other, vs])).rejects.toMatchObject({ code: '23514' });
    } finally { await client.query('ROLLBACK'); }
  });

  it('activity_flow_metrics 不再依赖 journeys，仍可查询', async () => {
    expect((await one("SELECT count(*)::int AS n FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class c ON c.oid=r.ev_class WHERE d.refobjid='journeys'::regclass AND c.relname='activity_flow_metrics'")).n).toBe(0);
    await expect(client.query('SELECT * FROM activity_flow_metrics LIMIT 1')).resolves.toBeTruthy();
  });
});
