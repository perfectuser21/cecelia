import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { raise } from '../../alerting.js';
import { claimDedupeKey, releaseDedupeKey } from '../dedupe.js';

describe('dedupe claimDedupeKey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('抢占成功（rowCount=1）→ claimed:true', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });
    const r = await claimDedupeKey('notify', 'k1', 300);
    expect(r.claimed).toBe(true);
    expect(r.degraded).toBeUndefined();
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/ON CONFLICT \(kind, dedupe_key\)/);
    expect(sql).toMatch(/expires_at < NOW\(\)/); // 过期即重占
    expect(sql).not.toMatch(/\$\{/); // 无模板注入
  });

  it('已被占（rowCount=0）→ claimed:false', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const r = await claimDedupeKey('spawn', 'task-123', 120);
    expect(r.claimed).toBe(false);
  });

  it('调用方可把 claim 绑定到现有事务连接', async () => {
    const transactionDb = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const result = await claimDedupeKey('create_task', 'tx-key', 120, transactionDb);
    expect(result.claimed).toBe(true);
    expect(transactionDb.query).toHaveBeenCalledOnce();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('fail-open：DB 错误 → claimed:true + degraded:true + P2 降级告警', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const r = await claimDedupeKey('create_task', 'k2', 300);
    expect(r.claimed).toBe(true);
    expect(r.degraded).toBe(true);
    expect(raise).toHaveBeenCalledWith('P2', 'dedupe_degraded', expect.stringContaining('create_task'));
  });

  it('key 超 255 字符 → 抛错提示调用方自行 hash', async () => {
    await expect(claimDedupeKey('notify', 'x'.repeat(256), 60)).rejects.toThrow(/255/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('releaseDedupeKey 删除该 key（claim 后副作用失败时释放）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await releaseDedupeKey('create_task', 'k3');
    expect(mockQuery.mock.calls[0][0]).toMatch(/DELETE FROM side_effect_dedupe/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['create_task', 'k3']);
  });

  it('release 使用与 claim 相同的事务连接', async () => {
    const transactionDb = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    await releaseDedupeKey('create_task', 'tx-release', transactionDb);
    expect(transactionDb.query).toHaveBeenCalledOnce();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('releaseDedupeKey DB 错误全吞（不抛）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    await expect(releaseDedupeKey('notify', 'k4')).resolves.toBeUndefined();
  });
});
