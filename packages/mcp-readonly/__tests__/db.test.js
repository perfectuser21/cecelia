import { it, expect, vi } from 'vitest';
import { query } from '../src/db.js';

it('timeout注入在任何取连接动作前拒绝，unit无需PG', async () => {
  const pool = { connect: vi.fn() };
  await expect(query(pool, 'SELECT 1', [], { timeoutMs: '5000; DROP TABLE probe --' }))
    .rejects.toThrow('invalid timeoutMs');
  expect(pool.connect).not.toHaveBeenCalled();
});
