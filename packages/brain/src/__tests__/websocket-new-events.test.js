/**
 * WebSocket 新事件类型测试
 *
 * 验证 Phase 1 新增的 4 个 WebSocket 事件：
 * - alertness:changed
 * - desire:created
 * - desire:updated
 * - tick:executed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock websocket broadcast
vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
  WS_EVENTS: {
    TASK_CREATED: 'task:created',
    TASK_STARTED: 'task:started',
    TASK_PROGRESS: 'task:progress',
    TASK_COMPLETED: 'task:completed',
    TASK_FAILED: 'task:failed',
    EXECUTOR_STATUS: 'executor:status',
    PING: 'ping',
    PONG: 'pong',
    PROPOSAL_CREATED: 'proposal:created',
    PROPOSAL_COMMENT: 'proposal:comment',
    PROPOSAL_RESOLVED: 'proposal:resolved',
    PROFILE_CHANGED: 'profile:changed',
    ALERTNESS_CHANGED: 'alertness:changed',
    DESIRE_CREATED: 'desire:created',
    DESIRE_UPDATED: 'desire:updated',
    TICK_EXECUTED: 'tick:executed',
    COGNITIVE_STATE: 'cognitive:state',
  }
}));

import { broadcast, WS_EVENTS } from '../websocket.js';
import {
  publishAlertnessChanged,
  publishDesireCreated,
  publishDesireUpdated,
  publishTickExecuted,
  publishCognitiveState
} from '../events/taskEvents.js';

describe('WebSocket 新事件类型', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WS_EVENTS 常量', () => {
    it('包含 alertness:changed 事件', () => {
      expect(WS_EVENTS.ALERTNESS_CHANGED).toBe('alertness:changed');
    });

    it('包含 desire:created 事件', () => {
      expect(WS_EVENTS.DESIRE_CREATED).toBe('desire:created');
    });

    it('包含 desire:updated 事件', () => {
      expect(WS_EVENTS.DESIRE_UPDATED).toBe('desire:updated');
    });

    it('包含 tick:executed 事件', () => {
      expect(WS_EVENTS.TICK_EXECUTED).toBe('tick:executed');
    });

    it('包含 cognitive:state 事件', () => {
      expect(WS_EVENTS.COGNITIVE_STATE).toBe('cognitive:state');
    });

    it('总共有 17 个事件类型', () => {
      expect(Object.keys(WS_EVENTS).length).toBe(17);
    });
  });

  describe('publishAlertnessChanged', () => {
    it('广播 alertness:changed 事件', () => {
      publishAlertnessChanged({
        level: 3,
        previous: 1,
        label: 'ALERT',
        reason: 'High error rate'
      });

      expect(broadcast).toHaveBeenCalledWith(
        'alertness:changed',
        expect.objectContaining({
          level: 3,
          previous: 1,
          label: 'ALERT',
          reason: 'High error rate',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('publishDesireCreated', () => {
    it('广播 desire:created 事件', () => {
      publishDesireCreated({
        id: 'desire-123',
        type: 'warn',
        urgency: 8,
        content: 'CI 连续失败'
      });

      expect(broadcast).toHaveBeenCalledWith(
        'desire:created',
        expect.objectContaining({
          id: 'desire-123',
          type: 'warn',
          urgency: 8,
          summary: 'CI 连续失败',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('publishDesireUpdated', () => {
    it('广播 desire:updated 事件', () => {
      publishDesireUpdated({
        id: 'desire-456',
        status: 'acknowledged',
        previous_status: 'pending'
      });

      expect(broadcast).toHaveBeenCalledWith(
        'desire:updated',
        expect.objectContaining({
          id: 'desire-456',
          status: 'acknowledged',
          previous_status: 'pending',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('publishTickExecuted', () => {
    it('广播 tick:executed 事件', () => {
      publishTickExecuted({
        tick_number: 42,
        duration_ms: 1234,
        actions_taken: 5,
        next_tick_at: '2026-02-25T10:05:00.000Z'
      });

      expect(broadcast).toHaveBeenCalledWith(
        'tick:executed',
        expect.objectContaining({
          tick_number: 42,
          duration_ms: 1234,
          actions_taken: 5,
          next_tick_at: '2026-02-25T10:05:00.000Z',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('publishCognitiveState', () => {
    it('广播 cognitive:state 事件', () => {
      publishCognitiveState({
        phase: 'rumination',
        detail: '反刍消化知识…',
        progress: 30,
        meta: { undigested: 888 }
      });

      expect(broadcast).toHaveBeenCalledWith(
        'cognitive:state',
        expect.objectContaining({
          phase: 'rumination',
          detail: '反刍消化知识…',
          progress: 30,
          meta: { undigested: 888 },
          timestamp: expect.any(String)
        })
      );
    });

    it('缺省字段发送 undefined', () => {
      publishCognitiveState({
        phase: 'idle',
        detail: '空闲中',
      });

      expect(broadcast).toHaveBeenCalledWith(
        'cognitive:state',
        expect.objectContaining({
          phase: 'idle',
          detail: '空闲中',
          timestamp: expect.any(String)
        })
      );
    });
  });
});
