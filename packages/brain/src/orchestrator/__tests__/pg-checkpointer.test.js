/**
 * Brain v2 L2 Orchestrator — pg-checkpointer 单元测试。
 *
 * 覆盖：
 *   1. getPgCheckpointer 首次调用 lazy init + 调 setup()
 *   2. 后续调用返回同一实例（singleton）
 *   3. setup() 只被调一次（promise 缓存）
 *   4. _resetPgCheckpointerForTests 清单例
 *   5. 连接超时硬化：构造的 PostgresSaver 用带超时 pool（query_timeout/keepAlive），
 *      用 DATABASE_URL / 默认连接串构造（GAN 容器退出后图可靠推进根因修复）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @langchain/langgraph-checkpoint-postgres，避免真连 pg。
// 连接超时硬化后 getPgCheckpointer 用 new PostgresSaver(pool)（不再 fromConnString）。
const mockSetup = vi.fn().mockResolvedValue(undefined);
const mockCtor = vi.fn();

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: class {
    constructor(pool) {
      this.pool = pool;
      this.setup = mockSetup;
      mockCtor(pool);
    }
  },
}));

import {
  getPgCheckpointer,
  buildCheckpointerPool,
  buildPgCheckpointer,
  _resetPgCheckpointerForTests,
} from '../pg-checkpointer.js';

describe('pg-checkpointer', () => {
  beforeEach(() => {
    _resetPgCheckpointerForTests();
    mockCtor.mockClear();
    mockSetup.mockClear();
  });

  it('首次调用 lazy init + setup()', async () => {
    const saver = await getPgCheckpointer();
    expect(saver).toBeTruthy();
    expect(mockCtor).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it('构造用带超时硬化的 pool（query_timeout + keepAlive，防 checkpoint 写入静默无限挂起）', async () => {
    await getPgCheckpointer();
    const pool = mockCtor.mock.calls[0][0];
    expect(pool.options.query_timeout).toBeGreaterThan(0);
    expect(pool.options.statement_timeout).toBeGreaterThan(0);
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(pool.options.keepAlive).toBe(true);
    await pool.end();
  });

  it('使用 DATABASE_URL 环境变量', async () => {
    const orig = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test@example.com:5432/testdb';
    try {
      await getPgCheckpointer();
      const pool = mockCtor.mock.calls[0][0];
      expect(pool.options.connectionString).toBe('postgresql://test@example.com:5432/testdb');
      await pool.end();
    } finally {
      if (orig === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = orig;
    }
  });

  it('未设置 DATABASE_URL 时使用默认连接串', async () => {
    const orig = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await getPgCheckpointer();
      const pool = mockCtor.mock.calls[0][0];
      expect(pool.options.connectionString).toBe('postgresql://cecelia@localhost:5432/cecelia');
      await pool.end();
    } finally {
      if (orig !== undefined) process.env.DATABASE_URL = orig;
    }
  });

  it('多次调用返回同一实例（singleton）', async () => {
    const a = await getPgCheckpointer();
    const b = await getPgCheckpointer();
    const c = await getPgCheckpointer();
    expect(a).toBe(b);
    expect(b).toBe(c);
    // 构造 / setup 各只调一次
    expect(mockCtor).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it('_resetPgCheckpointerForTests 清单例 → 下次重新 init', async () => {
    await getPgCheckpointer();
    expect(mockCtor).toHaveBeenCalledTimes(1);

    _resetPgCheckpointerForTests();
    await getPgCheckpointer();
    expect(mockCtor).toHaveBeenCalledTimes(2);
    expect(mockSetup).toHaveBeenCalledTimes(2);
  });

  it('buildCheckpointerPool overrides 可覆盖默认超时（测试加速用）', async () => {
    const pool = buildCheckpointerPool('postgresql://cecelia@localhost:5432/cecelia', {
      connectionTimeoutMillis: 50,
    });
    expect(pool.options.connectionTimeoutMillis).toBe(50);
    expect(pool.options.keepAlive).toBe(true);
    await pool.end();
  });

  it('buildPgCheckpointer 返回 PostgresSaver 且 pool 带超时', async () => {
    const cp = buildPgCheckpointer('postgresql://cecelia@localhost:5432/cecelia');
    expect(cp.pool.options.query_timeout).toBeGreaterThan(0);
    await cp.pool.end();
  });
});
