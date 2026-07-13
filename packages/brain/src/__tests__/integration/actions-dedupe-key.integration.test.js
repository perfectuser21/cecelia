import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let pool, createTask;

const TITLE = 'test-dedupe-key-task';

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ createTask } = await import('../../actions.js'));
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key LIKE 'test-dk-%'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key LIKE 'test-dk-%'`);
});

describe('createTask dedupe_key 幂等', () => {
  it('带 dedupe_key 二次调用 → 第二次 deduplicated:true 且不建新任务', async () => {
    const params = {
      // trigger_source 'test' 属于 isSystemTask 的 systemSources，跳过 goal_id 必填校验
      title: `${TITLE}-1`, task_type: 'talk', trigger_source: 'test',
      dedupe_key: 'test-dk-1', dedupe_ttl_sec: 300,
    };
    const r1 = await createTask(params);
    expect(r1.success).toBe(true);
    expect(r1.deduplicated).toBeFalsy();

    // 换 title 避开现有 title 24h 去重，单测 dedupe_key 这一层
    const r2 = await createTask({ ...params, title: `${TITLE}-2` });
    expect(r2.success).toBe(true);
    expect(r2.deduplicated).toBe(true);
    expect(r2.dedupe_key_hit).toBe(true);

    const count = await pool.query(`SELECT COUNT(*) AS c FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
    expect(parseInt(count.rows[0].c, 10)).toBe(1);
  });

  it('不传 dedupe_key 行为完全不变（老路径回归）', async () => {
    const r = await createTask({ title: `${TITLE}-legacy`, task_type: 'talk', trigger_source: 'test' });
    expect(r.success).toBe(true);
  });

  it('INSERT 抛错时释放 key（TTL 内重试不被误挡）', async () => {
    // goal_id 校验失败发生在 claim 之前 → key 不该被占
    // trigger_source 'auto' + task_type 'dev' 均非 isSystemTask 白名单，触发 goal_id 必填校验
    await expect(createTask({
      title: `${TITLE}-fail`, task_type: 'dev', trigger_source: 'auto',
      dedupe_key: 'test-dk-fail', dedupe_ttl_sec: 300,
    })).rejects.toThrow(/goal_id/);
    const row = await pool.query(
      `SELECT 1 FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key = 'test-dk-fail' AND expires_at > NOW()`
    );
    expect(row.rowCount).toBe(0);
  });
});
