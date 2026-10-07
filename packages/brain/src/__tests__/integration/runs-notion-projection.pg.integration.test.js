/** runs 投影窗口查询与归档清列：真 Postgres（仅 scratch/CI 测试库），事务里跑，结束回滚。假 notionReq，绝不碰真 Notion。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { IN_WINDOW_SQL, selectRowsToPush, selectRowsToArchive, archiveRows, runRunsNotionPush } from '../../runs-notion-projection.js';

let pool, client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

const TAG = `rnp${process.pid}x${Date.now()}`;
const ins = async (key, prefix, daysAgo, outcome) => {
  const { rows } = await client.query(
    `INSERT INTO runs(run_id, trigger_kind, trigger_ref, started_at, ended_at, outcome, header_source)
     VALUES($1, 'schedule', $2, now() - make_interval(days => $3), now() - make_interval(days => $3) + interval '2 seconds', $4, 'owner')
     RETURNING id, run_id`,
    [`${prefix}${TAG}-${key}`, `job-${key}`, daysAgo, outcome]);
  return rows[0];
};
const seed = async () => ({
  oc2pass: await ins('oc2pass', 'openclaw:', 2, 'pass'),
  oc10pass: await ins('oc10pass', 'openclaw:', 10, 'pass'),
  oc10fail: await ins('oc10fail', 'openclaw:', 10, 'fail'),
  br1pass: await ins('br1pass', 'brain:', 1, 'pass'),
  br1fail: await ins('br1fail', 'brain:', 1, 'fail'),
  br40fail: await ins('br40fail', 'brain:', 40, 'fail'),
});
const mine = (rows) => rows.filter((r) => r.run_id.includes(TAG)).map((r) => r.run_id.split('-').pop());

describe('runs 投影窗口', () => {
  it('selectRowsToPush 恰好返回 OpenClaw 2天pass、OpenClaw 10天fail、Brain 1天fail', async () => {
    await seed();
    const rows = await selectRowsToPush(client, 100000);
    expect(mine(rows).sort()).toEqual(['oc10fail', 'oc2pass', 'br1fail'].sort());
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(
      ['id', 'run_id', 'trigger_kind', 'trigger_ref', 'executor_id', 'started_at', 'duration_ms', 'outcome', 'error', 'detail', 'notion_id', 'notion_digest']));
  });

  it('已同步且未更新的行不再入选；updated_at 晚于 notion_synced_at 的行重新入选', async () => {
    const s = await seed();
    await client.query("UPDATE runs SET notion_id='p1', notion_digest='d', notion_synced_at = now() + interval '1 minute' WHERE id=$1", [s.oc2pass.id]);
    expect(mine(await selectRowsToPush(client, 100000))).not.toContain('oc2pass');
    await client.query("UPDATE runs SET notion_synced_at = now() - interval '1 hour', updated_at = now() WHERE id=$1", [s.oc2pass.id]);
    expect(mine(await selectRowsToPush(client, 100000))).toContain('oc2pass');
  });

  it('selectRowsToArchive 只返回有 notion_id 且移出窗口的行', async () => {
    const s = await seed();
    await client.query("UPDATE runs SET notion_id='pg-old' WHERE id=$1", [s.oc10pass.id]);
    await client.query("UPDATE runs SET notion_id='pg-in' WHERE id=$1", [s.oc2pass.id]);
    const rows = await selectRowsToArchive(client, 100000);
    expect(mine(rows)).toEqual(['oc10pass']);
    expect(rows.find((r) => r.run_id.includes(TAG)).notion_id).toBe('pg-old');
  });

  it('archiveRows：PATCH archived=true 后清三列；404 视为已归档照样清；其他错误停止本轮', async () => {
    const s = await seed();
    const ids = [s.oc10pass.id, s.br40fail.id, s.oc10fail.id];
    await client.query("UPDATE runs SET notion_id='pg-a', notion_digest='d', notion_synced_at=now() WHERE id=$1", [ids[0]]);
    await client.query("UPDATE runs SET notion_id='pg-b', notion_digest='d', notion_synced_at=now() WHERE id=$1", [ids[1]]);
    await client.query("UPDATE runs SET notion_id='pg-c', notion_digest='d', notion_synced_at=now() WHERE id=$1", [ids[2]]);
    const calls = [];
    const notionReq = async (token, path, method, body) => {
      calls.push([path, method, body]);
      if (path === '/pages/pg-b') { throw new Error('Notion PATCH /pages/pg-b → 404: gone'); }
      if (path === '/pages/pg-c') { throw new Error('Notion PATCH /pages/pg-c → 500: boom'); }
      return {};
    };
    const rows = (await client.query('SELECT id, notion_id FROM runs WHERE id = ANY($1) ORDER BY notion_id', [ids])).rows;
    const r = await archiveRows(client, 'tok', rows, notionReq);
    expect(r).toEqual({ archived: 2, stopped: true });
    expect(calls[0]).toEqual(['/pages/pg-a', 'PATCH', { archived: true }]);
    const after = (await client.query('SELECT id, notion_id, notion_digest, notion_synced_at FROM runs WHERE id = ANY($1)', [ids])).rows;
    const by = (id) => after.find((x) => x.id === id);
    expect(by(ids[0])).toMatchObject({ notion_id: null, notion_digest: null, notion_synced_at: null });
    expect(by(ids[1])).toMatchObject({ notion_id: null, notion_digest: null, notion_synced_at: null });
    expect(by(ids[2]).notion_id).toBe('pg-c');
  });

  it('runRunsNotionPush 端到端：库已登记 → 推新行并回写 notion_id，窗口外旧页被归档清列', async () => {
    const s = await seed();
    await client.query("UPDATE runs SET notion_id='pg-old', notion_digest='d', notion_synced_at=now() WHERE id=$1", [s.oc10pass.id]);
    // scratch 库里可能有别的 runs 行：把它们标成「已同步」，让推送集合只剩本测试插入的行
    await client.query(
      `UPDATE runs SET notion_id = COALESCE(notion_id, 'other'), notion_synced_at = now() + interval '1 hour'
        WHERE run_id NOT LIKE $1 AND (${IN_WINDOW_SQL})`, [`%${TAG}%`]);
    await client.query("UPDATE notion_projection_map SET notion_db_id='db-test', direction='push', status='active' WHERE brain_table='runs'");
    const calls = [];
    let n = 0;
    const notionReq = async (token, path, method, body) => {
      calls.push({ path, method, body });
      return method === 'POST' ? { id: `page-${++n}` } : {};
    };
    const r = await runRunsNotionPush(client, { notionReq, getToken: () => 'tok' });
    expect(r.pushed.created).toBe(3);
    expect(r.archived).toBeGreaterThanOrEqual(1);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(posts.every((c) => c.body.parent.database_id === 'db-test')).toBe(true);
    expect(calls.some((c) => c.path === '/pages/pg-old' && c.body.archived === true)).toBe(true);
    expect((await client.query('SELECT notion_id FROM runs WHERE id=$1', [s.oc2pass.id])).rows[0].notion_id).toMatch(/^page-/);
    expect((await client.query('SELECT notion_id FROM runs WHERE id=$1', [s.oc10pass.id])).rows[0].notion_id).toBeNull();
  });
});
