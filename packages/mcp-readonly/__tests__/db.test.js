import { describe, it, expect, afterAll } from 'vitest';
import { createReadonlyPool, query } from '../src/db.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('db pool', () => {
  const pool = createReadonlyPool(TEST_DB_URL, { max: 5 });

  afterAll(async () => {
    await pool.end();
  });

  it('轻查询 2s 内返回结果', async () => {
    const result = await query(pool, 'SELECT 1 as one', [], { timeoutMs: 2000 });
    expect(result.rows[0].one).toBe(1);
  });

  it('查询超时抛出 timeout 错误', async () => {
    await expect(
      query(pool, 'SELECT pg_sleep(3)', [], { timeoutMs: 100 })
    ).rejects.toThrow('timeout');
  });

  it('连接池 max 上限为 5', () => {
    expect(pool.options.max).toBe(5);
  });

  it('超时后归还的连接不会把 statement_timeout 泄漏给下一个查询', async () => {
    // 先触发一次 100ms 超时查询（会走 finally 里的 client.release()）
    await expect(
      query(pool, 'SELECT pg_sleep(3)', [], { timeoutMs: 100 })
    ).rejects.toThrow('timeout');

    // 紧接着用一个明显更长、但仍然合理的耗时查询 + 更大的 timeoutMs
    // 如果 statement_timeout 没有被重置，前一个 client 被复用时依旧携带 100ms 限制，这里会误报超时
    const result = await query(pool, 'SELECT pg_sleep(0.3), 42 as answer', [], { timeoutMs: 2000 });
    expect(result.rows[0].answer).toBe(42);
  });
});
