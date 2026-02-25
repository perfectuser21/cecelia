/**
 * 提案评论 API 测试
 * 覆盖：comment 追加、过期检查、状态检查
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

import { addProposalComment, MAX_COMMENT_HISTORY } from '../decision-executor.js';

describe('提案评论 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('追加用户评论到 pending_approval 提案', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ status: 'pending_approval', expires_at: new Date(Date.now() + 86400000).toISOString() }],
    });
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'action-1', comments: [{ role: 'user', text: 'hello' }], action_type: 'propose_decomposition', params: {} }],
    });

    const result = await addProposalComment('action-1', 'hello', 'user');
    expect(result.success).toBe(true);
    expect(result.comment.role).toBe('user');
    expect(result.comment.text).toBe('hello');
    expect(mockBroadcast).toHaveBeenCalledWith('proposal:comment', expect.objectContaining({ id: 'action-1' }));
  });

  it('提案不存在返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await addProposalComment('nonexistent', 'hello');
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  it('已处理的提案返回 400', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ status: 'approved', expires_at: null }],
    });
    const result = await addProposalComment('approved-1', 'hello');
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it('过期的提案返回 410', async () => {
    mockPool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ status: 'pending_approval', expires_at: new Date(Date.now() - 1000).toISOString() }],
    });
    const result = await addProposalComment('expired-1', 'hello');
    expect(result.success).toBe(false);
    expect(result.status).toBe(410);
  });

  it('MAX_COMMENT_HISTORY 限制为 10', () => {
    expect(MAX_COMMENT_HISTORY).toBe(10);
  });
});
