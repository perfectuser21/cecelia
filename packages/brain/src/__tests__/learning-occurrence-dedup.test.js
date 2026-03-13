/**
 * Tests for learning occurrence deduplication
 * Covers: extractErrorType, findAndMergeRecentFailureLearning, handleTaskFailedLearning dedup path
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock db.js (default import used by auto-learning.js)
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

// Mock crypto for predictable hashes
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => ({ slice: vi.fn(() => 'test-hash-0001') })),
    })),
  },
}));

describe('extractErrorType', () => {
  let extractErrorType;

  beforeEach(async () => {
    vi.resetModules();
    ({ extractErrorType } = await import('../auto-learning.js'));
  });

  it('extracts OAUTH_401 from failure_class field', () => {
    expect(extractErrorType({ failure_class: 'OAUTH_401' })).toBe('OAUTH_401');
  });

  it('extracts OAUTH_401 from error text containing 401', () => {
    expect(extractErrorType({ error: 'HTTP 401 Unauthorized' })).toBe('OAUTH_401');
  });

  it('extracts OAUTH_401 from oauth keyword', () => {
    expect(extractErrorType({ error: 'oauth token expired' })).toBe('OAUTH_401');
  });

  it('extracts RATE_LIMIT from 429 status', () => {
    expect(extractErrorType({ error: 'rate limit 429 too many requests' })).toBe('RATE_LIMIT');
  });

  it('extracts TIMEOUT from timeout text', () => {
    expect(extractErrorType({ stderr_tail: 'connection timed out after 30s' })).toBe('TIMEOUT');
  });

  it('extracts NETWORK_ERROR from econnrefused', () => {
    expect(extractErrorType({ error: 'ECONNREFUSED 127.0.0.1:5432' })).toBe('NETWORK_ERROR');
  });

  it('returns null for unknown error pattern', () => {
    expect(extractErrorType({ error: 'unknown internal error' })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractErrorType(null)).toBeNull();
  });

  it('extracts from string result', () => {
    expect(extractErrorType('oauth token 401 expired')).toBe('OAUTH_401');
  });

  it('truncates error_type to 100 chars', () => {
    const longType = 'A'.repeat(200);
    const result = extractErrorType({ failure_class: longType });
    expect(result.length).toBe(100);
  });
});

describe('findAndMergeRecentFailureLearning', () => {
  let findAndMergeRecentFailureLearning;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    mockPool = { query: vi.fn() };
    ({ findAndMergeRecentFailureLearning } = await import('../auto-learning.js'));
  });

  it('returns null when errorType is null', async () => {
    const result = await findAndMergeRecentFailureLearning('failure_pattern', null, mockPool);
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('returns null when no recent matching learning found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // SELECT found nothing
    const result = await findAndMergeRecentFailureLearning('failure_pattern', 'OAUTH_401', mockPool);
    expect(result).toBeNull();
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('increments occurrence_count and returns id when match found', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'existing-learning-id' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await findAndMergeRecentFailureLearning('failure_pattern', 'OAUTH_401', mockPool);
    expect(result).toBe('existing-learning-id');

    // Verify SELECT query uses 24h window and correct params
    const selectCall = mockPool.query.mock.calls[0];
    expect(selectCall[0]).toContain('24 hours');
    expect(selectCall[1]).toEqual(['failure_pattern', 'OAUTH_401']);

    // Verify UPDATE increments occurrence_count
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain('occurrence_count = occurrence_count + 1');
    expect(updateCall[0]).toContain('updated_at = NOW()');
    expect(updateCall[1]).toEqual(['existing-learning-id']);
  });

  it('returns null and logs warning on DB error (non-fatal)', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await findAndMergeRecentFailureLearning('failure_pattern', 'OAUTH_401', mockPool);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('non-fatal'));
    consoleSpy.mockRestore();
  });
});

describe('handleTaskFailedLearning dedup path', () => {
  let handleTaskFailedLearning;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();
    mockPool = { query: vi.fn() };
    ({ handleTaskFailedLearning } = await import('../auto-learning.js'));
  });

  it('merges into existing learning when same error_type found within 24h', async () => {
    // findAndMergeRecentFailureLearning SELECT → found
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'existing-123' }] }) // SELECT in findAndMerge
      .mockResolvedValueOnce({ rows: [] }); // UPDATE in findAndMerge

    const result = await handleTaskFailedLearning(
      'task-abc',
      'dev',
      'failed',
      { failure_class: 'OAUTH_401' },
      2,
      {},
      null,
      mockPool
    );

    expect(result).toEqual({ id: 'existing-123', merged: true });
    // Should NOT have called INSERT (only SELECT + UPDATE for merge)
    const insertCall = mockPool.query.mock.calls.find(c => c[0].includes('INSERT INTO learnings'));
    expect(insertCall).toBeUndefined();
  });

  it('inserts new learning when no same error_type found within 24h', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT in findAndMerge → no match
      .mockResolvedValueOnce({ rows: [] }) // isDuplicateLearning → no dup
      .mockResolvedValueOnce({ rows: [{ id: 'new-learning-id', title: '任务失败：OAUTH_401' }] }); // INSERT

    const result = await handleTaskFailedLearning(
      'task-xyz',
      'dev',
      'failed',
      { failure_class: 'OAUTH_401' },
      0,
      {},
      null,
      mockPool
    );

    expect(result).toEqual({ id: 'new-learning-id', title: '任务失败：OAUTH_401' });
    const insertCall = mockPool.query.mock.calls.find(c => c[0].includes('INSERT INTO learnings'));
    expect(insertCall).toBeDefined();
    // Verify error_type is in INSERT
    expect(insertCall[0]).toContain('error_type');
  });

  it('does not merge when different error_type (OAUTH_401 vs RATE_LIMIT)', async () => {
    // First call: no OAUTH_401 match
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT for RATE_LIMIT → no match
      .mockResolvedValueOnce({ rows: [] }) // isDuplicateLearning
      .mockResolvedValueOnce({ rows: [{ id: 'new-id', title: '任务失败：RATE_LIMIT' }] }); // INSERT

    const result = await handleTaskFailedLearning(
      'task-rl',
      'dev',
      'failed',
      { failure_class: 'RATE_LIMIT' },
      0,
      {},
      null,
      mockPool
    );

    expect(result).not.toBeNull();
    expect(result.merged).toBeUndefined();
  });

  it('skips non-valuable task types (code_review)', async () => {
    const result = await handleTaskFailedLearning('task-cr', 'code_review', 'failed', {});
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
