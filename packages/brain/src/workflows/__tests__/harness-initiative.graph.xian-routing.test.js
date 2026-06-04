import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { runSubTaskNode } from '../harness-initiative.graph.js';

describe('harness-initiative.graph — runSubTaskNode 透传 machine/executor 到 sub-task payload', () => {
  it('initiative payload.machine + executor 透传到 taskForGraph.payload', async () => {
    const capturedInvokes = [];
    const fakeCompiled = {
      invoke: async (input) => {
        capturedInvokes.push(input);
        return { status: 'completed', pr_url: 'https://github.com/x/y/pull/1' };
      },
    };

    const state = {
      initiativeId: 'init-001',
      task: {
        id: 'initiative-task-id',
        payload: {
          machine: 'mac-mini-m4-xian',
          executor: 'codex',
          base_repo: 'https://github.com/perfectuser21/infrastructure.git',
        },
      },
      sub_task: {
        id: 'ws1',
        title: 'Test workstream',
        description: 'Test',
        payload: { dod: ['item1'], files: ['a.js'] },
      },
      sprintDir: 'sprints/test',
      task_loop_fix_count: 0,
      final_e2e_fix_count: 0,
    };

    await runSubTaskNode(state, { compiledTaskGraph: fakeCompiled, waitMs: 0 });

    expect(capturedInvokes).toHaveLength(1);
    const taskPayload = capturedInvokes[0].task.payload;
    expect(taskPayload.machine).toBe('mac-mini-m4-xian');
    expect(taskPayload.executor).toBe('codex');
  });

  it('initiative 没有 machine/executor 时不注入（向后兼容）', async () => {
    const capturedInvokes = [];
    const fakeCompiled = {
      invoke: async (input) => {
        capturedInvokes.push(input);
        return { status: 'completed', pr_url: 'https://github.com/x/y/pull/2' };
      },
    };

    const state = {
      initiativeId: 'init-002',
      task: { id: 'ti2', payload: {} },
      sub_task: {
        id: 'ws1', title: 'T', description: 'D',
        payload: { dod: [], files: [] },
      },
      task_loop_fix_count: 0,
      final_e2e_fix_count: 0,
    };

    await runSubTaskNode(state, { compiledTaskGraph: fakeCompiled, waitMs: 0 });

    const taskPayload = capturedInvokes[0].task.payload;
    expect(taskPayload.machine).toBeUndefined();
    expect(taskPayload.executor).toBeUndefined();
  });
});
