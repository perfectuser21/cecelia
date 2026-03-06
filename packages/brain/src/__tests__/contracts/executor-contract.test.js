/**
 * Contract Test: executor.js
 *
 * Guards the interface contract of executor functions.
 * Tests pure exported functions (getSkillForTaskType, generateRunId, buildTimeContext).
 */
import { describe, it, expect } from 'vitest';
import {
  getSkillForTaskType,
  generateRunId,
  buildTimeContext,
} from '../../executor.js';

describe('executor contract', () => {
  describe('getSkillForTaskType', () => {
    it('returns a string for known task types', () => {
      expect(typeof getSkillForTaskType('dev')).toBe('string');
      expect(typeof getSkillForTaskType('review')).toBe('string');
    });

    it('returns /dev for "dev" type', () => {
      expect(getSkillForTaskType('dev')).toBe('/dev');
    });

    it('returns /code-review for "code_review" type', () => {
      expect(getSkillForTaskType('code_review')).toBe('/code-review');
    });

    it('returns /architect for "architecture_design" type', () => {
      expect(getSkillForTaskType('architecture_design')).toBe('/architect');
    });

    it('returns /dev as default for unknown types', () => {
      expect(getSkillForTaskType('unknown_type')).toBe('/dev');
    });

    it('handles payload decomposition override', () => {
      const result = getSkillForTaskType('dev', { decomposition: 'true' });
      expect(result).toBe('/decomp');
    });

    it('handles payload next_action override', () => {
      const result = getSkillForTaskType('dev', { next_action: 'decompose' });
      expect(result).toBe('/decomp');
    });
  });

  describe('generateRunId', () => {
    it('returns a string', () => {
      const result = generateRunId('task-1');
      expect(typeof result).toBe('string');
    });

    it('returns uuid-like format (36 chars with hyphens)', () => {
      const result = generateRunId('task-1');
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('returns unique values', () => {
      const a = generateRunId('task-1');
      const b = generateRunId('task-1');
      expect(a).not.toBe(b);
    });
  });

  describe('buildTimeContext', () => {
    it('is an async function', () => {
      expect(typeof buildTimeContext).toBe('function');
    });

    it('returns empty string when called without krId', async () => {
      const result = await buildTimeContext();
      expect(result).toBe('');
    });
  });
});
