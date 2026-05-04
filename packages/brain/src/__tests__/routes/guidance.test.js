import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('guidance.js', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('getGuidance: 有效 key 返回 value', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { executor: 'bridge' } }],
    });
    const { getGuidance } = await import('../../guidance.js');
    const result = await getGuidance('routing:task-123');
    expect(result).toEqual({ executor: 'bridge' });
  });

  it('getGuidance: key 不存在返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { getGuidance } = await import('../../guidance.js');
    const result = await getGuidance('routing:nonexistent');
    expect(result).toBeNull();
  });

  it('setGuidance: 写入正确参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { setGuidance } = await import('../../guidance.js');
    await setGuidance('strategy:global', { priority: 'content' }, 'cortex', 86400000);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO brain_guidance'),
      expect.arrayContaining(['strategy:global', expect.any(String), 'cortex'])
    );
  });

  it('setGuidance: ttlMs=null 时 expires_at 写 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { setGuidance } = await import('../../guidance.js');
    await setGuidance('reflection:latest', { ok: true }, 'reflection', null);
    const args = mockQuery.mock.calls[0][1];
    expect(args[3]).toBeNull();
  });

  it('clearExpired: 删除过期条目', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });
    const { clearExpired } = await import('../../guidance.js');
    const count = await clearExpired();
    expect(count).toBe(3);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM brain_guidance'),
      expect.any(Array)
    );
  });
});
