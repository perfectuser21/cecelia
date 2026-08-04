/**
 * F6步骤3「去向链接」能力断言
 *
 * 验证 migration 385 的 destination_type / destination_id 字段
 * 以及 capture_aging_sentinel 视图的正确性。
 *
 * F6 journey_id: 824ee0f5-aeb9-4972-909d-37dd17b75617
 * F6 step3 id  : 42fcffb2-547e-4a71-ba8c-c66969f76df9
 * 能力格子「去向链接」: assertion_ref → packages/brain/src/__tests__/capture-destination-link.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../../db.js';

let captureId;

beforeAll(async () => {
  // 创建测试用 capture，不带去向
  const { rows } = await pool.query(
    `INSERT INTO captures (content, source, status)
     VALUES ('test-destination-link capture content', 'dashboard', 'captured')
     RETURNING id`,
  );
  captureId = rows[0].id;
});

afterAll(async () => {
  if (captureId) {
    await pool.query('DELETE FROM captures WHERE id = $1', [captureId]);
  }
});

describe('F6步骤3 去向链接能力', () => {
  it('captures 表应有 destination_type 和 destination_id 字段（migration 385）', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = 'captures'
         AND column_name IN ('destination_type', 'destination_id')
       ORDER BY column_name`,
    );
    const cols = rows.map(r => r.column_name);
    expect(cols).toContain('destination_type');
    expect(cols).toContain('destination_id');
  });

  it('新建 capture 的 destination_type 默认为 NULL（未归位）', async () => {
    const { rows } = await pool.query(
      'SELECT destination_type, destination_id FROM captures WHERE id = $1',
      [captureId],
    );
    expect(rows[0].destination_type).toBeNull();
    expect(rows[0].destination_id).toBeNull();
  });

  it('PATCH destination_type=initiative 后可正确查到去向', async () => {
    // 使用一个合法但不存在的 UUID（测试字段写入，不验证 FK）
    const fakeInitiativeId = '00000000-0000-0000-0000-000000000001';
    await pool.query(
      `UPDATE captures SET destination_type='initiative', destination_id=$1 WHERE id=$2`,
      [fakeInitiativeId, captureId],
    );
    const { rows } = await pool.query(
      'SELECT destination_type, destination_id FROM captures WHERE id = $1',
      [captureId],
    );
    expect(rows[0].destination_type).toBe('initiative');
    expect(rows[0].destination_id).toBe(fakeInitiativeId);
  });

  it('destination_type CHECK 约束拒绝非法值', async () => {
    await expect(
      pool.query(
        `UPDATE captures SET destination_type='invalid_type' WHERE id=$1`,
        [captureId],
      ),
    ).rejects.toThrow();
  });

  it('capture_aging_sentinel 视图存在且可查', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.views
       WHERE table_name = 'capture_aging_sentinel'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('capture_aging_sentinel 只返回超过 7 天且未归位的 captures', async () => {
    // 插入一个超期 capture
    const { rows: [stale] } = await pool.query(
      `INSERT INTO captures (content, source, status, created_at)
       VALUES ('stale capture', 'dashboard', 'captured', now() - interval '10 days')
       RETURNING id`,
    );
    try {
      const { rows } = await pool.query(
        `SELECT * FROM capture_aging_sentinel WHERE id = $1`,
        [stale.id],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].age_days).toBeGreaterThanOrEqual(7);
      expect(rows[0].severity).toMatch(/^(watch|warning|critical)$/);
    } finally {
      await pool.query('DELETE FROM captures WHERE id = $1', [stale.id]);
    }
  });

  it('已归位（destination_type 不为 NULL）的 capture 不出现在哨兵视图中', async () => {
    // 归位测试 capture
    await pool.query(
      `UPDATE captures SET destination_type='initiative', destination_id='00000000-0000-0000-0000-000000000001',
         created_at=now()-interval '10 days'
       WHERE id=$1`,
      [captureId],
    );
    const { rows } = await pool.query(
      'SELECT id FROM capture_aging_sentinel WHERE id = $1',
      [captureId],
    );
    expect(rows.length).toBe(0);
  });
});
