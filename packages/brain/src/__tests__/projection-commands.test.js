import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProjectionCommands } from '../projection/commands.js';

describe('projection command processor', () => {
  let query;

  beforeEach(() => {
    query = vi.fn();
  });

  it('start_requested 只提升 queued 优先级并留痕，不写 in_progress', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'cmd-1', command_type: 'start_requested', entity_id: 'task-1', payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'queued' }] })
      .mockResolvedValue({ rows: [] });

    const result = await applyProjectionCommands({ query }, { limit: 10 });

    expect(result.applied).toBe(1);
    const sql = query.mock.calls.map(call => String(call[0])).join('\n');
    expect(sql).toContain('start_requested_at');
    expect(sql).not.toMatch(/status\s*=\s*'in_progress'/);
  });

  it('active task 的 cancel_requested 被拒绝，不终止真实 attempt', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'cmd-2', command_type: 'cancel_requested', entity_id: 'task-2', payload: {} }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', status: 'in_progress' }] })
      .mockResolvedValue({ rows: [] });

    const result = await applyProjectionCommands({ query }, { limit: 10 });

    expect(result.rejected).toBe(1);
    expect(query.mock.calls.some(call => /UPDATE tasks SET status/.test(String(call[0])))).toBe(false);
  });

  it('领取时回收超时 processing command，避免进程重启后永久卡住', async () => {
    query.mockResolvedValue({ rows: [] });

    await applyProjectionCommands({ query }, { limit: 10 });

    const claimSql = String(query.mock.calls[0][0]);
    expect(claimSql).toContain("status='processing'");
    expect(claimSql).toContain("leased_at < NOW()-INTERVAL '10 minutes'");
  });

  it('瞬时失败按退避重试，五次后进入 dead，不永久遗失命令', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'cmd-fail', command_type: 'start_requested', entity_id: 'task-1', attempts: 0 }] })
      .mockRejectedValueOnce(new Error('db connection reset'))
      .mockResolvedValue({ rows: [] });

    const result = await applyProjectionCommands({ query }, { limit: 10 });

    expect(result.failed).toBe(1);
    const failureSql = query.mock.calls.map(([sql]) => String(sql)).find(sql => sql.includes('attempts+1'));
    expect(failureSql).toContain("THEN 'dead' ELSE 'failed'");
  });
});
