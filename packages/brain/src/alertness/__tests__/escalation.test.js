import { describe, it, expect, vi } from 'vitest';

// Mock pool before importing escalation
const mockQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock('../../db.js', () => ({
  default: {
    connect: vi.fn(() => Promise.resolve({ query: mockQuery, release: mockRelease })),
  },
}));
vi.mock('../../event-bus.js', () => ({ emit: vi.fn() }));

describe('CANCEL_EXEMPT_TYPES', () => {
  it('包含 content_publish（下划线），不能是 content-publish（连字符）', async () => {
    const { CANCEL_EXEMPT_TYPES } = await import('../escalation.js');
    expect(CANCEL_EXEMPT_TYPES).toContain('content_publish');
    expect(CANCEL_EXEMPT_TYPES).not.toContain('content-publish');
  });

  it('content_publish 任务在 cancel_pending 动作执行时传入豁免参数', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const { executeResponse, CANCEL_EXEMPT_TYPES } = await import('../escalation.js');
    await executeResponse({ actions: [{ type: 'cancel_pending', params: { keepCritical: false } }] });

    // pool.query 第一次调用是 cancelPendingTasks 里的 UPDATE，第二次是 updateEscalationActions
    const updateCall = mockQuery.mock.calls[0];
    const exemptParam = updateCall[1][0]; // query(sql, [CANCEL_EXEMPT_TYPES])
    expect(exemptParam).toEqual(CANCEL_EXEMPT_TYPES);
    expect(exemptParam).toContain('content_publish');
    expect(exemptParam).not.toContain('content-publish');
  });
});
