/**
 * Tests for Cortex P2 Integration (storeAbsorptionPolicy)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storeAbsorptionPolicy } from '../cortex.js';
import pool from '../db.js';

// Mock pool.query
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

describe('Cortex P2 - storeAbsorptionPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates and stores valid policy', async () => {
    const validPolicy = {
      action: 'requeue',
      params: { delay_minutes: 30 },
      expected_outcome: 'Task will retry',
      confidence: 0.85,
      reasoning: 'Transient failure detected based on error pattern'
    };

    pool.query.mockResolvedValueOnce({ rows: [{ policy_id: 123 }] }); // INSERT policy
    pool.query.mockResolvedValueOnce({}); // INSERT event

    const policyId = await storeAbsorptionPolicy(validPolicy, {
      event_type: 'task_failure',
      task_id: 'task-1',
      signature: 'test-signature'
    });

    expect(policyId).toBe(123);
    expect(pool.query).toHaveBeenCalledTimes(2); // policy insert + event insert
  });

  it('rejects invalid policy and logs failure', async () => {
    const invalidPolicy = {
      action: 'invalid_action',
      params: {},
      expected_outcome: 'test',
      confidence: 0.8,
      reasoning: 'test reason'
    };

    pool.query.mockResolvedValueOnce({}); // INSERT event

    const policyId = await storeAbsorptionPolicy(invalidPolicy);

    expect(policyId).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1); // only event insert
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('policy_validation_failed'),
      expect.anything()
    );
  });

  it('logs validation errors to cecelia_events', async () => {
    const invalidPolicy = {
      action: 'requeue',
      params: {}, // missing delay_minutes
      expected_outcome: 'test',
      confidence: 0.8,
      reasoning: 'test reason for validation'
    };

    pool.query.mockResolvedValueOnce({}); // INSERT event

    await storeAbsorptionPolicy(invalidPolicy);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('policy_validation_failed'),
      expect.arrayContaining([
        expect.stringContaining('validation_errors')
      ])
    );
  });

  it('applies normalization defaults', async () => {
    const policyWithoutDefaults = {
      action: 'requeue',
      params: { delay_minutes: 30 }, // no priority
      expected_outcome: 'Task will retry',
      confidence: 0.85,
      reasoning: 'Transient failure detected based on error pattern'
    };

    pool.query.mockResolvedValueOnce({ rows: [{ policy_id: 456 }] }); // INSERT policy
    pool.query.mockResolvedValueOnce({}); // INSERT event

    await storeAbsorptionPolicy(policyWithoutDefaults);

    // Check that normalized policy (with defaults) was inserted
    const insertCall = pool.query.mock.calls[0];
    const insertedPolicy = insertCall[1][1]; // second parameter of first query
    expect(insertedPolicy.params.priority).toBe('normal'); // default applied
  });

  it('rejects low confidence in strict mode', async () => {
    const lowConfidencePolicy = {
      action: 'skip',
      params: {},
      expected_outcome: 'test',
      confidence: 0.3, // < 0.5
      reasoning: 'test reason for validation'
    };

    pool.query.mockResolvedValueOnce({}); // INSERT event

    const policyId = await storeAbsorptionPolicy(lowConfidencePolicy);

    expect(policyId).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('policy_validation_failed'),
      expect.anything()
    );
  });

  it('supports all 4 action types', async () => {
    const actions = ['requeue', 'skip', 'adjust_params', 'kill'];

    for (const action of actions) {
      vi.clearAllMocks();

      let policy;
      if (action === 'requeue') {
        policy = {
          action,
          params: { delay_minutes: 30 },
          expected_outcome: 'test',
          confidence: 0.8,
          reasoning: 'test reason for validation'
        };
      } else if (action === 'skip') {
        policy = {
          action,
          params: {},
          expected_outcome: 'test',
          confidence: 0.8,
          reasoning: 'test reason for validation'
        };
      } else if (action === 'adjust_params') {
        policy = {
          action,
          params: { adjustments: { timeout: 60 } },
          expected_outcome: 'test',
          confidence: 0.8,
          reasoning: 'test reason for validation'
        };
      } else { // kill
        policy = {
          action,
          params: { reason: 'Invalid request' },
          expected_outcome: 'test',
          confidence: 0.8,
          reasoning: 'test reason for validation'
        };
      }

      pool.query.mockResolvedValueOnce({ rows: [{ policy_id: 999 }] }); // INSERT policy
      pool.query.mockResolvedValueOnce({}); // INSERT event

      const policyId = await storeAbsorptionPolicy(policy);

      expect(policyId).toBe(999);
    }
  });

  it('handles storage errors gracefully', async () => {
    const validPolicy = {
      action: 'skip',
      params: {},
      expected_outcome: 'test',
      confidence: 0.8,
      reasoning: 'test reason for validation'
    };

    pool.query.mockRejectedValueOnce(new Error('Database error')); // INSERT policy fails
    pool.query.mockResolvedValueOnce({}); // error event logging (might also fail, but mock success)

    const policyId = await storeAbsorptionPolicy(validPolicy);

    expect(policyId).toBeNull();
    // Should attempt to log error event
    expect(pool.query).toHaveBeenCalledTimes(2); // attempted policy insert + error event
  });

  it('creates policy with status=draft', async () => {
    const validPolicy = {
      action: 'skip',
      params: {},
      expected_outcome: 'test',
      confidence: 0.8,
      reasoning: 'test reason for validation'
    };

    pool.query.mockResolvedValueOnce({ rows: [{ policy_id: 789 }] }); // INSERT policy
    pool.query.mockResolvedValueOnce({}); // INSERT event

    await storeAbsorptionPolicy(validPolicy, { signature: 'test-sig' });

    const insertCall = pool.query.mock.calls[0];
    const query = insertCall[0];
    expect(query).toContain("'draft'"); // status=draft
  });

  it('logs policy_created event on success', async () => {
    const validPolicy = {
      action: 'skip',
      params: {},
      expected_outcome: 'test',
      confidence: 0.8,
      reasoning: 'test reason for validation'
    };

    pool.query.mockResolvedValueOnce({ rows: [{ policy_id: 111 }] }); // INSERT policy
    pool.query.mockResolvedValueOnce({}); // INSERT event

    await storeAbsorptionPolicy(validPolicy);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('policy_created'),
      expect.anything()
    );
  });
});
