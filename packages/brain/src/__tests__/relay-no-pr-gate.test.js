import { describe, expect, it, vi } from 'vitest';
import { relayOnComplete } from '../lib/relay-baton.js';

const task = (task_type, status) => ({
  id: '48fb7224-3f71-4967-a3b3-01ef00198e6f', title: '测试任务', task_type, status,
  result: { handoff: { schema_version: '1.0', next_steps: [] } },
});

describe('无 PR 的终态接棒门禁', () => {
  it('dev 的 completed_no_pr 不合成交接、不产生接棒', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [task('dev', 'completed_no_pr')] }) };
    expect(await relayOnComplete(pool, task('dev', 'completed_no_pr').id)).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('非 dev 的 completed_no_pr 仍可接棒', async () => {
    const dataTask = task('data', 'completed_no_pr');
    dataTask.result.handoff.next_steps = [{ kind: 'decision', title: '下一项决策' }];
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [dataTask] })
      .mockResolvedValueOnce({ rows: [{ id: 'decision-1' }] }) };
    expect(await relayOnComplete(pool, task('data', 'completed_no_pr').id)).toMatchObject({
      synthesized: false, tasks: [], decisions: [{ id: 'decision-1', topic: '下一项决策', reused: true }],
    });
  });

  it('dev 的 completed 仍可接棒', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [task('dev', 'completed')] }) };
    expect(await relayOnComplete(pool, task('dev', 'completed').id)).toMatchObject({
      synthesized: false, tasks: [], decisions: [],
    });
  });
});
