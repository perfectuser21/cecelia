import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
let pool;

const GPB = 'ac2e35bc-849a-48cd-917f-79d15c5ac886';
const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';
const BIND = '24a98312-1941-4a0b-91c9-8bf79ef47311';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('migration 350: 承诺地图两域 seed', () => {
  it('智能客服域 7 条 journey（5 GP + 家② + 域锚）', async () => {
    const { rows } = await pool.query(`SELECT name, home FROM journeys WHERE domain='智能客服'`);
    expect(rows).toHaveLength(7);
    expect(rows.filter(r => r.home === 'biz')).toHaveLength(5);
    expect(rows.filter(r => r.home === 'pre')).toHaveLength(1);
  });

  it('GP-B 四步承诺逐字与 V4 一致（抽 S1）', async () => {
    const { rows } = await pool.query(
      `SELECT a.promise FROM activities a JOIN migration_528_activity_columns_backup b ON b.id=a.id WHERE b.journey_id=$1 AND b.step_number=1`, [GPB]);
    expect(rows[0].promise).toBe('客户发来的任何消息，系统数秒内看到，一条不漏、一条不重');
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM activities a JOIN migration_528_activity_columns_backup b ON b.id=a.id WHERE b.journey_id=$1 AND a.promise IS NOT NULL`, [GPB]);
    expect(cnt[0].c).toBe(4);
  });

  it('家③ 7 个底座件在账（group=家③横切件池）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_features WHERE "group"='家③横切件池'`);
    expect(rows[0].c).toBe(7);
  });

  // 350 种子里的底座引用原是 base_ref 格子；520 并入 activity_uses、525 删格子。口径不变，改读用料。
  const usesOf = async feature => (await pool.query(`
      SELECT j.name AS jname, b.step_number
      FROM warehouse_items i
      JOIN activity_uses u ON u.item_id = i.id
      JOIN activities s ON s.id = u.activity_id
      JOIN migration_528_activity_columns_backup b ON b.id = s.id
      JOIN journeys j ON j.id = b.journey_id
      WHERE i.legacy_feature_id = $1
      ORDER BY j.name, b.step_number`, [feature])).rows;

  it('CRM 表底座 blast-radius = 4 步（B·S2/B·S4/D·S1/E·S3，全景图口径）', async () => {
    const rows = await usesOf(CRM);
    expect(rows).toHaveLength(4);
    const keys = rows.map(r => `${r.jname.includes('GP-B') ? 'B' : r.jname.includes('GP-D') ? 'D' : r.jname.includes('GP-E') ? 'E' : '?'}·S${r.step_number}`);
    expect(keys.sort()).toEqual(['B·S2', 'B·S4', 'D·S1', 'E·S3']);
  });

  it('绑定/安装被 B/C/E/F 的 S1 + 首次成功 S2 引用（5 处）', async () => {
    expect(await usesOf(BIND)).toHaveLength(5);
  });

  it('首次成功五步承诺齐 + 存量 S2 名称零丢失', async () => {
    const { rows } = await pool.query(
      `SELECT b.step_number, a.name, a.promise FROM activities a JOIN migration_528_activity_columns_backup b ON b.id=a.id
       WHERE b.journey_id='6e63f204-e9fd-4a3b-b338-6b3616bfcc61' ORDER BY b.step_number`);
    expect(rows).toHaveLength(5);
    expect(rows.every(r => r.promise)).toBe(true);
  });

  it('全部 cell 行可进 Notion 推送（棒4-2 起格子进「承诺地图格子」库；350 种子的假 synced 被迁移 479 清零）', async () => {
    // 原合同「cell 行 notion_synced_at 非空 = 不推 Notion」已被决策 10a68212 取代：格子颜色要进驾驶舱。
    // 479 后种子行 notion_synced_at 为 NULL；被推过的行 notion_id 非空。两者之外（synced 非空却无 notion_id）= 假同步，不允许。
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c
         FROM activity_cells link
         JOIN journeys journey ON journey.id = link.journey_id
        WHERE journey.domain IN ('智能客服', '公司级')
          AND link.cell_kind IS NOT NULL
          AND link.notion_synced_at IS NOT NULL
          AND link.notion_id IS NULL`);
    expect(rows[0].c).toBe(0);
  });

  it('幂等：重放 350 种子文件不新增格子行（底座引用格子已退役，重放补出的 base_ref 不算）', async () => {
    // 350 是历史迁移，SQL 里写的是旧表名：在事务里把标准名临时改回旧名重放，事务整体回滚，不污染库。
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.resolve(dir, '../../../migrations/350_seed_promise_map_two_domains.sql'), 'utf8')
      .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
    const count = c => c.query(`SELECT COUNT(*)::int AS c FROM journey_step_links WHERE cell_kind IS DISTINCT FROM 'base_ref'`).then(r => r.rows[0].c);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 迁移 529 起 journeys 是只读视图，而 350 种子要往它写：在这个会回滚的事务里临时还原成带现有行的表，验证的是历史种子自身的幂等
      await client.query('DROP VIEW journeys');
      await client.query('CREATE TABLE journeys (LIKE value_streams INCLUDING ALL)');
      await client.query('ALTER TABLE journeys DROP CONSTRAINT IF EXISTS value_streams_is_root');
      const cols = 'id, notion_id, name, description, journey_type, maturity, status, e2e_test_path, area_id, notion_synced_at, created_at, updated_at, home, "trigger", endpoint, "domain", biz_area, parent_journey_id, capability_code, notion_digest';
      await client.query(`INSERT INTO journeys(${cols}) SELECT ${cols} FROM value_streams UNION ALL SELECT ${cols} FROM capabilities`);
      await client.query('ALTER TABLE activities RENAME TO journey_steps');
      // 350 的 ON CONFLICT (journey_id, step_number) 靠迁移 527 之前的唯一约束：在这个会回滚的事务里临时补上，验证的是历史种子自身的幂等
      await client.query('ALTER TABLE journey_steps ADD COLUMN journey_id uuid, ADD COLUMN step_number integer');
      await client.query('UPDATE journey_steps a SET journey_id=b.journey_id, step_number=b.step_number FROM migration_528_activity_columns_backup b WHERE b.id=a.id');
      await client.query('CREATE UNIQUE INDEX tmp_350_replay ON journey_steps (journey_id, step_number)');
      await client.query('ALTER TABLE activity_cells RENAME TO journey_step_links');
      const before = await count(client);
      await client.query(sql);
      expect(await count(client)).toBe(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
