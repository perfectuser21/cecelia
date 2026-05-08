import { describe, it, expect, vi } from 'vitest';
import {
  assertBrainImageInSync,
  registerAndDispatchAcceptance,
  waitFor14GraphNodeEvents,
} from '../../../../scripts/acceptance/w8-v4/lib.mjs';

const FOURTEEN_NODES = [
  'prep', 'planner', 'parsePrd', 'ganLoop', 'inferTaskPlan',
  'dbUpsert', 'pick_sub_task', 'run_sub_task', 'evaluate', 'advance',
  'retry', 'terminal_fail', 'final_evaluate', 'report',
];

describe('Workstream 1 — acceptance helper [BEHAVIOR]', () => {
  it('assertBrainImageInSync 抛错当 brain HEAD 与 origin/main 不一致', async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: 'aaaaaaaaaaaaaaaa\n' })
      .mockResolvedValueOnce({ stdout: 'bbbbbbbbbbbbbbbb\n' });
    await expect(assertBrainImageInSync({ exec }))
      .rejects.toThrow(/stale|mismatch|aaaaaaaa/i);
  });

  it('assertBrainImageInSync 一致时不抛', async () => {
    const sha = 'cccccccccccccccccccccccccccccccccccccccc';
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: sha + '\n' })
      .mockResolvedValueOnce({ stdout: sha + '\n' });
    await expect(assertBrainImageInSync({ exec })).resolves.toBeDefined();
  });

  it('registerAndDispatchAcceptance 成功路径返回 task_id', async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task_id: '11111111-1111-1111-1111-111111111111' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dispatched: true }) });
    const taskId = await registerAndDispatchAcceptance({ fetch: fakeFetch });
    expect(taskId).toBe('11111111-1111-1111-1111-111111111111');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('registerAndDispatchAcceptance 注册失败抛错', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server err' });
    await expect(registerAndDispatchAcceptance({ fetch: fakeFetch })).rejects.toThrow();
  });

  it('waitFor14GraphNodeEvents 14 节点齐全时返回 distinct 列表', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({
      rows: FOURTEEN_NODES.map((n) => ({ node: n, propose_branch: n === 'inferTaskPlan' ? 'cp-harness-propose-r1-5eb2718b' : null })),
    });
    const result = await waitFor14GraphNodeEvents({
      query: fakeQuery,
      taskId: 'tid',
      dispatchTs: 0,
      timeoutSec: 1,
    });
    expect(result.nodes).toHaveLength(14);
    expect(result.nodes).toEqual(expect.arrayContaining(FOURTEEN_NODES));
  });

  it('waitFor14GraphNodeEvents 缺节点时抛错并指出哪个缺', async () => {
    const partial = FOURTEEN_NODES.filter((n) => n !== 'inferTaskPlan');
    const fakeQuery = vi.fn().mockResolvedValue({
      rows: partial.map((n) => ({ node: n })),
    });
    await expect(waitFor14GraphNodeEvents({
      query: fakeQuery,
      taskId: 'tid',
      dispatchTs: 0,
      timeoutSec: 1,
    })).rejects.toThrow(/inferTaskPlan/);
  });

  it('waitFor14GraphNodeEvents inferTaskPlan branch 不匹配 PR #2837 修后正则时抛错', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({
      rows: FOURTEEN_NODES.map((n) => ({ node: n, propose_branch: n === 'inferTaskPlan' ? 'cp-05080823-49dafaf4' : null })),
    });
    await expect(waitFor14GraphNodeEvents({
      query: fakeQuery,
      taskId: 'tid',
      dispatchTs: 0,
      timeoutSec: 1,
    })).rejects.toThrow(/cp-harness-propose|propose_branch.*format/i);
  });
});
