/**
 * Contract Test: task-router.js
 *
 * Guards the interface contract of task routing functions.
 * These are pure functions - no DB or mocks needed.
 */
import { describe, it, expect } from 'vitest';
import {
  identifyWorkType,
  getTaskLocation,
  determineExecutionMode,
  routeTaskCreate,
  routeTaskWithFallback,
} from '../../task-router.js';

describe('task-router contract', () => {
  describe('identifyWorkType', () => {
    it('returns string for valid input', () => {
      const result = identifyWorkType('fix a bug');
      expect(typeof result).toBe('string');
    });

    it('returns "single" for fix patterns', () => {
      expect(identifyWorkType('修复登录 bug')).toBe('single');
      expect(identifyWorkType('fix login')).toBe('single');
    });

    it('returns "feature" for feature patterns', () => {
      expect(identifyWorkType('实现用户认证系统')).toBe('feature');
      expect(identifyWorkType('implement auth')).toBe('feature');
    });

    it('returns "ask_autumnrice" for null/undefined/empty', () => {
      expect(identifyWorkType(null)).toBe('ask_autumnrice');
      expect(identifyWorkType(undefined)).toBe('ask_autumnrice');
      expect(identifyWorkType('')).toBe('ask_autumnrice');
    });

    it('returns "ask_autumnrice" for ambiguous input', () => {
      expect(identifyWorkType('something random')).toBe('ask_autumnrice');
    });
  });

  describe('getTaskLocation', () => {
    it('returns "us" or "hk" for known task types', () => {
      const result = getTaskLocation('dev');
      expect(['us', 'hk']).toContain(result);
    });

    it('returns "us" for dev tasks', () => {
      expect(getTaskLocation('dev')).toBe('us');
    });

    it('returns default location for unknown types', () => {
      const result = getTaskLocation('nonexistent_type');
      expect(['us', 'hk']).toContain(result);
    });

    it('returns default location for null/undefined', () => {
      expect(getTaskLocation(null)).toBe('us');
      expect(getTaskLocation(undefined)).toBe('us');
    });
  });

  describe('determineExecutionMode', () => {
    it('returns string', () => {
      const result = determineExecutionMode({ input: 'test' });
      expect(typeof result).toBe('string');
    });

    it('returns "recurring" for recurring tasks', () => {
      expect(determineExecutionMode({ is_recurring: true })).toBe('recurring');
    });

    it('returns "feature_task" when feature_id present', () => {
      expect(determineExecutionMode({ feature_id: 'feat-1' })).toBe('feature_task');
    });

    it('returns "cecelia" for normal tasks', () => {
      expect(determineExecutionMode({ input: 'fix something' })).toBe('cecelia');
    });
  });

  describe('routeTaskCreate', () => {
    it('returns object with location and execution_mode', () => {
      const result = routeTaskCreate({ task_type: 'dev', title: 'test' });
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('execution_mode');
      expect(typeof result.location).toBe('string');
      expect(typeof result.execution_mode).toBe('string');
    });
  });

  describe('routeTaskWithFallback', () => {
    it('returns object with location, execution_mode, routing_status', () => {
      const result = routeTaskWithFallback({ task_type: 'dev', title: 'test' });
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('execution_mode');
      expect(result).toHaveProperty('routing_status');
      expect(typeof result.routing_status).toBe('string');
    });
  });
});
