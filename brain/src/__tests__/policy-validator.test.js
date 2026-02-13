/**
 * Tests for policy-validator.js (P2 Phase 1)
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_ACTIONS,
  ACTION_PARAMS_SCHEMA,
  isValidAction,
  getRequiredParams,
  validatePolicyJson
} from '../policy-validator.js';

describe('policy-validator', () => {
  describe('Constants', () => {
    it('exports ALLOWED_ACTIONS with 4 action types', () => {
      expect(ALLOWED_ACTIONS).toEqual(['requeue', 'skip', 'adjust_params', 'kill']);
    });

    it('exports ACTION_PARAMS_SCHEMA with 4 action schemas', () => {
      expect(Object.keys(ACTION_PARAMS_SCHEMA)).toHaveLength(4);
      expect(ACTION_PARAMS_SCHEMA.requeue).toBeDefined();
      expect(ACTION_PARAMS_SCHEMA.skip).toBeDefined();
      expect(ACTION_PARAMS_SCHEMA.adjust_params).toBeDefined();
      expect(ACTION_PARAMS_SCHEMA.kill).toBeDefined();
    });

    it('requeue schema has required delay_minutes and defaults', () => {
      expect(ACTION_PARAMS_SCHEMA.requeue.required).toContain('delay_minutes');
      expect(ACTION_PARAMS_SCHEMA.requeue.defaults.priority).toBe('normal');
    });

    it('skip schema has default reason', () => {
      expect(ACTION_PARAMS_SCHEMA.skip.defaults.reason).toBe('No reason provided');
    });
  });

  describe('isValidAction', () => {
    it('returns true for valid actions', () => {
      expect(isValidAction('requeue')).toBe(true);
      expect(isValidAction('skip')).toBe(true);
      expect(isValidAction('adjust_params')).toBe(true);
      expect(isValidAction('kill')).toBe(true);
    });

    it('returns false for invalid actions', () => {
      expect(isValidAction('invalid')).toBe(false);
      expect(isValidAction('retry')).toBe(false);
      expect(isValidAction('')).toBe(false);
      expect(isValidAction(null)).toBe(false);
    });
  });

  describe('getRequiredParams', () => {
    it('returns required params for requeue', () => {
      expect(getRequiredParams('requeue')).toEqual(['delay_minutes']);
    });

    it('returns empty array for skip', () => {
      expect(getRequiredParams('skip')).toEqual([]);
    });

    it('returns required params for adjust_params', () => {
      expect(getRequiredParams('adjust_params')).toEqual(['adjustments']);
    });

    it('returns required params for kill', () => {
      expect(getRequiredParams('kill')).toEqual(['reason']);
    });

    it('returns empty array for invalid action', () => {
      expect(getRequiredParams('invalid')).toEqual([]);
    });
  });

  describe('validatePolicyJson - Valid Policies', () => {
    it('validates valid requeue policy', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: 30 },
        expected_outcome: 'Task will retry after 30 minutes',
        confidence: 0.85,
        reasoning: 'Transient network error detected based on error pattern'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized.params.priority).toBe('normal'); // default applied
    });

    it('validates valid skip policy', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'Task will be skipped',
        confidence: 0.9,
        reasoning: 'Duplicate task detected, skipping to avoid waste'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.normalized.params.reason).toBe('No reason provided'); // default
    });

    it('validates valid adjust_params policy', () => {
      const policy = {
        action: 'adjust_params',
        params: { adjustments: { timeout: 60 } },
        expected_outcome: 'Task will run with increased timeout',
        confidence: 0.75,
        reasoning: 'Task consistently times out, needs more time'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
    });

    it('validates valid kill policy', () => {
      const policy = {
        action: 'kill',
        params: { reason: 'Malformed request' },
        expected_outcome: 'Task will be terminated',
        confidence: 0.95,
        reasoning: 'Request format is invalid and cannot be processed'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePolicyJson - Missing Required Fields', () => {
    it('rejects policy without action', () => {
      const policy = {
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'action', message: 'Missing required field: action' });
    });

    it('rejects policy without params', () => {
      const policy = {
        action: 'skip',
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'params', message: 'Missing required field: params' });
    });

    it('rejects policy without expected_outcome', () => {
      const policy = {
        action: 'skip',
        params: {},
        confidence: 0.8,
        reasoning: 'test reason'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'expected_outcome', message: 'Missing required field: expected_outcome' });
    });

    it('rejects policy without confidence', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        reasoning: 'test reason'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'confidence', message: 'Missing required field: confidence' });
    });

    it('rejects policy without reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({ field: 'reasoning', message: 'Missing required field: reasoning' });
    });
  });

  describe('validatePolicyJson - Invalid Action', () => {
    it('rejects invalid action type', () => {
      const policy = {
        action: 'invalid_action',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'action')).toBe(true);
    });
  });

  describe('validatePolicyJson - Invalid Params', () => {
    it('rejects requeue without delay_minutes', () => {
      const policy = {
        action: 'requeue',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
    });

    it('rejects requeue with invalid delay_minutes type', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: 'not_a_number' },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
    });

    it('rejects requeue with negative delay_minutes', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: -10 },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.delay_minutes')).toBe(true);
    });

    it('rejects requeue with invalid priority', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: 30, priority: 'invalid' },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.priority')).toBe(true);
    });

    it('rejects adjust_params without adjustments', () => {
      const policy = {
        action: 'adjust_params',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.adjustments')).toBe(true);
    });

    it('rejects adjust_params with non-object adjustments', () => {
      const policy = {
        action: 'adjust_params',
        params: { adjustments: 'not_an_object' },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.adjustments')).toBe(true);
    });

    it('rejects kill without reason', () => {
      const policy = {
        action: 'kill',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params.reason')).toBe(true);
    });

    it('rejects params as non-object', () => {
      const policy = {
        action: 'skip',
        params: 'not_an_object',
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'params')).toBe(true);
    });
  });

  describe('validatePolicyJson - Confidence Validation', () => {
    it('rejects confidence < 0', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: -0.1,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('rejects confidence > 1', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 1.5,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('warns for confidence < 0.5 in non-strict mode', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.3,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy, { strict: false });
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.field === 'confidence')).toBe(true);
    });

    it('rejects confidence < 0.5 in strict mode', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.3,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy, { strict: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('rejects non-number confidence', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 'not_a_number',
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });
  });

  describe('validatePolicyJson - Reasoning Validation', () => {
    it('rejects empty reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: ''
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'reasoning')).toBe(true);
    });

    it('rejects whitespace-only reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: '   '
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'reasoning')).toBe(true);
    });

    it('warns for very short reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'Short'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.field === 'reasoning')).toBe(true);
    });

    it('warns for very long reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'A'.repeat(600)
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.field === 'reasoning')).toBe(true);
    });

    it('rejects non-string reasoning', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 123
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'reasoning')).toBe(true);
    });
  });

  describe('validatePolicyJson - expected_outcome Validation', () => {
    it('rejects empty expected_outcome', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: '',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'expected_outcome')).toBe(true);
    });

    it('rejects non-string expected_outcome', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 123,
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'expected_outcome')).toBe(true);
    });
  });

  describe('validatePolicyJson - JSON Parsing', () => {
    it('parses valid JSON string', () => {
      const policyStr = JSON.stringify({
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      });
      const result = validatePolicyJson(policyStr);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid JSON string', () => {
      const result = validatePolicyJson('{invalid json}');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'json')).toBe(true);
    });

    it('rejects non-object non-string input', () => {
      const result = validatePolicyJson(123);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'input')).toBe(true);
    });
  });

  describe('validatePolicyJson - Normalization', () => {
    it('applies requeue default priority', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: 30 },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.normalized.params.priority).toBe('normal');
    });

    it('preserves explicit priority', () => {
      const policy = {
        action: 'requeue',
        params: { delay_minutes: 30, priority: 'high' },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.normalized.params.priority).toBe('high');
    });

    it('applies skip default reason', () => {
      const policy = {
        action: 'skip',
        params: {},
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.normalized.params.reason).toBe('No reason provided');
    });

    it('applies adjust_params default merge_strategy', () => {
      const policy = {
        action: 'adjust_params',
        params: { adjustments: { foo: 'bar' } },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(result.normalized.params.merge_strategy).toBe('merge');
    });

    it('does not add defaults for kill action', () => {
      const policy = {
        action: 'kill',
        params: { reason: 'Invalid request' },
        expected_outcome: 'test',
        confidence: 0.8,
        reasoning: 'test reason for validation'
      };
      const result = validatePolicyJson(policy);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.normalized.params)).toHaveLength(1); // only 'reason'
    });
  });
});
