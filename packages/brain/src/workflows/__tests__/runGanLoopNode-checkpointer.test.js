import { describe, it, expect, vi, beforeEach } from 'vitest';

// 用 vi.hoisted 让 mock fn 在 vi.mock factory 内可用（vi.mock 被 hoisted 到顶部）
const { getPgCheckpointerMock, runGanContractGraphMock } = vi.hoisted(() => ({
  getPgCheckpointerMock: vi.fn(),
  runGanContractGraphMock: vi.fn(),
}));

vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: getPgCheckpointerMock,
}));

vi.mock('../../harness-gan-graph.js', () => ({
  runGanContractGraph: runGanContractGraphMock,
}));

import { runGanLoopNode } from '../harness-initiative.graph.js';

describe('runGanLoopNode checkpointer 兜底 [BEHAVIOR]', () => {
  beforeEach(() => {
    getPgCheckpointerMock.mockReset();
    runGanContractGraphMock.mockReset();
  });

  it('opts.checkpointer 缺失 -> 自动 getPgCheckpointer 兜底', async () => {
    const fakeCheckpointer = { isFake: true };
    getPgCheckpointerMock.mockResolvedValue(fakeCheckpointer);
    runGanContractGraphMock.mockResolvedValue({ propose_branch: 'b', contract_content: 'c', rounds: 1 });
    const result = await runGanLoopNode({
      task: { id: 't1', payload: {} },
      initiativeId: 'init1',
      worktreePath: '/wt',
      githubToken: 'tok',
      prdContent: 'prd',
    });
    expect(getPgCheckpointerMock).toHaveBeenCalledTimes(1);
    expect(runGanContractGraphMock).toHaveBeenCalledTimes(1);
    expect(runGanContractGraphMock.mock.calls[0][0].checkpointer).toBe(fakeCheckpointer);
    expect(result.ganResult).toBeDefined();
  });

  it('opts.checkpointer 显式传 -> 不调 getPgCheckpointer', async () => {
    const provided = { provided: true };
    runGanContractGraphMock.mockResolvedValue({ propose_branch: 'b', contract_content: 'c', rounds: 1 });
    await runGanLoopNode(
      { task: { id: 't1', payload: {} }, initiativeId: 'init1', worktreePath: '/wt', githubToken: 't', prdContent: 'p' },
      { checkpointer: provided }
    );
    expect(getPgCheckpointerMock).not.toHaveBeenCalled();
    expect(runGanContractGraphMock.mock.calls[0][0].checkpointer).toBe(provided);
  });

  it('state.ganResult 已存在 -> short circuit', async () => {
    const result = await runGanLoopNode({ ganResult: { already: 'done' } });
    expect(result).toEqual({ ganResult: { already: 'done' } });
    expect(getPgCheckpointerMock).not.toHaveBeenCalled();
    expect(runGanContractGraphMock).not.toHaveBeenCalled();
  });
});
