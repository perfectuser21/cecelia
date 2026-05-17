/**
 * 提案选项选择 API 测试
 * 覆盖：事务内执行、选项校验、executeDecision 集成
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

import { selectProposalOption } from '../decision-executor.js';

describe('提案选项选择 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('选择选项并执行（无 action）→ approved', async () => {
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        id: 'pa-1',
        status: 'pending_approval',
        options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }],
      }],
    }); // FOR UPDATE
    mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    mockClient.query.mockResolvedValueOnce({}); // COMMIT

    const result = await selectProposalOption('pa-1', 'a', 'user1');
    expect(result.success).toBe(true);
    expect(result.execution_result.selected_option).toBe('a');
    expect(mockBroadcast).toHaveBeenCalledWith('proposal:resolved', { id: 'pa-1', option_id: 'a' });
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('提案不存在或已处理 → 404', async () => {
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // FOR UPDATE
    mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

    const result = await selectProposalOption('nonexistent', 'a');
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  it('无效选项 → 400', async () => {
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        id: 'pa-1',
        status: 'pending_approval',
        options: [{ id: 'a', label: 'Option A' }],
      }],
    }); // FOR UPDATE
    mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

    const result = await selectProposalOption('pa-1', 'invalid');
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it('事务内 DB 错误 → rollback + 500', async () => {
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockRejectedValueOnce(new Error('DB connection lost')); // FOR UPDATE
    mockClient.query.mockResolvedValueOnce({}); // ROLLBACK

    const result = await selectProposalOption('pa-1', 'a');
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
