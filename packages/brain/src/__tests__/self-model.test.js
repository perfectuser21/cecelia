/**
 * Self-Model 系统测试
 *
 * 覆盖：getSelfModel、getSelfModelRecord、initSeed、updateSelfModel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

import {
  getSelfModel,
  getSelfModelRecord,
  initSeed,
  updateSelfModel,
  SELF_MODEL_SEED,
} from '../self-model.js';

// ── 辅助 ──────────────────────────────────────────────────

function makePool() {
  return { query: mockQuery };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── 测试 ──────────────────────────────────────────────────

describe('SELF_MODEL_SEED', () => {
  it('是非空字符串', () => {
    expect(typeof SELF_MODEL_SEED).toBe('string');
    expect(SELF_MODEL_SEED.length).toBeGreaterThan(0);
    expect(SELF_MODEL_SEED).toContain('Cecelia');
  });
});

describe('getSelfModel', () => {
  it('有记录时返回最新内容', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: '我是 Cecelia，我在意效率。', created_at: new Date() }] });
    const result = await getSelfModel(pool);
    expect(result).toBe('我是 Cecelia，我在意效率。');
  });

  it('无记录时自动写入 seed 并返回 seed', async () => {
    const pool = makePool();
    // getSelfModel SELECT → 无记录
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // initSeed SELECT → 无记录
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // initSeed INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getSelfModel 内部再次调用（initSeed 后不重查，直接返回 seed）
    const result = await getSelfModel(pool);
    expect(result).toBe(SELF_MODEL_SEED);
    // 确认调用了 INSERT
    const calls = mockQuery.mock.calls;
    const insertCall = calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe(SELF_MODEL_SEED);
  });

  it('数据库失败时优雅降级返回 seed', async () => {
    const pool = makePool();
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    const result = await getSelfModel(pool);
    expect(result).toBe(SELF_MODEL_SEED);
  });
});

describe('initSeed', () => {
  it('无记录时插入 seed', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT → 无记录
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    await initSeed(pool);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO memory_stream');
    expect(insertCall[1][0]).toBe(SELF_MODEL_SEED);
  });

  it('已有记录时跳过插入（幂等）', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] }); // SELECT → 有记录

    await initSeed(pool);

    expect(mockQuery).toHaveBeenCalledTimes(1); // 只有 SELECT，无 INSERT
  });
});

describe('updateSelfModel', () => {
  it('在现有内容基础上追加新洞察', async () => {
    const pool = makePool();
    const existing = '我是 Cecelia，我在意效率。';
    const newInsight = '我发现我在意的是长期价值，而不是短期完成率。';

    // getSelfModel SELECT → 现有内容
    mockQuery.mockResolvedValueOnce({ rows: [{ content: existing, created_at: new Date() }] });
    // INSERT 新快照
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await updateSelfModel(newInsight, pool);

    expect(result).toContain(existing);
    expect(result).toContain(newInsight);

    // 确认 INSERT 调用了正确内容
    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toContain(existing);
    expect(insertCall[1][0]).toContain(newInsight);
  });

  it('新记录的 source_type 为 self_model', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: SELF_MODEL_SEED, created_at: new Date() }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await updateSelfModel('新认知', pool);

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall[0]).toContain("'self_model'");
  });
});

describe('getSelfModelRecord', () => {
  it('返回包含 content、updated_at、version 的对象', async () => {
    const pool = makePool();
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [{ content: '我是 Cecelia', created_at: now, version: '3' }],
    });

    const record = await getSelfModelRecord(pool);

    expect(record).toMatchObject({
      content: '我是 Cecelia',
      version: 3,
    });
    expect(record.updated_at).toBeDefined();
  });

  it('无记录时返回 seed 和 version=1', async () => {
    const pool = makePool();
    // getSelfModelRecord SELECT → 无记录
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // initSeed SELECT → 无记录
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // initSeed INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const record = await getSelfModelRecord(pool);

    expect(record.content).toBe(SELF_MODEL_SEED);
    expect(record.version).toBe(1);
  });

  it('数据库失败时返回 seed 和 version=0', async () => {
    const pool = makePool();
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    const record = await getSelfModelRecord(pool);

    expect(record.content).toBe(SELF_MODEL_SEED);
    expect(record.version).toBe(0);
  });
});
