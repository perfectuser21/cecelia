import { describe, it, expect, vi } from 'vitest';
import { pushCaptureAtom } from '../capture-inbox.js';

describe('pushCaptureAtom', () => {
  it('插入一条 capture_atoms（capture_id NULL，status 走默认）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'atom-1' }] }) };
    const id = await pushCaptureAtom(pool, {
      content: 'x', targetType: 'handoff', targetSubtype: 'PASS',
      routedToTable: 'tasks', routedToId: '11111111-1111-1111-1111-111111111111',
    });
    expect(id).toBe('atom-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO capture_atoms/);
    expect(params).toEqual(['x', 'handoff', 'PASS', 'tasks', '11111111-1111-1111-1111-111111111111']);
  });

  it('content 超 1000 字截断', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'a' }] }) };
    await pushCaptureAtom(pool, { content: 'x'.repeat(2000), targetType: 'learning' });
    expect(pool.query.mock.calls[0][1][0].length).toBe(1000);
  });

  it('pool 抛错时吞掉不 throw，返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(pushCaptureAtom(pool, { content: 'x', targetType: 'issue' })).resolves.toBeNull();
  });

  it('缺 content 或 targetType 直接返回 null 不查库', async () => {
    const pool = { query: vi.fn() };
    await expect(pushCaptureAtom(pool, { targetType: 'issue' })).resolves.toBeNull();
    await expect(pushCaptureAtom(pool, { content: 'x' })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
