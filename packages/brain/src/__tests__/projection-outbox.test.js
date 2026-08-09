import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runProjectionOutbox } from '../projection/outbox.js';

describe('projection outbox worker', () => {
  let query;

  beforeEach(() => {
    query = vi.fn();
  });

  it('成功投影后把 outbox 标成 done', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'out-1', target: 'notion', entity_type: 'tasks', entity_id: 'task-1', attempts: 0 }] })
      .mockResolvedValue({ rows: [] });
    const adapter = vi.fn().mockResolvedValue({ externalId: 'page-1' });

    const result = await runProjectionOutbox({ query }, { adapter, limit: 10 });

    expect(result).toEqual({ processed: 1, done: 1, failed: 0, deferred: 0 });
    expect(adapter).toHaveBeenCalledOnce();
    expect(query.mock.calls.some(call => String(call[0]).includes("status='done'"))).toBe(true);
  });

  it('目标未配置时延后，不把消息吞成 done', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'out-2', target: 'notion', entity_type: 'projects', entity_id: 'project-1', attempts: 0 }] })
      .mockResolvedValue({ rows: [] });
    const adapter = vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' });

    const result = await runProjectionOutbox({ query }, { adapter, limit: 10 });

    expect(result.deferred).toBe(1);
    expect(query.mock.calls.some(call => String(call[0]).includes("status='pending'"))).toBe(true);
  });

  it('领取时回收超时 processing lease，并确保 project 先于 task 投影', async () => {
    query.mockResolvedValue({ rows: [] });

    await runProjectionOutbox({ query }, { adapter: vi.fn(), limit: 10 });

    const claimSql = String(query.mock.calls[0][0]);
    expect(claimSql).toContain("status='processing'");
    expect(claimSql).toContain("leased_at < NOW()-INTERVAL '10 minutes'");
    expect(claimSql).toContain("CASE WHEN entity_type='projects' THEN 0 ELSE 1 END");
  });

  it('本地实体已经不存在时终结旧 outbox，不无限延期', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'out-gone', target: 'notion', entity_type: 'tasks', entity_id: 'gone', attempts: 0 }] })
      .mockResolvedValue({ rows: [] });
    const adapter = vi.fn().mockResolvedValue({ skipped: true, reason: 'entity_not_found' });

    const result = await runProjectionOutbox({ query }, { adapter, limit: 10 });

    expect(result.done).toBe(1);
    expect(result.deferred).toBe(0);
  });
});
