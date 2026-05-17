// SPDX-License-Identifier: MIT
// Test for H8: evaluateSubTaskNode worktreePath 切到 generator 的 sub-task worktree。
// 修复 PR #2851 后引入的 worktree 不一致 BUG。
//
// H11 修正：原 H8 用 harnessTaskWorktreePath(state.task.id) 是误诊（task.id 是 initiative UUID
// 而非 sub_task logical id）。改用 harnessSubTaskWorktreePath(initiativeId, sub_task.id) 复合。

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import {
  harnessTaskWorktreePath,
  harnessSubTaskWorktreePath,
  DEFAULT_BASE_REPO,
} from '../../packages/brain/src/harness-worktree.js';
import { shortTaskId } from '../../packages/brain/src/harness-utils.js';
import { evaluateSubTaskNode } from '../../packages/brain/src/workflows/harness-initiative.graph.js';

describe('H8 — harnessTaskWorktreePath helper', () => {
  test('返回 <baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>', () => {
    const taskId = '485f6817-20d0-427e-9096-0fe0a4c5cc02';
    const expected = path.join(
      DEFAULT_BASE_REPO,
      '.claude',
      'worktrees',
      'harness-v2',
      `task-${shortTaskId(taskId)}`,
    );
    expect(harnessTaskWorktreePath(taskId)).toBe(expected);
  });

  test('opts.baseRepo override 生效', () => {
    const taskId = 'aaaa-bbbb-cccc';
    const custom = '/tmp/custom-base';
    const got = harnessTaskWorktreePath(taskId, { baseRepo: custom });
    expect(got.startsWith(custom)).toBe(true);
    expect(got.endsWith(`task-${shortTaskId(taskId)}`)).toBe(true);
  });
});

describe('H8 — evaluateSubTaskNode worktreePath 切到 sub-task worktree', () => {
  function makeSpyExecutor() {
    const calls = [];
    const spy = async (opts) => {
      calls.push(opts);
      return { exit_code: 0, stdout: '{"verdict":"PASS","feedback":null}', stderr: '', timed_out: false };
    };
    spy.calls = calls;
    return spy;
  }

  test('worktreePath 传给 executor 的值 = harnessSubTaskWorktreePath(initiativeId, sub_task.id)（H11 修正），不是 state.worktreePath', async () => {
    const spy = makeSpyExecutor();
    const state = {
      task: { id: 'task-h8-test-uuid', payload: { sprint_dir: 'sprints/test' } },
      sub_task: { id: 'ws1' },
      initiativeId: 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d',
      worktreePath: '/initiative/main/path',
      task_loop_index: 0,
      taskPlan: { journey_type: 'autonomous' },
      githubToken: 'ghs_test',
      evaluate_verdict: null,
    };
    // H15: mock verifyEvaluator 通过，避免默认 verifyEvaluatorWorktree 真去 stat 不存在的 worktree
    await evaluateSubTaskNode(state, { executor: spy, verifyEvaluator: async () => undefined });
    expect(spy.calls.length).toBe(1);
    const passedWtPath = spy.calls[0].worktreePath;
    expect(passedWtPath).toBe(harnessSubTaskWorktreePath(state.initiativeId, 'ws1'));
    expect(passedWtPath).not.toBe('/initiative/main/path');
  });

  test('幂等门：state.evaluate_verdict 非空时直接 return，不调 executor', async () => {
    const spy = makeSpyExecutor();
    const state = {
      task: { id: 'task-h8-idem' },
      worktreePath: '/whatever',
      evaluate_verdict: 'PASS',
      evaluate_feedback: 'cached',
    };
    const out = await evaluateSubTaskNode(state, { executor: spy });
    expect(spy.calls.length).toBe(0);
    expect(out.evaluate_verdict).toBe('PASS');
    expect(out.evaluate_feedback).toBe('cached');
  });
});
