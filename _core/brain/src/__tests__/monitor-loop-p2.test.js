/**
 * Tests for Monitor Loop P2 Integration (probation policy validation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validatePolicyJson } from '../policy-validator.js';

// We'll test the validation logic in isolation, as monitor-loop is complex
describe('Monitor Loop P2 - Probation Policy Validation', () => {
  describe('validatePolicyJson integration', () => {
    it('valid probation policy passes validation (non-strict mode)', () => {
      const validPolicy = {
        action: 'requeue',
        params: { delay_minutes: 30 },
        expected_outcome: 'Task will retry',
        confidence: 0.85,
        reasoning: 'Transient failure detected based on error pattern'
      };

      const result = validatePolicyJson(validPolicy, { strict: false });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('invalid probation policy fails validation', () => {
      const invalidPolicy = {
        action: 'invalid_action',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason'
      };

      const result = validatePolicyJson(invalidPolicy, { strict: false });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('low confidence probation policy warns but passes in non-strict mode', () => {
      const lowConfidencePolicy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.3, // < 0.5
        reasoning: 'test reason for validation'
      };

      const result = validatePolicyJson(lowConfidencePolicy, { strict: false });

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.field === 'confidence')).toBe(true);
    });

    it('missing required params fails validation', () => {
      const invalidPolicy = {
        action: 'requeue',
        params: {}, // missing delay_minutes
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };

      const result = validatePolicyJson(invalidPolicy, { strict: false });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
    });
  });

  describe('Probation policy validation workflow', () => {
    it('simulates workflow: read policy → validate → skip if invalid', () => {
      // Simulate reading a probation policy from DB
      const probationPolicy = {
        policy_id: 123,
        signature: 'test-signature',
        policy_json: {
          action: 'invalid', // invalid action
          params: {},
          expected_outcome: 'test',
          confidence: 0.8,
          reasoning: 'test'
        }
      };

      // Validate
      const validation = validatePolicyJson(probationPolicy.policy_json, { strict: false });

      // Should fail validation
      expect(validation.valid).toBe(false);

      // In monitor-loop, this would trigger:
      // 1. console.warn with validation errors
      // 2. Skip policy execution
      // 3. Log to cecelia_events (probation_policy_validation_failed)
      // 4. Continue with RCA
    });

    it('simulates workflow: read policy → validate → continue if valid', () => {
      // Simulate reading a valid probation policy
      const probationPolicy = {
        policy_id: 456,
        signature: 'test-signature',
        policy_json: {
          action: 'requeue',
          params: { delay_minutes: 30 },
          expected_outcome: 'Task will retry',
          confidence: 0.85,
          reasoning: 'Transient failure detected based on error pattern'
        }
      };

      // Validate
      const validation = validatePolicyJson(probationPolicy.policy_json, { strict: false });

      // Should pass validation
      expect(validation.valid).toBe(true);

      // In monitor-loop, this would trigger:
      // 1. Continue with simulation
      // 2. Parse policy_json with parsePolicyAction()
      // 3. Record policy evaluation
      // 4. Continue with RCA
    });
  });

  describe('Edge cases', () => {
    it('handles malformed JSON in policy_json field', () => {
      // If policy_json is stored as string and gets corrupted
      const result = validatePolicyJson('{invalid json}', { strict: false });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'json')).toBe(true);
    });

    it('handles null policy_json', () => {
      const result = validatePolicyJson(null, { strict: false });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'input')).toBe(true);
    });

    it('handles empty params for skip action', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };

      const result = validatePolicyJson(policy, { strict: false });

      expect(result.valid).toBe(true);
      expect(result.normalized.params.reason).toBe('No reason provided'); // default applied
    });
  });
});
