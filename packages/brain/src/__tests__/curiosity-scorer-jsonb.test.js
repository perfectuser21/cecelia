import { beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

vi.mock('../db.js', () => ({ default: { query: vi.fn(() => { throw Error('real DB forbidden'); }) } }));
import defaultPool from '../db.js';
import { calculateCuriosityScore, getCachedScore } from '../curiosity-scorer.js';

const cached = { total_score: 75, dimensions: { diversity: { score: 80 } }, calculated_at: '2026-03-11T10:00:00Z' };
const updatedAt = new Date('2026-03-11T11:00:00Z');
const decodeJsonb = pg.types.getTypeParser(3802, 'text');
beforeEach(() => { vi.clearAllMocks(); });

function cacheDb(value) {
  return { query: vi.fn(async sql => {
    expect(sql).toMatch(/^SELECT value_json, updated_at FROM working_memory/);
    return { rows: [{ value_json: value, updated_at: updatedAt }] };
  }) };
}

describe('真实getCachedScore的JSONB驱动边界', () => {
  it.each([
    ['pg JSONB默认解码对象', decodeJsonb(JSON.stringify(cached))],
    ['兼容旧JSON字符串', JSON.stringify(cached)],
  ])('%s保留评分与缓存时间，不改原对象', async (_label, value) => {
    const db = cacheDb(value);
    const before = JSON.stringify(value);
    expect(await getCachedScore(db)).toEqual({ ...cached, cached_at: updatedAt });
    expect(JSON.stringify(value)).toBe(before);
    expect(db.query).toHaveBeenCalledOnce();
    expect(defaultPool.query).not.toHaveBeenCalled();
  });

  it.each([null, undefined, [], [cached], 42, true, 'null', '[]', '42', 'true', '"text"', '{broken'])('坏缓存%j返回null', async value => {
    expect(await getCachedScore(cacheDb(value))).toBeNull();
    expect(defaultPool.query).not.toHaveBeenCalled();
  });

  it('真实计算写入内容经实际pg JSONB parser后可直接读回', async () => {
    let stored;
    const db = { query: vi.fn(async (sql, values) => {
      if (sql.includes('INSERT INTO working_memory')) {
        stored = decodeJsonb(values[0]); return { rows: [] };
      }
      if (sql.startsWith('SELECT value_json')) return { rows: [{ value_json: stored, updated_at: updatedAt }] };
      if (sql.includes('unique_domains')) return { rows: [{ unique_domains: '3', total_tasks: '10', domains: ['a', 'b', 'c'] }] };
      if (sql.includes('insight_count')) return { rows: [{ insight_count: '5' }] };
      if (sql.includes('AS completed')) return { rows: [{ total: '10', completed: '8' }] };
      throw Error('unexpected owned SQL');
    }) };
    const written = await calculateCuriosityScore(db);
    expect(written.total_score).toBe(64);
    expect(await getCachedScore(db)).toEqual({ ...written, cached_at: updatedAt });
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(defaultPool.query).not.toHaveBeenCalled();
  });

  it('实际计算的三个维度读取失败时恢复对象缓存，无INSERT覆盖', async () => {
    const db = { query: vi.fn(async sql => {
      if (sql.startsWith('SELECT value_json')) return { rows: [{ value_json: decodeJsonb(JSON.stringify(cached)), updated_at: updatedAt }] };
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
      throw Error('owned dimension read unavailable');
    }) };
    expect(await calculateCuriosityScore(db)).toEqual({ ...cached, cached_at: updatedAt });
    expect(db.query).toHaveBeenCalledTimes(4);
    expect(defaultPool.query).not.toHaveBeenCalled();
  });
});
