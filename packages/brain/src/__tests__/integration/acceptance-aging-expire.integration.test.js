/**
 * A10② 48h 过期扫描器集成测试（D1 Task 9）
 *
 * 被测的是 acceptance-aging.js 这个既有 48h 哨兵加厚后的行为：
 * pending 超 48h → status='expired'，in_review 超 48h 只告警不转态。
 *
 * 本文件真连 Postgres（DB_NAME=cecelia_scratch），不 mock db.js。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { runAcceptanceAging, _resetGateForTest, ORPHAN_SCAN_LEGACY_STATUSES } from '../../acceptance-aging.js';

const RUN_KEY = `aging-itest-${process.pid}`;

// 过期扫描按设计是全库 UPDATE，会把 scratch 库里既有的超期 pending fixture 一并刷成
// expired。快照-还原让本文件对共享 scratch 库无净副作用（同库还有别的实现者在跑）。
let collateral = [];

async function snapshotCollateral() {
  const { rows } = await pool.query(
    `SELECT run_key FROM acceptance_runs
      WHERE status = 'pending'
        AND created_at < now() - interval '48 hours'
        AND run_key <> $1`,
    [RUN_KEY]
  );
  collateral = rows.map((r) => r.run_key);
}

async function seed(status, ageHours) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status, created_at)
     VALUES ($1, '过期扫描', $2, now() - ($3 || ' hours')::interval)`,
    [RUN_KEY, status, String(ageHours)]
  );
}

const statusOf = async () => (await pool.query(
  'SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY])).rows[0].status;

describe('A10② pending 48h → expired', () => {
  beforeEach(async () => {
    _resetGateForTest();
    await snapshotCollateral();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    if (collateral.length > 0) {
      await pool.query(
        `UPDATE acceptance_runs SET status = 'pending' WHERE run_key = ANY($1)`,
        [collateral]
      );
    }
    await pool.end();
  });

  it('created_at 回拨 49h 的 pending run 被扫成 expired', async () => {
    await seed('pending', 49);
    const r = await runAcceptanceAging(pool);
    expect(r.skipped).toBe(false);
    expect(r.expired_runs).toBeGreaterThanOrEqual(1);
    expect(await statusOf()).toBe('expired');
  });

  it('未满 48h 的 pending run 不动', async () => {
    await seed('pending', 10);
    await runAcceptanceAging(pool);
    expect(await statusOf()).toBe('pending');
  });

  it('in_review 超 48h 只告警不转 expired（有人正在填，转态会丢工作）', async () => {
    await seed('in_review', 60);
    const r = await runAcceptanceAging(pool);
    expect(r.overdue_runs).toBeGreaterThanOrEqual(1);
    expect(await statusOf()).toBe('in_review');
  });

  it('human_complete / adjudicated / stale / abandoned 一律不被扫', async () => {
    for (const st of ['human_complete', 'adjudicated', 'stale', 'abandoned']) {
      await seed(st, 100);
      _resetGateForTest();
      await runAcceptanceAging(pool);
      expect(await statusOf()).toBe(st);
    }
  });

  it('orphan 扫描被显式标注为只覆盖历史 failed run（不是活的防线）', () => {
    // 谓词一旦被人默默改回「活防线」的写法，这条断言会红并逼他去看 D4 的分流口径
    expect(ORPHAN_SCAN_LEGACY_STATUSES).toEqual(['failed']);
  });
});
