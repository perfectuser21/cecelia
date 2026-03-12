/**
 * Tests for learning-retriever.js
 *
 * buildLearningContext:
 * - Returns '' when no learnings qualify (score <= 0.3)
 * - Returns formatted block when high-score learnings exist
 * - Groups by learning_type
 * - Limits to MAX_INJECT (3) results
 * - Returns '' on DB error (degradation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing learning-retriever
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

let mockPool;
let buildLearningContext;

beforeEach(async () => {
  vi.resetModules();
  mockPool = (await import('../db.js')).default;
  ({ buildLearningContext } = await import('../learning-retriever.js'));
});

const NOW = Date.now();

function makeLearning(overrides = {}) {
  return {
    id: 'l1',
    title: 'Test learning',
    content: 'Some content about dev task fix vitest mock',
    learning_type: 'trap',
    category: 'failure_pattern',
    metadata: { task_type: 'dev' },
    created_at: new Date(NOW - 2 * 86400000).toISOString(), // 2 days ago
    ...overrides,
  };
}

describe('buildLearningContext', () => {
  it('returns empty string when no rows qualify', async () => {
    // Score will be: age(3) only → 3/31 ≈ 0.097 < 0.3
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeLearning({
          metadata: {},
          category: 'general',
          content: 'unrelated content xyz',
          learning_type: null,
        }),
      ],
    });

    const result = await buildLearningContext({ id: 't1', task_type: 'data', title: 'migrate something', domain: '' });
    expect(result).toBe('');
  });

  it('returns formatted block for high-score learning (task_type match)', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeLearning({
          // task_type=dev(+10) + failure_pattern(+4) + age<=7d(+3) = 17/31 ≈ 0.55
          metadata: { task_type: 'dev' },
          category: 'failure_pattern',
          learning_type: 'trap',
        }),
      ],
    });

    const result = await buildLearningContext({ id: 't2', task_type: 'dev', title: 'do something', domain: '' });
    expect(result).toContain('相关历史 Learning');
    expect(result).toContain('⚠️ 陷阱');
    expect(result).toContain('Test learning');
  });

  it('groups by learning_type correctly', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeLearning({ id: 'l1', learning_type: 'trap', metadata: { task_type: 'dev' } }),
        makeLearning({ id: 'l2', learning_type: 'best_practice', title: 'BP learning', metadata: { task_type: 'dev' } }),
      ],
    });

    const result = await buildLearningContext({ id: 't3', task_type: 'dev', title: 'dev task', domain: '' });
    expect(result).toContain('⚠️ 陷阱');
    expect(result).toContain('✅ 最佳实践');
  });

  it('limits to 3 results even with many qualifying learnings', async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeLearning({ id: `l${i}`, title: `Learning ${i}`, metadata: { task_type: 'dev' } })
    );
    mockPool.query.mockResolvedValueOnce({ rows });

    const result = await buildLearningContext({ id: 't4', task_type: 'dev', title: 'dev task', domain: '' });
    // Count how many "Learning N" titles appear
    const matches = (result.match(/Learning \d/g) || []).length;
    expect(matches).toBeLessThanOrEqual(3);
  });

  it('returns empty string on DB error (degradation)', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection refused'));

    const result = await buildLearningContext({ id: 't5', task_type: 'dev', title: 'task', domain: '' });
    expect(result).toBe('');
  });

  it('uses domain match for scoring', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeLearning({
          // domain=agent_ops(+6) + failure_pattern(+4) + age(+3) = 13/31 ≈ 0.42
          metadata: { task_type: 'other', domain: 'agent_ops' },
          category: 'failure_pattern',
          learning_type: 'failure_pattern',
          title: 'Domain specific learning',
        }),
      ],
    });

    const result = await buildLearningContext({
      id: 't6', task_type: 'dev', title: 'some task', domain: 'agent_ops'
    });
    expect(result).toContain('Domain specific learning');
  });
});
