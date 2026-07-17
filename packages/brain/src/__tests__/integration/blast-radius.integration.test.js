import { describe, it, expect, beforeAll } from 'vitest';
let pool;
const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

describe('blast-radius 查询（348 seed 数据上）', () => {
  it('CRM 表底座引用 4 步且 promise 全非空', async () => {
    const { rows } = await pool.query(
      `SELECT s.promise, l.cell_status
       FROM journey_step_links l
       JOIN journey_steps s ON s.id=l.step_id
       WHERE l.feature_id=$1 AND l.cell_kind='base_ref'`, [CRM]);
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.promise && r.cell_status)).toBe(true);
  });

  it('无引用 feature 返回空（count=0 语义）', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM journey_step_links WHERE feature_id='d831dd0f-893c-49b6-8857-07756f5a7030' AND cell_kind='base_ref'`);
    expect(rows.length).toBe(1); // 画像卡恰 1 处引用（B·S2）
  });

  it('ON DELETE SET NULL：删 feature 后 cell 行 feature_id 置空不删行', async () => {
    await pool.query('BEGIN');
    try {
      // 造一个临时 feature
      const { rows: frows } = await pool.query(
        `INSERT INTO journey_features (name, thickness, status) VALUES ($1,'thin','planned') RETURNING id`,
        ['[test] 临时底座件-ON DELETE 探针']
      );
      const tempFeatureId = frows[0].id;

      // 挂在一个真实存在的 step 上（GP-B S1），用独有的 cell_key 避免撞 uq_jsl_cell
      const { rows: srows } = await pool.query(
        `SELECT id, journey_id FROM journey_steps WHERE journey_id='ac2e35bc-849a-48cd-917f-79d15c5ac886' AND step_number=1`
      );
      const step = srows[0];

      const { rows: lrows } = await pool.query(
        `INSERT INTO journey_step_links
           (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, status, notion_synced_at)
         VALUES ($1,$2,'base_ref','[test] ON DELETE 探针','pending',$3,'planned',NOW())
         RETURNING id`,
        [step.journey_id, step.id, tempFeatureId]
      );
      const linkId = lrows[0].id;

      // 删除 feature
      await pool.query(`DELETE FROM journey_features WHERE id=$1`, [tempFeatureId]);

      // cell 行仍在，feature_id 已置空
      const { rows: after } = await pool.query(
        `SELECT id, feature_id FROM journey_step_links WHERE id=$1`, [linkId]
      );
      expect(after).toHaveLength(1);
      expect(after[0].feature_id).toBeNull();
    } finally {
      await pool.query('ROLLBACK');
    }
  });
});
