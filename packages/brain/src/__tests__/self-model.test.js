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
  SelfModelWriteDeniedError,
} from '../self-model.js';
import { attemptUnauthorizedWrite } from './fixtures/self-model-attacker.js';

// ── 辅助 ──────────────────────────────────────────────────

function makePool() {
  return { query: mockQuery };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── 测试 ──────────────────────────────────────────────────

describe('SELF_MODEL_SEED', () => {
  it('是非空字符串且包含 Cecelia', () => {
    expect(typeof SELF_MODEL_SEED).toBe('string');
    expect(SELF_MODEL_SEED.length).toBeGreaterThan(0);
    expect(SELF_MODEL_SEED).toContain('Cecelia');
  });

  it('包含好奇心偏好描述', () => {
    expect(SELF_MODEL_SEED).toMatch(/好奇心/);
  });

  it('包含审美倾向描述（简洁/精准）', () => {
    expect(SELF_MODEL_SEED).toMatch(/审美/);
  });

  it('包含与 Alex 的协作关系描述（协作者）', () => {
    expect(SELF_MODEL_SEED).toMatch(/协作者/);
  });

  it('包含存在体验描述（tick/运行体验）', () => {
    expect(SELF_MODEL_SEED).toMatch(/tick|存在体验|运行.*体验/);
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

describe('updateSelfModel caller allowlist（self_model 写入代码层锁）', () => {
  it('SelfModelWriteDeniedError 是 Error 子类且 name 正确', () => {
    const err = new SelfModelWriteDeniedError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SelfModelWriteDeniedError');
  });

  it('未授权模块调用必须抛 SelfModelWriteDeniedError', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });

    await expect(attemptUnauthorizedWrite('恶意写入', pool))
      .rejects.toThrow(SelfModelWriteDeniedError);
  });

  it('未授权调用必须 0 次 INSERT memory_stream', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });

    await expect(attemptUnauthorizedWrite('恶意写入', pool)).rejects.toThrow();

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall).toBeUndefined();
  });

  it('从 self-model.test.js 直接调用应被允许（test 文件白名单）', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await updateSelfModel('合法演化', pool);
    expect(result).toContain('合法演化');
  });
});

describe('updateSelfModel ttlDays option（thalamus L2 战略洞察 90 天过期）', () => {
  it('默认 expires_at = NULL（永久）', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await updateSelfModel('永久洞察', pool);

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall[0]).toMatch(/NULL\)/);
    expect(insertCall[0]).not.toMatch(/INTERVAL/);
  });

  it('ttlDays=90 生成带 INTERVAL 90 days 的 SQL', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await updateSelfModel('临时洞察', pool, { ttlDays: 90 });

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall[0]).toMatch(/NOW\(\)\s*\+\s*INTERVAL\s*'90 days'/);
  });

  it('ttlDays 非整数应拒绝（防 SQL 注入）', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });

    await expect(updateSelfModel('恶意', pool, { ttlDays: "1; DROP TABLE memory_stream" }))
      .rejects.toThrow();

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT'));
    expect(insertCall).toBeUndefined();
  });

  it('ttlDays 负数应拒绝', async () => {
    const pool = makePool();
    mockQuery.mockResolvedValueOnce({ rows: [{ content: 'seed', created_at: new Date() }] });

    await expect(updateSelfModel('恶意', pool, { ttlDays: -1 })).rejects.toThrow();
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
