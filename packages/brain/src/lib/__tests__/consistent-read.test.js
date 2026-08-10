import { describe, expect, it, vi } from 'vitest';
import { withConsistentSnapshot } from '../consistent-read.js';

function mockPool({ fail = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql) => {
      calls.push(String(sql));
      if (fail && String(sql).includes('SELECT facts')) throw new Error('read failed');
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, calls };
}

describe('withConsistentSnapshot', () => {
  it('在同一只读 REPEATABLE READ 事务执行全部读取并提交释放', async () => {
    const { pool, client, calls } = mockPool();
    const result = await withConsistentSnapshot(pool, async (reader) => {
      expect(reader).toBe(client);
      await reader.query('SELECT facts');
      await reader.query('SELECT header');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toEqual([
      expect.stringMatching(/BEGIN[\s\S]+REPEATABLE READ[\s\S]+READ ONLY/i),
      'SELECT facts',
      'SELECT header',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('读取失败时回滚并释放 client', async () => {
    const { pool, client, calls } = mockPool({ fail: true });
    await expect(withConsistentSnapshot(pool, (reader) => reader.query('SELECT facts')))
      .rejects.toThrow('read failed');
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
