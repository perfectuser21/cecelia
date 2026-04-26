/**
 * Brain v2 L2 Orchestrator — pg-checkpointer 单元测试。
 *
 * 覆盖：
 *   1. getPgCheckpointer 首次调用 lazy init + 调 setup()
 *   2. 后续调用返回同一实例（singleton）
 *   3. setup() 只被调一次（promise 缓存）
 *   4. _resetPgCheckpointerForTests 清单例
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @langchain/langgraph-checkpoint-postgres，避免真连 pg
const mockSetup = vi.fn().mockResolvedValue(undefined);
const mockSaverInstance = { setup: mockSetup, _id: 'singleton-marker' };
const mockFromConnString = vi.fn(() => mockSaverInstance);

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: {
    fromConnString: (...args) => mockFromConnString(...args),
  },
}));

import { getPgCheckpointer, _resetPgCheckpointerForTests } from '../pg-checkpointer.js';

describe('pg-checkpointer', () => {
  beforeEach(() => {
    _resetPgCheckpointerForTests();
    mockFromConnString.mockClear();
    mockSetup.mockClear();
  });

  it('首次调用 lazy init + setup()', async () => {
    const saver = await getPgCheckpointer();
    expect(saver).toBe(mockSaverInstance);
    expect(mockFromConnString).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it('使用 DATABASE_URL 环境变量', async () => {
    const orig = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://test@example.com:5432/testdb';
    try {
      await getPgCheckpointer();
      expect(mockFromConnString).toHaveBeenCalledWith('postgresql://test@example.com:5432/testdb');
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
      expect(mockFromConnString).toHaveBeenCalledWith('postgresql://cecelia@localhost:5432/cecelia');
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
    // fromConnString / setup 各只调一次
    expect(mockFromConnString).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it('_resetPgCheckpointerForTests 清单例 → 下次重新 init', async () => {
    await getPgCheckpointer();
    expect(mockFromConnString).toHaveBeenCalledTimes(1);

    _resetPgCheckpointerForTests();
    await getPgCheckpointer();
    expect(mockFromConnString).toHaveBeenCalledTimes(2);
    expect(mockSetup).toHaveBeenCalledTimes(2);
  });
});
