import { describe, it, expect } from 'vitest';
import {
  extractVerdict,
  thresholdForRound,
  extractFeedback,
  extractProposeBranch,
  fallbackProposeBranch,
  computeVerdictFromRubric,
} from '../harness-gan.graph.js';

describe('harness-gan.graph — pure helper functions', () => {
  describe('extractVerdict', () => {
    it('returns APPROVED when stdout contains VERDICT: APPROVED', () => {
      expect(extractVerdict('some text\nVERDICT: APPROVED\nmore')).toBe('APPROVED');
    });
    it('returns REVISION when stdout contains VERDICT: REVISION', () => {
      expect(extractVerdict('VERDICT: REVISION')).toBe('REVISION');
    });
    it('returns REVISION as default when no verdict found', () => {
      expect(extractVerdict('no verdict here')).toBe('REVISION');
    });
  });

  describe('thresholdForRound', () => {
    it('returns a number between 0 and 1', () => {
      const t = thresholdForRound(1);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1);
    });
    it('round 3 threshold <= round 1 threshold', () => {
      expect(thresholdForRound(3)).toBeLessThanOrEqual(thresholdForRound(1));
    });
  });

  describe('extractFeedback', () => {
    it('extracts FEEDBACK block from stdout', () => {
      const result = extractFeedback('Some output\nFEEDBACK: needs more tests\nother');
      expect(result).toContain('needs more tests');
    });
    it('returns empty string when no feedback', () => {
      expect(extractFeedback('no feedback here')).toBe('');
    });
  });

  describe('extractProposeBranch', () => {
    it('extracts branch name from PROPOSE_BRANCH: line', () => {
      expect(extractProposeBranch('PROPOSE_BRANCH: cp-12345678-my-feature\ndone')).toBe('cp-12345678-my-feature');
    });
    it('returns null when no branch found', () => {
      expect(extractProposeBranch('no branch here')).toBeNull();
    });
  });

  describe('fallbackProposeBranch', () => {
    it('returns a cp-* branch name containing taskId prefix', () => {
      const branch = fallbackProposeBranch('abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      expect(branch).toMatch(/^cp-/);
      expect(branch).toContain('abc12345');
    });
  });

  describe('computeVerdictFromRubric', () => {
    it('returns REVISION when scores array is empty', () => {
      expect(computeVerdictFromRubric([], 1)).toBe('REVISION');
    });
    it('returns APPROVED or REVISION (valid values)', () => {
      const v = computeVerdictFromRubric([{ score: 0.9 }, { score: 0.95 }], 1);
      expect(['APPROVED', 'REVISION']).toContain(v);
    });
  });
});
