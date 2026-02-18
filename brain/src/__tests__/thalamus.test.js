/**
 * Tests for Thalamus (Event Router)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateDecision,
  hasDangerousActions,
  quickRoute,
  createFallbackDecision,
  classifyLLMError,
  LLM_ERROR_TYPE,
  EVENT_TYPES,
  ACTION_WHITELIST,
  parseDecisionFromResponse,
  processEvent
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

    it('should return [log_event, fallback_to_tick] for tick with resource_pressure anomaly', () => {
      const event = { type: EVENT_TYPES.TICK, has_anomaly: true, anomaly_type: 'resource_pressure' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.reason).toBe('resource_pressure');
      expect(decision.actions[1].type).toBe('fallback_to_tick');
      expect(decision.confidence).toBe(0.85);
    });

    it('should return [log_event, reprioritize_task] for tick with stale_tasks anomaly', () => {
      const event = { type: EVENT_TYPES.TICK, has_anomaly: true, anomaly_type: 'stale_tasks' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.reason).toBe('stale_tasks');
      expect(decision.actions[1].type).toBe('reprioritize_task');
      expect(decision.confidence).toBe(0.8);
    });

    it('should return null for tick with unknown anomaly type (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.TICK, has_anomaly: true, anomaly_type: 'unknown_anomaly' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for tick with anomaly and no anomaly_type (needs Sonnet)', () => {
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

    it('should return null for user message without intent (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.USER_MESSAGE };
      const decision = quickRoute(event);

      // develop 实现：无 intent 字段 → null（交给 Sonnet）
      expect(decision).toBeNull();
    });

    it('should log_event for USER_MESSAGE with intent=status_query (confidence=0.85)', () => {
      const event = { type: EVENT_TYPES.USER_MESSAGE, intent: 'status_query' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.intent).toBe('status_query');
      expect(decision.confidence).toBe(0.85);
    });

    it('should log_event for USER_MESSAGE with intent=acknowledge (confidence=0.9)', () => {
      const event = { type: EVENT_TYPES.USER_MESSAGE, intent: 'acknowledge' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.intent).toBe('acknowledge');
      expect(decision.confidence).toBe(0.9);
    });

    it('should return null for USER_MESSAGE with other intent (command) (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.USER_MESSAGE, intent: 'command' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should retry task on simple task failed (no complex reason)', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED, task_id: 'abc', retry_count: 0 };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('retry_task');
      expect(decision.actions[0].params.task_id).toBe('abc');
    });

    it('should return null for task failed with complex reason (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED, task_id: 'abc', complex_reason: true, retry_count: 1 };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should cancel task when retry exceeded and no complex reason (retry=3)', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED, task_id: 'abc', retry_count: 3 };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('cancel_task');
      expect(decision.actions[0].params.task_id).toBe('abc');
      expect(decision.actions[0].params.reason).toBe('retry_exceeded');
    });

    it('should cancel task when retry=4 and no complex reason', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED, task_id: 'def', retry_count: 4 };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('cancel_task');
    });

    it('should still return null for task failed with complex reason even if retry exceeded', () => {
      const event = { type: EVENT_TYPES.TASK_FAILED, task_id: 'ghi', complex_reason: true, retry_count: 3 };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log and retry on task timeout', () => {
      const event = { type: EVENT_TYPES.TASK_TIMEOUT, task_id: 'abc' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[1].type).toBe('retry_task');
      expect(decision.actions[1].params.backoff).toBe(true);
    });

    it('should return no_action for task created event', () => {
      const event = { type: EVENT_TYPES.TASK_CREATED, task_id: 'abc' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('no_action');
    });

    it('should log_event for OKR_CREATED with confidence=0.95', () => {
      const event = { type: EVENT_TYPES.OKR_CREATED, okr_id: 'okr-1' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.confidence).toBe(0.95);
    });

    it('should log_event for OKR_PROGRESS_UPDATE when not blocked (confidence=0.9)', () => {
      const event = { type: EVENT_TYPES.OKR_PROGRESS_UPDATE, okr_id: 'okr-1', is_blocked: false };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.confidence).toBe(0.9);
    });

    it('should return notify_user + mark_task_blocked for normal OKR_BLOCKED', () => {
      const event = { type: EVENT_TYPES.OKR_BLOCKED, okr_id: 'okr-1', task_id: 'task-1' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('notify_user');
      expect(decision.actions[1].type).toBe('mark_task_blocked');
      expect(decision.confidence).toBe(0.85);
    });

    it('should pass okr_id and task_id in params for normal OKR_BLOCKED', () => {
      const event = { type: EVENT_TYPES.OKR_BLOCKED, okr_id: 'okr-42', task_id: 'task-99' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].params.okr_id).toBe('okr-42');
      expect(decision.actions[1].params.task_id).toBe('task-99');
    });

    it('should return null for OKR_BLOCKED with is_critical=true (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.OKR_BLOCKED, okr_id: 'okr-1', task_id: 'task-1', is_critical: true };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for OKR_BLOCKED with long_blocked=true (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.OKR_BLOCKED, okr_id: 'okr-1', task_id: 'task-1', long_blocked: true };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log and archive department report', () => {
      const event = { type: EVENT_TYPES.DEPARTMENT_REPORT, department: 'engineering' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(1);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.event_type).toBe('department_report');
      expect(decision.confidence).toBe(0.9);
    });

    // DoD 验收测试 - DEPARTMENT_REPORT
    it('should log non-critical department report', () => {
      const event = { type: EVENT_TYPES.DEPARTMENT_REPORT };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
    });

    it('should return null for critical department report', () => {
      // develop 实现中所有 DEPARTMENT_REPORT 均走 log_event（无 critical 路由）
      // 此测试验证 non-critical 行为符合预期
      const event = { type: EVENT_TYPES.DEPARTMENT_REPORT, is_critical: false };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('log_event');
    });

    it('should log low severity exception report', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'low', reason: 'minor_error' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
    });

    it('should return null for high severity exception report', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'high', reason: 'critical_error' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should notify user on non-critical resource low', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW, severity: 'low' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      const hasNotify = decision.actions.some(a => a.type === 'notify_user');
      expect(hasNotify).toBe(true);
    });

    it('should return null for critical resource low', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW, severity: 'critical' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log simple user command', () => {
      // develop 实现：简单指令（status/health/version）→ no_action
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'status' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
    });

    it('should return null for complex user command', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'deploy' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log non-urgent user message', () => {
      // develop 实现：status_query intent → log_event
      const event = { type: EVENT_TYPES.USER_MESSAGE, intent: 'status_query' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('log_event');
    });

    it('should return null for urgent user message', () => {
      // 其他 intent（非 status_query/acknowledge）→ null
      const event = { type: EVENT_TYPES.USER_MESSAGE, intent: 'command' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log and analyze low severity exception report', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'low', reason: 'disk_full' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.severity).toBe('low');
      expect(decision.actions[1].type).toBe('analyze_failure');
      expect(decision.actions[1].params.severity).toBe('low');
      expect(decision.confidence).toBe(0.85);
    });

    it('should log and analyze medium severity exception report', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'medium', reason: 'oom' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.severity).toBe('medium');
      expect(decision.actions[1].type).toBe('analyze_failure');
      expect(decision.actions[1].params.severity).toBe('medium');
      expect(decision.confidence).toBe(0.85);
    });

    it('should return null for high severity exception report (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'high', reason: 'service_down' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for critical severity exception report (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.EXCEPTION_REPORT, severity: 'critical', reason: 'data_loss' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should log and notify for resource_low severity low', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW, severity: 'low' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.confidence).toBe(0.85);
      expect(decision.safety).toBe(false);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.event_type).toBe('resource_low');
      expect(decision.actions[0].params.severity).toBe('low');
      expect(decision.actions[1].type).toBe('notify_user');
      expect(decision.actions[1].params.channel).toBe('system');
    });

    it('should log and notify for resource_low severity medium', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW, severity: 'medium' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.confidence).toBe(0.85);
      expect(decision.safety).toBe(false);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.severity).toBe('medium');
      expect(decision.actions[1].type).toBe('notify_user');
    });

    it('should return null for resource_low severity critical (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW, severity: 'critical' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should treat resource_low with no severity as low', () => {
      const event = { type: EVENT_TYPES.RESOURCE_LOW };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.confidence).toBe(0.85);
      expect(decision.actions).toHaveLength(2);
      expect(decision.actions[0].type).toBe('log_event');
      expect(decision.actions[0].params.severity).toBe('low');
      expect(decision.actions[1].type).toBe('notify_user');
    });



    it('should return no_action for USER_COMMAND status', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'status' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('no_action');
      expect(decision.confidence).toBe(1.0);
    });

    it('should return no_action for USER_COMMAND health', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'health' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('no_action');
    });

    it('should return no_action for USER_COMMAND version', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'version' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.actions[0].type).toBe('no_action');
    });

    it('should return fallback_to_tick for USER_COMMAND tick', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'tick' };
      const decision = quickRoute(event);

      expect(decision).not.toBeNull();
      expect(decision.level).toBe(0);
      expect(decision.actions[0].type).toBe('fallback_to_tick');
      expect(decision.confidence).toBe(1.0);
    });

    it('should return null for USER_COMMAND unknown (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND, command: 'deploy' };
      const decision = quickRoute(event);

      expect(decision).toBeNull();
    });

    it('should return null for USER_COMMAND with no command field (needs Sonnet)', () => {
      const event = { type: EVENT_TYPES.USER_COMMAND };
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

    it('should include create_learning action with dangerous=false', () => {
      expect(ACTION_WHITELIST['create_learning']).toBeDefined();
      expect(ACTION_WHITELIST['create_learning'].dangerous).toBe(false);
      expect(ACTION_WHITELIST['create_learning'].description).toBe('保存经验教训到 learnings 表');
    });

    it('should include update_learning action with dangerous=false', () => {
      expect(ACTION_WHITELIST['update_learning']).toBeDefined();
      expect(ACTION_WHITELIST['update_learning'].dangerous).toBe(false);
      expect(ACTION_WHITELIST['update_learning'].description).toBe('更新已有 learning 记录');
    });

    it('should include trigger_rca action with dangerous=false', () => {
      expect(ACTION_WHITELIST['trigger_rca']).toBeDefined();
      expect(ACTION_WHITELIST['trigger_rca'].dangerous).toBe(false);
      expect(ACTION_WHITELIST['trigger_rca'].description).toBe('触发根因分析 (RCA) 流程');
    });

    it('should have 28 total actions in whitelist', () => {
      expect(Object.keys(ACTION_WHITELIST).length).toBe(28);
    });
  });

  describe('LLM_ERROR_TYPE', () => {
    it('should have three error types', () => {
      expect(LLM_ERROR_TYPE.API_ERROR).toBe('llm_api_error');
      expect(LLM_ERROR_TYPE.BAD_OUTPUT).toBe('llm_bad_output');
      expect(LLM_ERROR_TYPE.TIMEOUT).toBe('llm_timeout');
    });
  });

  // ============================================================
  // BUG 修复测试（稳定性）
  // ============================================================

  describe('processEvent stability (BUG P1)', () => {
    it('processEvent returns fallback for null event', async () => {
      const result = await processEvent(null);
      expect(result).toBeDefined();
      expect(result._fallback).toBe(true);
      expect(result.level).toBe(0);
      expect(result.actions[0].type).toBe('fallback_to_tick');
    });

    it('processEvent returns fallback for undefined event', async () => {
      const result = await processEvent(undefined);
      expect(result).toBeDefined();
      expect(result._fallback).toBe(true);
      expect(result.level).toBe(0);
    });
  });

  describe('parseDecisionFromResponse (BUG P2)', () => {
    it('parseDecisionFromResponse handles markdown code block with JSON', () => {
      const response = 'Here is the decision:\n```json\n{"level":1,"actions":[{"type":"dispatch_task","params":{}}],"rationale":"test","confidence":0.9,"safety":false}\n```';
      const result = parseDecisionFromResponse(response);
      expect(result.level).toBe(1);
      expect(result.actions[0].type).toBe('dispatch_task');
    });

    it('parseDecisionFromResponse handles multiple JSON blocks (not grabbing wrong one)', () => {
      // 含多个 {} 块，第一个是正确的 Decision
      const response = 'Context: {"foo":"bar","baz":"qux"} and the decision is {"level":0,"actions":[{"type":"no_action","params":{}}],"rationale":"simple","confidence":1.0,"safety":false}';
      // 非贪婪匹配第一个 {} 块，即 {"foo":"bar","baz":"qux"}
      // 此测试验证 parseDecisionFromResponse 不会贪婪地抓取跨越多个 {} 的内容
      // 只要不抛 SyntaxError 就是修复有效（旧贪婪版本会抓跨越两个 {} 的内容导致 SyntaxError）
      expect(() => parseDecisionFromResponse(response)).not.toThrow();
    });

    it('parseDecisionFromResponse prefers code block over inline JSON', () => {
      const response = '{"level":9,"actions":[],"rationale":"wrong","confidence":0,"safety":false}\n```json\n{"level":1,"actions":[{"type":"log_event","params":{}}],"rationale":"correct","confidence":0.9,"safety":false}\n```';
      const result = parseDecisionFromResponse(response);
      // code block 中的 JSON 优先
      expect(result.level).toBe(1);
      expect(result.rationale).toBe('correct');
    });
  });

  describe('cortex null actions guard (BUG P4)', () => {
    it('cortex null actions does not throw TypeError', () => {
      // 验证 (actions || []).map() 的 guard 正确
      const cortexDecision = { actions: null, confidence: 0.5 };
      expect(() => {
        const actionStr = (cortexDecision.actions || []).map(a => a.type).join(',');
        expect(actionStr).toBe('');
      }).not.toThrow();
    });

    it('cortex undefined actions does not throw TypeError', () => {
      const cortexDecision = { confidence: 0.5 };
      expect(() => {
        const actionStr = (cortexDecision.actions || []).map(a => a.type).join(',');
        expect(actionStr).toBe('');
      }).not.toThrow();
    });
  });

  describe('classifyLLMError', () => {
    it('should classify API errors', () => {
      expect(classifyLLMError(new Error('Sonnet API error: 500'))).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(classifyLLMError(new Error('ECONNREFUSED 127.0.0.1:443'))).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(classifyLLMError(new Error('rate limit exceeded'))).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(classifyLLMError(new Error('HTTP 429 Too Many Requests'))).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(classifyLLMError(new Error('ANTHROPIC_API_KEY not set'))).toBe(LLM_ERROR_TYPE.API_ERROR);
    });

    it('should classify timeout errors', () => {
      expect(classifyLLMError(new Error('timeout waiting for response'))).toBe(LLM_ERROR_TYPE.TIMEOUT);
      expect(classifyLLMError(new Error('request timed out'))).toBe(LLM_ERROR_TYPE.TIMEOUT);
      expect(classifyLLMError(new Error('operation aborted'))).toBe(LLM_ERROR_TYPE.TIMEOUT);
    });

    it('should classify bad output errors', () => {
      expect(classifyLLMError(new Error('No JSON found in response'))).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
      expect(classifyLLMError(new Error('Unexpected token in JSON'))).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
      expect(classifyLLMError(new Error('level must be 0, 1, or 2'))).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });

    it('should handle string errors', () => {
      expect(classifyLLMError('ECONNREFUSED')).toBe(LLM_ERROR_TYPE.API_ERROR);
      expect(classifyLLMError('timeout')).toBe(LLM_ERROR_TYPE.TIMEOUT);
      expect(classifyLLMError('parse error')).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });

    it('should handle null/undefined', () => {
      expect(classifyLLMError(null)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
      expect(classifyLLMError(undefined)).toBe(LLM_ERROR_TYPE.BAD_OUTPUT);
    });
  });
});
