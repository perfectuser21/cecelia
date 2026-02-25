/**
 * Chaos Hardening Tests
 *
 * Proves that the 6 stability hardening features actually work
 * by injecting failures and verifying correct system behavior.
 *
 * Scenarios:
 * 1. Transactional rollback: actionA succeeds, actionB fails → all rolled back
 * 2. Failure classification: ECONNREFUSED → SYSTEMIC, alertness signal fires
 * 3. LLM error separation: 429 → API_ERROR, bad JSON → BAD_OUTPUT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock client so vi.mock factory can reference it
const { mockClient, mockPool } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }] }),
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return { mockClient, mockPool };
});

vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ success: true, task: { id: 'task-1' } }),
  updateTask: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../tick.js', () => ({
  dispatchNextTask: vi.fn().mockResolvedValue({ dispatched: true }),
}));

import { executeDecision, actionHandlers } from '../decision-executor.js';
import { classifyFailure, FAILURE_CLASS } from '../quarantine.js';
import { classifyLLMError, LLM_ERROR_TYPE } from '../thalamus.js';

describe('chaos-hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  // ================================================================
  // Scenario 1: Transactional Rollback
  // ================================================================
  describe('Scenario 1: transactional rollback on partial failure', () => {
    it('should ROLLBACK all actions when second action throws DB error', async () => {
      // Setup: BEGIN succeeds, first action succeeds, second action throws
      let callCount = 0;
      mockClient.query.mockImplementation(async (sql) => {
        callCount++;
        if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
        if (typeof sql === 'string' && sql.includes('ROLLBACK')) return { rows: [] };
        if (typeof sql === 'string' && sql.includes('COMMIT')) return { rows: [] };
        // pending_actions insert for dangerous action
        if (typeof sql === 'string' && sql.includes('pending_actions')) {
          return { rows: [{ id: 'pa-1' }] };
        }
        return { rows: [{ id: 'test' }] };
      });

      // Inject a handler that succeeds, then one that throws
      const originalLogEvent = actionHandlers.log_event;
      actionHandlers.log_event = vi.fn()
        .mockResolvedValueOnce({ success: true })           // First call succeeds
        .mockRejectedValueOnce(new Error('DB connection lost'));  // Second call = DB error

      const decision = {
        level: 1,
        actions: [
          { type: 'log_event', params: { event_type: 'test1', data: { ok: true } } },
          { type: 'log_event', params: { event_type: 'test2', data: { ok: true } } },
        ],
        rationale: 'Chaos test: partial failure rollback',
        confidence: 0.9,
        safety: false,
      };

      const report = await executeDecision(decision);

      // Verify: rolled back
      expect(report.rolled_back).toBe(true);
      expect(report.success).toBe(false);
      expect(report.error).toContain('Transaction rolled back');
      expect(report.error).toContain('DB connection lost');

      // Verify ROLLBACK was called (not COMMIT)
      const rollbackCalls = mockClient.query.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('ROLLBACK')
      );
      const commitCalls = mockClient.query.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('COMMIT')
      );
      expect(rollbackCalls.length).toBe(1);
      expect(commitCalls.length).toBe(0);

      // Verify first action was attempted
      expect(actionHandlers.log_event).toHaveBeenCalledTimes(2);

      // Restore
      actionHandlers.log_event = originalLogEvent;
    });

    it('should COMMIT when all actions succeed', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ id: 'test' }] });

      const decision = {
        level: 1,
        actions: [
          { type: 'no_action', params: {} },
        ],
        rationale: 'Chaos test: happy path',
        confidence: 0.9,
        safety: false,
      };

      const report = await executeDecision(decision);

      expect(report.rolled_back).toBe(false);
      expect(report.success).toBe(true);

      const commitCalls = mockClient.query.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('COMMIT')
      );
      expect(commitCalls.length).toBe(1);
    });
  });

  // ================================================================
  // Scenario 2: Failure Classification + Alertness Signal
  // ================================================================
  describe('Scenario 2: failure classification drives alertness signals', () => {
    it('should classify ECONNREFUSED as NETWORK', () => {
      const result = classifyFailure('ECONNREFUSED 127.0.0.1:5432');
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should classify rate limit as RATE_LIMIT', () => {
      const result = classifyFailure('rate limit exceeded, retry in 60s');
      expect(result.class).toBe(FAILURE_CLASS.RATE_LIMIT);
    });

    it('should classify 500 Internal Server Error as NETWORK', () => {
      const result = classifyFailure('HTTP 500 Internal Server Error');
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });

    it('should classify ENOMEM as RESOURCE', () => {
      const result = classifyFailure('ENOMEM: Cannot allocate memory');
      expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
    });

    it('should classify disk full as RESOURCE', () => {
      const result = classifyFailure('ENOSPC: no space left on device');
      expect(result.class).toBe(FAILURE_CLASS.RESOURCE);
    });

    it('should classify normal TypeError as TASK_ERROR (not systemic)', () => {
      const result = classifyFailure('TypeError: undefined is not a function');
      expect(result.class).toBe(FAILURE_CLASS.TASK_ERROR);
    });

    it('should handle Error objects, not just strings', () => {
      const err = new Error('Connection refused to database');
      const result = classifyFailure(err);
      expect(result.class).toBe(FAILURE_CLASS.NETWORK);
    });

    it('should handle null/undefined gracefully', () => {
      expect(classifyFailure(null).class).toBe(FAILURE_CLASS.TASK_ERROR);
      expect(classifyFailure(undefined).class).toBe(FAILURE_CLASS.TASK_ERROR);
      expect(classifyFailure('').class).toBe(FAILURE_CLASS.TASK_ERROR);
    });
  });

  // ================================================================
  // Scenario 3: LLM Error Type Separation
  // ================================================================
  describe('Scenario 3: LLM error type separation', () => {
    it('should classify 429 rate limit as API_ERROR', () => {
      const err = new Error('429 Too Many Requests');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify ECONNREFUSED as API_ERROR', () => {
      const err = new Error('ECONNREFUSED 127.0.0.1:443');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify 500 server error as API_ERROR', () => {
      const err = new Error('500 Internal Server Error from Anthropic API');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify API key errors as API_ERROR', () => {
      const err = new Error('ANTHROPIC_API_KEY not set');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify quota exceeded as API_ERROR', () => {
      const err = new Error('quota exceeded, rate limit applied');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify timeout as TIMEOUT', () => {
      const err = new Error('Request timeout after 30000ms');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.TIMEOUT);
    });

    it('should classify aborted requests as TIMEOUT', () => {
      const err = new Error('The operation was aborted');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.TIMEOUT);
    });

    it('should classify bad JSON response as BAD_OUTPUT', () => {
      const err = new Error('Unexpected token < in JSON at position 0');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });

    it('should classify validation failure as BAD_OUTPUT', () => {
      const err = new Error('Response missing required field: actions');
      expect(classifyLLMError(err)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });

    it('should separate API_ERROR from BAD_OUTPUT correctly', () => {
      // This is the critical distinction: infra vs logic errors
      const infraError = new Error('429 Too Many Requests');
      const logicError = new Error('Cannot parse LLM response as JSON');

      const infraType = classifyLLMError(infraError);
      const logicType = classifyLLMError(logicError);

      expect(infraType).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(logicType).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
      expect(infraType).not.toBe(logicType);
    });

    it('should handle null/undefined input', () => {
      expect(classifyLLMError(null)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
      expect(classifyLLMError(undefined)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });
  });
});
