/**
 * upsertLearning 单元测试
 *
 * T1: 新 title → INSERT，返回 { id, upserted: true }
 * T2: 已存在 title → UPDATE frequency_count+1，返回 { id, upserted: false }
 * T3: 不同 title → 各自 INSERT，互不影响
 * T4: pool.query 抛出异常时不吞掉错误（由调用方处理）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock embedding-service（避免触发 embedding 生成）
vi.mock('../embedding-service.js', () => ({
  generateLearningEmbeddingAsync: vi.fn(),
}));

// Mock openai-client.js
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn(),
}));

// Mock llm-caller.js（learning.js 内部可能依赖）
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

// Mock memory-utils.js
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn(() => 'mock summary'),
  generateMemoryStreamL1Async: vi.fn(),
}));

import pool from '../db.js';
import { upsertLearning } from '../learning.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T1: 新 title — INSERT 并返回 upserted: true', () => {
  it('新 title 不存在时应 INSERT 并返回 { upserted: true }', async () => {
    const newId = 'new-uuid-001';
    pool.query
      .mockResolvedValueOnce({ rows: [] })            // SELECT (not found)
      .mockResolvedValueOnce({ rows: [{ id: newId }] }); // INSERT RETURNING id

    const result = await upsertLearning({
      title: '全新教训标题',
      content: '内容',
      category: 'failure_pattern',
      triggerEvent: 'test',
    });

    expect(result.id).toBe(newId);
    expect(result.upserted).toBe(true);
    // 验证执行了 INSERT
    const insertCall = pool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('全新教训标题');
  });
});

describe('T2: 已有 title — UPDATE frequency_count+1，返回 upserted: false', () => {
  it('同 title 第二次写入时 frequency_count 应递增', async () => {
    const existingId = 'existing-uuid-002';
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: existingId, frequency_count: 2 }] }) // SELECT found
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await upsertLearning({
      title: '已有教训标题',
      content: '内容略有不同',
      category: 'quarantine_pattern',
    });

    expect(result.id).toBe(existingId);
    expect(result.upserted).toBe(false);

    // 验证 UPDATE 中传入了 frequency_count = 3（原值 2 + 1）
    const updateCall = pool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE learnings')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe(3); // newFreq = 2 + 1
    expect(updateCall[1][1]).toBe(existingId);
  });

  it('frequency_count 为 NULL 时视为 1，递增后应为 2', async () => {
    const existingId = 'existing-uuid-003';
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: existingId, frequency_count: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await upsertLearning({ title: '频次为空的教训' });

    expect(result.upserted).toBe(false);
    const updateCall = pool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE learnings')
    );
    expect(updateCall[1][0]).toBe(2); // COALESCE(null, 1) + 1 = 2
  });
});

describe('T3: 不同 title — 各自独立 INSERT', () => {
  it('两条不同 title 应各自 INSERT，互不影响', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })                   // SELECT title A (not found)
      .mockResolvedValueOnce({ rows: [{ id: 'id-A' }] })    // INSERT A
      .mockResolvedValueOnce({ rows: [] })                   // SELECT title B (not found)
      .mockResolvedValueOnce({ rows: [{ id: 'id-B' }] });   // INSERT B

    const r1 = await upsertLearning({ title: '教训 A' });
    const r2 = await upsertLearning({ title: '教训 B' });

    expect(r1.upserted).toBe(true);
    expect(r2.upserted).toBe(true);
    expect(r1.id).toBe('id-A');
    expect(r2.id).toBe('id-B');
  });
});

describe('T4: pool.query 抛出异常时不被吞掉', () => {
  it('DB 错误应向上抛出（由调用方决定是否 catch）', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

    await expect(
      upsertLearning({ title: '会失败的教训' })
    ).rejects.toThrow('DB connection failed');
  });
});

describe('T5: UPDATE 时应更新 last_reinforced_at', () => {
  it('重复写入时 UPDATE 的参数中应包含 NOW() 更新语义（通过 SQL 包含 last_reinforced_at 验证）', async () => {
    const existingId = 'existing-id-005';
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: existingId, frequency_count: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await upsertLearning({ title: '教训 005' });

    const updateCall = pool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE learnings')
    );
    expect(updateCall).toBeDefined();
    // UPDATE SQL 应包含 last_reinforced_at = NOW()
    expect(updateCall[0]).toContain('last_reinforced_at');
  });
});

describe('T6: INSERT 时 frequency_count 初始值应为 1', () => {
  it('新 learning INSERT 时 frequency_count 参数应为 1', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-id-006' }] });

    const result = await upsertLearning({
      title: '全新教训 006',
      content: '内容',
      category: 'test',
    });

    expect(result.upserted).toBe(true);
    const insertCall = pool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO learnings')
    );
    expect(insertCall).toBeDefined();
    // frequency_count=1 硬编码在 SQL 中（VALUES 中的字面量 1）
    expect(insertCall[0]).toContain('frequency_count');
    expect(insertCall[0]).toMatch(/VALUES.*1.*NOW\(\)/s);
  });
});
