/**
 * Tests for Thalamus (Event Router)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateDecision,
  hasDangerousActions,
  quickRoute,
  createFallbackDecision,
  EVENT_TYPES,
  ACTION_WHITELIST
} from '../thalamus.js';

describe('thalamus', () => {
  describe('validateDecision', () => {
    it('should pass valid decision', () => {
      const decision = {
        level: 1,
        actions: [{ type: 'dispatch_task', params: {} }],
        rationale: 'Test rationale',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail if level is invalid', () => {
      const decision = {
        level: 5,
        actions: [{ type: 'dispatch_task', params: {} }],
        rationale: 'Test',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('level 必须是 0, 1, 或 2');
    });

    it('should fail if actions is not array', () => {
      const decision = {
        level: 1,
        actions: 'not an array',
        rationale: 'Test',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('actions 必须是数组');
    });

    it('should fail if rationale is empty', () => {
      const decision = {
        level: 1,
        actions: [],
        rationale: '',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('rationale 必须是非空字符串');
    });

    it('should fail if confidence is out of range', () => {
      const decision = {
        level: 1,
        actions: [],
        rationale: 'Test',
        confidence: 1.5,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('confidence 必须是 0-1 之间的数字');
    });

    it('should fail if action type not in whitelist', () => {
      const decision = {
        level: 1,
        actions: [{ type: 'unknown_action', params: {} }],
        rationale: 'Test',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('不在白名单内');
    });

    it('should fail if action missing type', () => {
      const decision = {
        level: 1,
        actions: [{ params: {} }],
        rationale: 'Test',
        confidence: 0.8,
        safety: false
      };

      const result = validateDecision(decision);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('action 必须有 type 字段');
    });
  });

  describe('hasDangerousActions', () => {
    it('should return false for safe actions', () => {
      const decision = {
        actions: [
          { type: 'dispatch_task', params: {} },
          { type: 'create_task', params: {} }
        ]
      };

      expect(hasDangerousActions(decision)).toBe(false);
    });

    it('should return true for dangerous actions', () => {
      const decision = {
        actions: [
          { type: 'dispatch_task', params: {} },
          { type: 'request_human_review', params: {} }
        ]
      };

      expect(hasDangerousActions(decision)).toBe(true);
    });

    it('should return false for empty actions', () => {
      const decision = { actions: [] };
      expect(hasDangerousActions(decision)).toBe(false);
    });

    it('should return false for non-array actions', () => {
      const decision = { actions: null };
      expect(hasDangerousActions(decision)).toBe(false);
    });
  });

  describe('quickRoute', () => {
    it('should return no_action for heartbeat', () => {
      const event = { type: EVENT_TYPES.HEARTBEAT };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('no_action');
      expect(decision.confidence).toBe(1.0);
    });

    it('should return fallback_to_tick for normal tick', () => {
      const event = { type: EVENT_TYPES.TICK, has_anomaly: false };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('fallback_to_tick');
    });

    it('should return null for tick with anomaly (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.TICK, has_anomaly: true };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return dispatch_task for task completed without issues', () => {
      const event = { type: EVENT_TYPES.TASK_COMPLETED, has_issues: false };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('dispatch_task');
    });

    it('should return null for task completed with issues (needs analysis)', () => {
      const event = { type: EVENT_TYPES.TASK_COMPLETED, has_issues: true };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for user message (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.USER_MESSAGE };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for task failed (needs analysis)', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });
  });

  describe('createFallbackDecision', () => {
    it('should create fallback decision with correct structure', () => {
      const event = { type: 'test_event' };
      const reason = 'API timeout';

      const decision = createFallbackDecision(event, reason);

      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('fallback_to_tick');
      expect(decision.actions[0].params.event_type).toBe('test_event');
      expect(decision.rationale).toContain(reason);
      expect(decision.confidence).toBe(0.5);
      expect(decision.safety).toBe(false);
      expect(decision._fallback).toBe(true);
    });
  });

  describe('EVENT_TYPES', () => {
    it('should have all required event types', () => {
      expect(EVENT_TYPES.TASK_COMPLETED).toBe('task_completed');
      expect(EVENT_TYPES.TASK_FAILED).toBe('task_failed');
      expect(EVENT_TYPES.TICK).toBe('tick');
      expect(EVENT_TYPES.HEARTBEAT).toBe('heartbeat');
      expect(EVENT_TYPES.USER_MESSAGE).toBe('user_message');
      expect(EVENT_TYPES.OKR_CREATED).toBe('okr_created');
    });
  });

  describe('ACTION_WHITELIST', () => {
    it('should have all required actions', () => {
      expect(ACTION_WHITELIST['dispatch_task']).toBeDefined();
      expect(ACTION_WHITELIST['create_task']).toBeDefined();
      expect(ACTION_WHITELIST['cancel_task']).toBeDefined();
      expect(ACTION_WHITELIST['escalate_to_brain']).toBeDefined();
      expect(ACTION_WHITELIST['fallback_to_tick']).toBeDefined();
      expect(ACTION_WHITELIST['no_action']).toBeDefined();
    });

    it('should mark request_human_review as dangerous', () => {
      expect(ACTION_WHITELIST['request_human_review'].dangerous).toBe(true);
    });

    it('should not mark dispatch_task as dangerous', () => {
      expect(ACTION_WHITELIST['dispatch_task'].dangerous).toBe(false);
    });
  });
});
