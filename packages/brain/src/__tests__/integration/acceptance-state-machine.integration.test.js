import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import pool from '../../db.js';
import { submitAcceptanceResults } from '../../routes/acceptance.js';

const RUN_KEY = `sm-itest-${process.pid}`;
const MIGRATION_AT = '2026-08-07T00:00:00Z';

async function seedRun(total) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id) VALUES ($1, '状态机回归', '7790f728') RETURNING id`,
    [RUN_KEY]
  );
  const runId = rows[0].id;
  for (let i = 1; i <= total; i++) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1, $2, 'FR', $3)`,
      [runId, `S${i}-c1`, `格 ${i}`]
    );
  }
  return runId;
}

describe('A10⑤ 人列填满即 human_complete（本刀最重要的回归测试，永不删除）', () => {
  beforeEach(async () => { await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]); });
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('⑤-a 人列填满且含「不通过」→ human_complete，不是 failed', async () => {
    await seedRun(3);
    await submitAcceptanceResults(pool, [
      { check_key: 'S1-c1', result: '通过' },
      { check_key: 'S2-c1', result: '不通过', note: '挂了' },
      { check_key: 'S3-c1', result: '通过' },
    ], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });

  it('⑤-b 人列全「通过」→ 同样是 human_complete，不是 passed', async () => {
    await seedRun(2);
    await submitAcceptanceResults(pool, [
      { check_key: 'S1-c1', result: '通过' },
      { check_key: 'S2-c1', result: '通过' },
    ], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });

  it('人列部分填写 → in_review', async () => {
    await seedRun(3);
    await submitAcceptanceResults(pool, [{ check_key: 'S1-c1', result: '通过' }], { run_key: RUN_KEY });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('in_review');
  });

  it('⑤-c migration 之后新建的 run 全表不存在 passed/failed', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_runs
       WHERE status IN ('passed','failed') AND created_at > $1`, [MIGRATION_AT]
    );
    expect(rows[0].n).toBe(0);
  });
});
