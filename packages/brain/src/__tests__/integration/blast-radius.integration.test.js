import { describe, it, expect, beforeAll } from 'vitest';
let pool;
const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

// 底座引用格子已并入 activity_uses（迁移 520 合并、525 删格子）：塌红范围 = 用到这件仓库物件的 Activity
const RADIUS_SQL = `SELECT s.promise, COALESCE(u.cell_status, 'gray') AS cell_status
       FROM warehouse_items i
       JOIN activity_uses u ON u.item_id = i.id
       JOIN activities s ON s.id = u.activity_id
       WHERE i.legacy_feature_id = $1`;

describe('blast-radius 查询（348 seed 数据经 520 并入用料后）', () => {
  it('CRM 表底座引用 4 步且 promise 全非空', async () => {
    const { rows } = await pool.query(RADIUS_SQL, [CRM]);
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.promise && r.cell_status)).toBe(true);
  });

  it('画像卡恰 1 处引用（B·S2）；没有用料的 feature 返回空', async () => {
    const { rows } = await pool.query(RADIUS_SQL, ['d831dd0f-893c-49b6-8857-07756f5a7030']);
    expect(rows.length).toBe(1);
    expect((await pool.query(RADIUS_SQL, ['00000000-0000-4000-8000-000000000000'])).rows).toEqual([]);
  });

  it('底座引用格子已删光（525）：库里不再有 base_ref 行', async () => {
    expect((await pool.query(`SELECT count(*)::int AS n FROM activity_cells WHERE cell_kind = 'base_ref'`)).rows[0].n).toBe(0);
  });

  it('ON DELETE SET NULL：删 feature 后 cell 行 feature_id 置空不删行', async () => {
    // 事务必须独占一条物理连接：pool.query 每次可能换连接，BEGIN/ROLLBACK 会散架
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 造一个临时 feature
      const { rows: frows } = await client.query(
        `INSERT INTO journey_features (name, thickness, status) VALUES ($1,'thin','planned') RETURNING id`,
        ['[test] 临时底座件-ON DELETE 探针']
      );
      const tempFeatureId = frows[0].id;

      // 挂在一个真实存在的 step 上（GP-B S1），用独有的 cell_key 避免撞 uq_jsl_cell
      const { rows: srows } = await client.query(
        `SELECT s.id, 'ac2e35bc-849a-48cd-917f-79d15c5ac886'::uuid AS journey_id FROM activities s
           WHERE s.id=(SELECT target_id FROM decisions WHERE source_ref='gp-ledger-phase3:nfr:gp-b:s1')`
      );
      const step = srows[0];

      const { rows: lrows } = await client.query(
        `INSERT INTO activity_cells
           (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, status, notion_synced_at)
         VALUES ($1,$2,'capability','[test] ON DELETE 探针','pending',$3,'planned',NOW())
         RETURNING id`,
        [step.journey_id, step.id, tempFeatureId]
      );
      const linkId = lrows[0].id;

      // 删除 feature
      await client.query(`DELETE FROM journey_features WHERE id=$1`, [tempFeatureId]);

      // cell 行仍在，feature_id 已置空
      const { rows: after } = await client.query(
        `SELECT id, feature_id FROM activity_cells WHERE id=$1`, [linkId]
      );
      expect(after).toHaveLength(1);
      expect(after[0].feature_id).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
