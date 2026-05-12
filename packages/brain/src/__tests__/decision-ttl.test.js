/**
 * decision-ttl.test.js — TDD for DECISION_TTL_MIN in getGuidance
 *
 * 场景：
 *   C1a: decision created 5 min ago → 返回正常 value（新鲜）
 *   C1b: decision created 30 min ago → 返回 null（TTL=15min 默认超时）
 *   C1c: DECISION_TTL_MIN env override 生效（TTL=60min 时 30 min 的 decision 仍有效）
 *   C1d: 非 decision value（无 decision_id）不受 TTL 限制
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

function minutesAgo(n) {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

describe('getGuidance — DECISION_TTL_MIN', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
    delete process.env.DECISION_TTL_MIN;
  });

  afterEach(() => {
    delete process.env.DECISION_TTL_MIN;
  });

  it('C1a: decision created 5 min ago — 返回 value（新鲜）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        value: { decision_id: 'dec-001', actions: ['retry'] },
        updated_at: minutesAgo(5),
      }],
    });
    const { getGuidance } = await import('../guidance.js');
    const result = await getGuidance('strategy:global');
    expect(result).toEqual({ decision_id: 'dec-001', actions: ['retry'] });
  });

  it('C1b: decision created 30 min ago — 返回 null（TTL=15 超时）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        value: { decision_id: 'dec-old', actions: ['retry bb776b90'] },
        updated_at: minutesAgo(30),
      }],
    });
    const { getGuidance } = await import('../guidance.js');
    const result = await getGuidance('strategy:global');
    expect(result).toBeNull();
  });

  it('C1c: DECISION_TTL_MIN=60 env override — 30 min 的 decision 仍有效', async () => {
    process.env.DECISION_TTL_MIN = '60';
    mockQuery.mockResolvedValueOnce({
      rows: [{
        value: { decision_id: 'dec-002', actions: ['continue'] },
        updated_at: minutesAgo(30),
      }],
    });
    const { getGuidance } = await import('../guidance.js');
    const result = await getGuidance('strategy:global');
    expect(result).toEqual({ decision_id: 'dec-002', actions: ['continue'] });
  });

  it('C1d: 非 decision value（无 decision_id）不受 TTL 限制', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        value: { executor: 'bridge', thread_id: 'abc' },
        updated_at: minutesAgo(120),
      }],
    });
    const { getGuidance } = await import('../guidance.js');
    const result = await getGuidance('routing:task-999');
    expect(result).toEqual({ executor: 'bridge', thread_id: 'abc' });
  });
});
