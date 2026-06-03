/**
 * Wave 2c (B59) — terminal 标记沿 GAN→checkpoint 透传，serial gate / terminalFail 也带 terminal
 *
 * 链路：runGanContractGraph re-throw 时把 finalState.error.terminal 带到 e.terminal →
 *       runGanLoopNode catch 把 (err.terminal || err.ganAborted) 写进返回的 error.terminal →
 *       该 error 进 checkpoint → B58 resume 钩子 error?.terminal===true → 第一次中止即 failed。
 *
 * SC-301: runGanLoopNode：err.ganAborted=true（熔断）→ 返回 error.terminal===true
 * SC-302: runGanLoopNode：普通 transient err（无 ganAborted/terminal）→ error.terminal 为 falsy（让 cap 兜底重试）
 * SC-303: runGanLoopNode：err.terminal=true（直接标）→ error.terminal===true
 * SC-304: advanceTaskIndexNode serial gate 中止 → error.node='advance' 且 error.terminal===true
 * SC-305: terminalFailNode → error.node='terminal_fail' 且 error.terminal===true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunGan = vi.fn();
vi.mock('../harness-gan-graph.js', () => ({
  runGanContractGraph: (...a) => mockRunGan(...a),
}));
vi.mock('../harness-container-cleanup.js', () => ({
  killInitiativeContainers: vi.fn().mockResolvedValue(undefined),
}));
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a), connect: vi.fn() } }));

import {
  runGanLoopNode,
  advanceTaskIndexNode,
  terminalFailNode,
} from '../workflows/harness-initiative.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

function makeState(overrides = {}) {
  return {
    task: { id: 'task-prop-1', payload: {} },
    initiativeId: 'init-prop-1',
    initiative_run_id: null,
    sprintDir: 'sprints/demo',
    prdContent: '# PRD',
    worktreePath: '/mock-wt',
    githubToken: 'tok',
    ...overrides,
  };
}

const OPTS = () => ({ pool: { query: (...a) => mockQuery(...a) }, executor: vi.fn(), checkpointer: {} });

describe('runGanLoopNode — terminal 透传', () => {
  it('SC-301: err.ganAborted=true（熔断）→ error.terminal===true', async () => {
    mockRunGan.mockRejectedValueOnce(Object.assign(new Error('gan_aborted: proposer'), { ganAborted: true, node: 'proposer' }));
    const out = await runGanLoopNode(makeState(), OPTS());
    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('gan');
    expect(out.error.terminal).toBe(true);
  });

  it('SC-302: 普通 transient err（无 ganAborted/terminal）→ error.terminal 为 falsy', async () => {
    mockRunGan.mockRejectedValueOnce(new Error('proposer_failed: exit=1'));
    const out = await runGanLoopNode(makeState(), OPTS());
    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('gan');
    expect(out.error.terminal).toBeFalsy();
  });

  it('SC-303: err.terminal=true（直接标）→ error.terminal===true', async () => {
    mockRunGan.mockRejectedValueOnce(Object.assign(new Error('budget'), { terminal: true }));
    const out = await runGanLoopNode(makeState(), OPTS());
    expect(out.error.terminal).toBe(true);
  });
});

describe('serial gate / terminalFail — terminal 标记', () => {
  it('SC-304: advanceTaskIndexNode serial gate 中止 → error.node=advance + terminal===true', async () => {
    const state = {
      sub_tasks: [{ id: 'st-1', status: 'in_progress' }],
      taskPlan: { tasks: [{ id: 'st-1' }] },
      task_loop_index: 0,
    };
    const out = await advanceTaskIndexNode(state);
    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('advance');
    expect(out.error.terminal).toBe(true);
  });

  it('SC-305: terminalFailNode → error.node=terminal_fail + terminal===true', async () => {
    const state = { initiativeId: 'init-tf-1', task_loop_index: 0, evaluate_feedback: 'evaluator said FAIL' };
    const out = await terminalFailNode(state, { pool: { query: (...a) => mockQuery(...a) } });
    expect(out.error).toBeTruthy();
    expect(out.error.node).toBe('terminal_fail');
    expect(out.error.terminal).toBe(true);
  });
});
