/**
 * 提案 WebSocket 推送测试
 * 覆盖：proposal:created / proposal:comment / proposal:resolved 事件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockPool, mockBroadcast } = vi.hoisted(() => ({
  mockClient: { query: vi.fn(), release: vi.fn() },
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

import { enqueueDangerousAction, addProposalComment, selectProposalOption } from '../decision-executor.js';

describe('提案 WebSocket 推送', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('proposal:created', () => {
    it('enqueueDangerousAction 成功后推送 proposal:created', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'pa-new-1', created_at: '2026-02-22T10:00:00Z' }],
      });

      await enqueueDangerousAction(
        { type: 'propose_decomposition', params: { kr_id: 'kr-1' } },
        { source: 'cortex', decision_id: 'd-1' },
        mockClient
      );

      expect(mockBroadcast).toHaveBeenCalledWith('proposal:created', expect.objectContaining({
        id: 'pa-new-1',
        action_type: 'propose_decomposition',
        category: 'proposal',
        priority: 'normal',
        source: 'cortex',
      }));
    });

    it('签名去重时不推送 proposal:created', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing' }] });

      const result = await enqueueDangerousAction(
        { type: 'propose_decomposition', params: {}, signature: 'kr:1:propose_decomposition' },
        { source: 'system' },
        mockClient
      );

      expect(result.throttled).toBe(true);
      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('urgent 提案的 priority 正确传递', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'pa-urgent', created_at: '2026-02-22T10:00:00Z' }],
      });

      await enqueueDangerousAction(
        { type: 'heartbeat_finding', params: { anomaly: 'high_failure_rate' } },
        { source: 'heartbeat' },
        mockClient
      );

      expect(mockBroadcast).toHaveBeenCalledWith('proposal:created', expect.objectContaining({
        priority: 'urgent',
        action_type: 'heartbeat_finding',
      }));
    });
  });

  describe('proposal:comment', () => {
    it('addProposalComment 成功后推送 proposal:comment', async () => {
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ status: 'pending_approval', expires_at: new Date(Date.now() + 86400000).toISOString() }],
      });
      mockPool.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'pa-1', comments: [{ role: 'user', text: 'test' }], action_type: 'propose_decomposition', params: {} }],
      });

      await addProposalComment('pa-1', 'test', 'user');

      expect(mockBroadcast).toHaveBeenCalledWith('proposal:comment', expect.objectContaining({
        id: 'pa-1',
        comment: expect.objectContaining({ role: 'user', text: 'test' }),
      }));
    });

    it('评论失败（404）时不推送', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await addProposalComment('nonexistent', 'hello');

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  describe('proposal:resolved', () => {
    it('selectProposalOption 成功后推送 proposal:resolved', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'pa-1',
          status: 'pending_approval',
          options: [{ id: 'opt-a', label: 'Option A' }],
        }],
      }); // FOR UPDATE
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      await selectProposalOption('pa-1', 'opt-a', 'reviewer1');

      expect(mockBroadcast).toHaveBeenCalledWith('proposal:resolved', {
        id: 'pa-1',
        option_id: 'opt-a',
      });
    });

    it('选项无效时不推送 proposal:resolved', async () => {
      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 'pa-1',
          status: 'pending_approval',
          options: [{ id: 'opt-a', label: 'Option A' }],
        }],
      }); // FOR UPDATE
      mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

      await selectProposalOption('pa-1', 'invalid');

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });
});
