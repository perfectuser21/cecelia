import { describe, it, expect, vi } from 'vitest';
import { pushCaptureAtom } from '../capture-inbox.js';

describe('pushCaptureAtom', () => {
  it('pushCaptureAtom 先写 captures 再写 capture_atoms（两次 query）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'atom-1' }] }) };
    const id = await pushCaptureAtom(pool, {
      content: 'x', targetType: 'handoff', targetSubtype: 'PASS',
      routedToTable: 'tasks', routedToId: '11111111-1111-1111-1111-111111111111',
    });
    expect(id).toBe('atom-1');
    // calls[0] = INSERT INTO captures, calls[1] = INSERT INTO capture_atoms
    expect(pool.query.mock.calls).toHaveLength(2);
    const [sql1] = pool.query.mock.calls[0];
    expect(sql1).toMatch(/INSERT INTO captures/);
    const [sql2, params2] = pool.query.mock.calls[1];
    expect(sql2).toMatch(/INSERT INTO capture_atoms/);
    // capture_atoms params: [captureId, content, target_type, target_subtype, routed_to_table, routed_to_id, lane]
    // （08-04 签名修复：routedToTable/routedToId/lane 恢复落库，不再静默丢弃）
    expect(params2).toEqual(['atom-1', 'x', 'handoff', 'PASS', 'tasks', '11111111-1111-1111-1111-111111111111', null]);
  });

  it('content 超 2000 字截断（MAX_CONTENT_LEN=2000）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'a' }] }) };
    await pushCaptureAtom(pool, { content: 'x'.repeat(3000), targetType: 'learning' });
    // captures INSERT 是 calls[0]，content 是 params[0]
    expect(pool.query.mock.calls[0][1][0].length).toBe(2000);
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
