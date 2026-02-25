/**
 * 提案去重/节流测试
 * 覆盖：签名去重、24h 时间窗口、enqueueDangerousAction 集成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: { query: vi.fn(), release: vi.fn() },
  mockPool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
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

import { shouldThrottleProposal, enqueueDangerousAction } from '../decision-executor.js';

describe('提案去重/节流', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldThrottleProposal', () => {
    it('signature 为 null 时不节流', async () => {
      const result = await shouldThrottleProposal(mockPool, null);
      expect(result).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('signature 为 undefined 时不节流', async () => {
      const result = await shouldThrottleProposal(mockPool, undefined);
      expect(result).toBe(false);
    });

    it('signature 为空字符串时不节流', async () => {
      const result = await shouldThrottleProposal(mockPool, '');
      expect(result).toBe(false);
    });

    it('有重复 pending_approval 记录 → 节流', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing-1' }] });
      const result = await shouldThrottleProposal(mockPool, 'kr:abc:propose_decomposition');
      expect(result).toBe(true);
    });

    it('无重复记录 → 不节流', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const result = await shouldThrottleProposal(mockPool, 'kr:abc:propose_decomposition');
      expect(result).toBe(false);
    });

    it('查询使用正确的参数（signature + pending_approval + 24h）', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      await shouldThrottleProposal(mockPool, 'test-sig-123');

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('signature = $1');
      expect(sql).toContain("status = 'pending_approval'");
      expect(sql).toContain("24 hours");
      expect(mockPool.query.mock.calls[0][1]).toEqual(['test-sig-123']);
    });
  });

  describe('enqueueDangerousAction 签名去重集成', () => {
    it('无 signature 的 action 直接入队', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'pa-1', created_at: '2026-02-22T10:00:00Z' }],
      });

      const result = await enqueueDangerousAction(
        { type: 'quarantine_task', params: { task_id: 't-1' } },
        { decision_id: 'd-1' },
        mockClient
      );

      expect(result.success).toBe(true);
      expect(result.throttled).toBeUndefined();
      expect(result.pending_action_id).toBe('pa-1');
    });

    it('有 signature 且重复 → throttled=true', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing' }] });

      const result = await enqueueDangerousAction(
        { type: 'propose_decomposition', params: {}, signature: 'kr:1:decomp' },
        { source: 'system' },
        mockClient
      );

      expect(result.success).toBe(true);
      expect(result.throttled).toBe(true);
      expect(result.signature).toBe('kr:1:decomp');
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it('有 signature 但不重复 → 正常入队', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'pa-2', created_at: '2026-02-22T10:00:00Z' }],
      });

      const result = await enqueueDangerousAction(
        { type: 'propose_decomposition', params: { kr_id: 'kr-2' }, signature: 'kr:2:decomp' },
        { source: 'cortex' },
        mockClient
      );

      expect(result.success).toBe(true);
      expect(result.throttled).toBeUndefined();
      expect(result.pending_action_id).toBe('pa-2');
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });
});
