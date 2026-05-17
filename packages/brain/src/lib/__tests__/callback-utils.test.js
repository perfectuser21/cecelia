import { describe, it, expect } from 'vitest';
import {
  normalizeCallbackStatus,
  extractPrNumber,
  extractFindingsValue,
  buildExecMetaJson,
  buildFailureFields,
} from '../callback-utils.js';

describe('callback-utils', () => {
  describe('normalizeCallbackStatus', () => {
    it('maps AI Done → completed', () => {
      expect(normalizeCallbackStatus('AI Done')).toBe('completed');
    });
    it('maps success → completed', () => {
      expect(normalizeCallbackStatus('success')).toBe('completed');
    });
    it('maps AI Failed → failed', () => {
      expect(normalizeCallbackStatus('AI Failed')).toBe('failed');
    });
    it('maps failed → failed', () => {
      expect(normalizeCallbackStatus('failed')).toBe('failed');
    });
    it('maps timeout → failed', () => {
      expect(normalizeCallbackStatus('timeout')).toBe('failed');
    });
    it('maps AI Quota Exhausted → quota_exhausted', () => {
      expect(normalizeCallbackStatus('AI Quota Exhausted')).toBe('quota_exhausted');
    });
    it('maps unknown → in_progress', () => {
      expect(normalizeCallbackStatus('something_else')).toBe('in_progress');
    });
  });

  describe('extractPrNumber', () => {
    it('extracts PR number from GitHub URL', () => {
      expect(extractPrNumber('https://github.com/org/repo/pull/123')).toBe(123);
    });
    it('returns null for null input', () => {
      expect(extractPrNumber(null)).toBe(null);
    });
    it('returns null when no /pull/ in URL', () => {
      expect(extractPrNumber('https://github.com/org/repo')).toBe(null);
    });
  });

  describe('extractFindingsValue', () => {
    it('returns string directly', () => {
      expect(extractFindingsValue('some findings')).toBe('some findings');
    });
    it('extracts findings field from object', () => {
      expect(extractFindingsValue({ findings: 'x' })).toBe('x');
    });
    it('returns null for null', () => {
      expect(extractFindingsValue(null)).toBe(null);
    });
  });

  describe('buildExecMetaJson', () => {
    it('returns null for non-object result', () => {
      expect(buildExecMetaJson('string')).toBe(null);
    });
    it('returns null when no meta keys present', () => {
      expect(buildExecMetaJson({ foo: 'bar' })).toBe(null);
    });
    it('returns JSON string with meta keys', () => {
      const result = buildExecMetaJson({ duration_ms: 1000, num_turns: 3 });
      const parsed = JSON.parse(result);
      expect(parsed.duration_ms).toBe(1000);
      expect(parsed.num_turns).toBe(3);
    });
  });

  describe('buildFailureFields', () => {
    it('returns nulls for non-failed status', () => {
      const { errorMessage, blockedDetail } = buildFailureFields('completed', null, null, null, 'task-1');
      expect(errorMessage).toBe(null);
      expect(blockedDetail).toBe(null);
    });
    it('returns error fields for failed status with object result', () => {
      const { errorMessage, blockedDetail } = buildFailureFields('failed', { result: 'oops' }, null, 1, 'task-1');
      expect(errorMessage).toBe('oops');
      expect(blockedDetail).toBeTruthy();
    });
  });
});
