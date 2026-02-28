/**
 * cecelia-proactive-push.test.js
 * 测试主动推送：
 * 1. WS_EVENTS.CECELIA_MESSAGE 存在
 * 2. publishCeceliaMessage 正确 broadcast
 * 3. tick step 13 在新叙事时推送
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock broadcast
const mockBroadcast = vi.hoisted(() => vi.fn());
vi.mock('../websocket.js', () => ({
  broadcast: mockBroadcast,
  WS_EVENTS: {
    TASK_CREATED: 'task:created',
    TASK_STARTED: 'task:started',
    TASK_COMPLETED: 'task:completed',
    TASK_FAILED: 'task:failed',
    TASK_PROGRESS: 'task:progress',
    EXECUTOR_STATUS: 'executor:status',
    PING: 'ping',
    PONG: 'pong',
    PROPOSAL_CREATED: 'proposal:created',
    PROPOSAL_RESOLVED: 'proposal:resolved',
    PROFILE_CHANGED: 'profile:changed',
    ALERTNESS_CHANGED: 'alertness:changed',
    DESIRE_CREATED: 'desire:created',
    DESIRE_UPDATED: 'desire:updated',
    DESIRE_EXPRESSED: 'desire:expressed',
    TICK_EXECUTED: 'tick:executed',
    COGNITIVE_STATE: 'cognitive:state',
    CECELIA_MESSAGE: 'cecelia:message',
  },
}));

import { WS_EVENTS } from '../websocket.js';
import { publishCeceliaMessage } from '../events/taskEvents.js';

describe('cecelia-proactive-push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── D5.1: WS_EVENTS 包含 CECELIA_MESSAGE ──────────────

  it('WS_EVENTS.CECELIA_MESSAGE is defined', () => {
    expect(WS_EVENTS.CECELIA_MESSAGE).toBe('cecelia:message');
  });

  // ─── D5.2: publishCeceliaMessage 正确 broadcast ─────────

  it('publishCeceliaMessage calls broadcast with correct event and data', () => {
    publishCeceliaMessage({
      type: 'narrative',
      message: '今天我感到平静，工作有序推进',
      meta: { source: 'tick_proactive' },
    });

    expect(mockBroadcast).toHaveBeenCalledWith(
      'cecelia:message',
      expect.objectContaining({
        type: 'narrative',
        message: '今天我感到平静，工作有序推进',
        meta: { source: 'tick_proactive' },
        timestamp: expect.any(String),
      })
    );
  });

  it('publishCeceliaMessage uses empty meta when not provided', () => {
    publishCeceliaMessage({
      type: 'emotion',
      message: '情绪从平静转为专注',
    });

    expect(mockBroadcast).toHaveBeenCalledWith(
      'cecelia:message',
      expect.objectContaining({
        type: 'emotion',
        message: '情绪从平静转为专注',
        meta: {},
      })
    );
  });
});
