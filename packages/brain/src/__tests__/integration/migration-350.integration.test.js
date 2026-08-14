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
      `SELECT promise FROM journey_steps WHERE journey_id=$1 AND step_number=1`, [GPB]);
    expect(rows[0].promise).toBe('客户发来的任何消息，系统数秒内看到，一条不漏、一条不重');
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_steps WHERE journey_id=$1 AND promise IS NOT NULL`, [GPB]);
    expect(cnt[0].c).toBe(4);
  });

  it('家③ 7 个底座件在账（group=家③横切件池）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_features WHERE "group"='家③横切件池'`);
    expect(rows[0].c).toBe(7);
  });

  it('CRM 表底座 blast-radius = 4 步（B·S2/B·S4/D·S1/E·S3，全景图口径）', async () => {
    const { rows } = await pool.query(`
      SELECT j.name AS jname, s.step_number
      FROM journey_step_links l
      JOIN journey_steps s ON s.id = l.step_id
      JOIN journeys j ON j.id = s.journey_id
      WHERE l.feature_id = $1 AND l.cell_kind = 'base_ref'
      ORDER BY j.name, s.step_number`, [CRM]);
    expect(rows).toHaveLength(4);
    const keys = rows.map(r => `${r.jname.includes('GP-B') ? 'B' : r.jname.includes('GP-D') ? 'D' : r.jname.includes('GP-E') ? 'E' : '?'}·S${r.step_number}`);
    expect(keys.sort()).toEqual(['B·S2', 'B·S4', 'D·S1', 'E·S3']);
  });

  it('绑定/安装被 B/C/E/F 的 S1 + 首次成功 S2 引用（5 处）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM journey_step_links WHERE feature_id=$1 AND cell_kind='base_ref'`, [BIND]);
    expect(rows[0].c).toBe(5);
  });

  it('首次成功五步承诺齐 + 存量 S2 名称零丢失', async () => {
    const { rows } = await pool.query(
      `SELECT step_number, name, promise FROM journey_steps
       WHERE journey_id='6e63f204-e9fd-4a3b-b338-6b3616bfcc61' ORDER BY step_number`);
    expect(rows).toHaveLength(5);
    expect(rows.every(r => r.promise)).toBe(true);
  });

  it('全部 cell 行 notion_synced_at 非空（不推 Notion）', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c
         FROM journey_step_links link
         JOIN journeys journey ON journey.id = link.journey_id
        WHERE journey.domain IN ('智能客服', '公司级')
          AND link.cell_kind IS NOT NULL
          AND link.notion_synced_at IS NULL`);
    expect(rows[0].c).toBe(0);
  });

  it('幂等：重放 348 文件内容不新增行', async () => {
    const before = (await pool.query(`SELECT COUNT(*)::int AS c FROM journey_step_links`)).rows[0].c;
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.resolve(dir, '../../../migrations/350_seed_promise_map_two_domains.sql'), 'utf8');
    await pool.query(sql);
    const after = (await pool.query(`SELECT COUNT(*)::int AS c FROM journey_step_links`)).rows[0].c;
    expect(after).toBe(before);
  });
});
