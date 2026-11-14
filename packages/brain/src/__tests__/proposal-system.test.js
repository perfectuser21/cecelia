/**
 * 提案系统核心测试
 * 覆盖：提案类型扩展、签名去重、过期状态、原有流程不受影响
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockBroadcast } = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockBroadcast: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../websocket.js', () => ({
  broadcast: mockBroadcast,
  WS_EVENTS: {
    PROPOSAL_CREATED: 'proposal:created',
    PROPOSAL_COMMENT: 'proposal:comment',
    PROPOSAL_RESOLVED: 'proposal:resolved',
  },
}));
vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ success: true, task: { id: 'test-task-id' } }),
  updateTask: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../cortex.js', () => ({
  CORTEX_ACTION_WHITELIST: {
    adjust_strategy: { dangerous: true, description: 'test' },
    record_learning: { dangerous: false, description: 'test' },
    create_rca_report: { dangerous: false, description: 'test' },
  },
}));

import { isActionDangerous, PROPOSAL_DEFAULTS, shouldThrottleProposal, expireStaleProposals } from '../decision-executor.js';

describe('提案系统核心', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('提案类型识别', () => {
    it('原有 dangerous action 仍被识别为危险', () => {
      expect(isActionDangerous({ type: 'quarantine_task' })).toBe(true);
      expect(isActionDangerous({ type: 'request_human_review' })).toBe(true);
    });

    it('人工确认的异常方案和优先级调整需要审批', () => {
      const proposalTypes = [
        'propose_priority_change',
        'propose_anomaly_action',
        'heartbeat_finding',
      ];
      for (const type of proposalTypes) {
        expect(isActionDangerous({ type })).toBe(true);
      }
    });

    it('非危险 action 不受影响', () => {
      expect(isActionDangerous({ type: 'dispatch_task' })).toBe(false);
      expect(isActionDangerous({ type: 'no_action' })).toBe(false);
      expect(isActionDangerous({ type: 'log_event' })).toBe(false);
    });

    it('现役异常提案使用紧急审批与明确期限', () => {
      expect(PROPOSAL_DEFAULTS['propose_priority_change'].category).toBe('proposal');
      expect(PROPOSAL_DEFAULTS['propose_anomaly_action'].priority).toBe('urgent');
      expect(PROPOSAL_DEFAULTS['heartbeat_finding'].priority).toBe('urgent');
      expect(PROPOSAL_DEFAULTS['propose_priority_change'].expiresHours).toBe(72);
      expect(PROPOSAL_DEFAULTS['quarantine_task'].category).toBe('approval');
    });
  });

  describe('签名去重', () => {
    it('无 signature 不节流', async () => {
      const result = await shouldThrottleProposal(mockPool, null);
      expect(result).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('有重复 signature → 节流', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing' }] });
      const result = await shouldThrottleProposal(mockPool, 'kr:abc:propose_anomaly_action');
      expect(result).toBe(true);
    });

    it('无重复 signature → 不节流', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const result = await shouldThrottleProposal(mockPool, 'kr:abc:propose_anomaly_action');
      expect(result).toBe(false);
    });
  });

  describe('过期提案清理', () => {
    it('将过期 pending_approval 标记为 expired', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 3, rows: [{ id: '1' }, { id: '2' }, { id: '3' }] });
      const count = await expireStaleProposals();
      expect(count).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'expired'")
      );
    });

    it('无过期提案返回 0', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const count = await expireStaleProposals();
      expect(count).toBe(0);
    });
  });
});
