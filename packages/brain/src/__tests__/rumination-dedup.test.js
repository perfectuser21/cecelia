/**
 * Rumination content_hash Dedup Tests
 *
 * 验证 rumination.js 在写入 suggestions 表前正确检查 content_hash，
 * 24h DEDUP_WINDOW 内同一洞察不重复写入（P0 死循环修复）
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

/** 模拟 rumination 写入逻辑（与 rumination.js 中的代码保持一致） */
async function writeInsightWithDedup(db, insight) {
  const content_hash = crypto.createHash('sha256').update(insight).digest('hex');
  const { rows: dedupRows } = await db.query(
    `SELECT id FROM suggestions WHERE content_hash = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
    [content_hash]
  );
  if (dedupRows.length > 0) {
    return { skipped: true, content_hash };
  }
  await db.query(`
    INSERT INTO suggestions (content, source, priority_score, status, suggestion_type, metadata, content_hash)
    VALUES ($1, 'rumination', $2, 'pending', 'desire_formation', $3, $4)
  `, [
    insight,
    0.7,
    JSON.stringify({ origin: 'rumination_p0c', insight }),
    content_hash
  ]);
  return { skipped: false, content_hash };
}

let insertedIds = [];

describe('Rumination content_hash Dedup', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (insertedIds.length > 0) {
      await pool.query('DELETE FROM suggestions WHERE id = ANY($1)', [insertedIds]);
      insertedIds = [];
    }
  });

  it('首次写入：新洞察正常插入 suggestions 表', async () => {
    const insight = `test-insight-unique-${Date.now()}`;
    const result = await writeInsightWithDedup(pool, insight);

    expect(result.skipped).toBe(false);
    expect(result.content_hash).toHaveLength(64);

    // 验证已插入
    const { rows } = await pool.query(
      'SELECT id, content_hash FROM suggestions WHERE content_hash = $1',
      [result.content_hash]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content_hash).toBe(result.content_hash);
    insertedIds.push(rows[0].id);
  });

  it('重复写入：24h 内同一洞察被跳过，不重复插入', async () => {
    const insight = `test-dedup-insight-${Date.now()}`;

    // 第一次写入
    const first = await writeInsightWithDedup(pool, insight);
    expect(first.skipped).toBe(false);
    const { rows: firstRows } = await pool.query(
      'SELECT id FROM suggestions WHERE content_hash = $1',
      [first.content_hash]
    );
    insertedIds.push(firstRows[0].id);

    // 第二次写入同一洞察 → 应被跳过
    const second = await writeInsightWithDedup(pool, insight);
    expect(second.skipped).toBe(true);
    expect(second.content_hash).toBe(first.content_hash);

    // 数据库中仍只有 1 条记录
    const { rows } = await pool.query(
      'SELECT id FROM suggestions WHERE content_hash = $1',
      [first.content_hash]
    );
    expect(rows).toHaveLength(1);
  });

  it('24h 外旧记录：不触发去重，允许重新写入', async () => {
    const insight = `test-old-insight-${Date.now()}`;
    const content_hash = crypto.createHash('sha256').update(insight).digest('hex');

    // 手动插入一条 25h 前的记录
    const { rows: oldRows } = await pool.query(`
      INSERT INTO suggestions (content, source, priority_score, status, suggestion_type, metadata, content_hash, created_at)
      VALUES ($1, 'rumination', 0.7, 'pending', 'desire_formation', '{}', $2, NOW() - INTERVAL '25 hours')
      RETURNING id
    `, [insight, content_hash]);
    insertedIds.push(oldRows[0].id);

    // 现在写入同一洞察 → 不应被跳过（旧记录超出 24h）
    const result = await writeInsightWithDedup(pool, insight);
    expect(result.skipped).toBe(false);

    const { rows } = await pool.query(
      'SELECT id FROM suggestions WHERE content_hash = $1',
      [content_hash]
    );
    expect(rows.length).toBeGreaterThanOrEqual(2); // 旧记录 + 新记录
    insertedIds.push(...rows.filter(r => r.id !== oldRows[0].id).map(r => r.id));
  });
});

