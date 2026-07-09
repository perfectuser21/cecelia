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
  DEFAULT_BASE_REPO,
} from '../../packages/brain/src/harness-worktree.js';
import { shortTaskId } from '../../packages/brain/src/harness-utils.js';
// 刀4阶段3：harness-initiative.graph.js 已物理删除（LangGraph 图路径废弃，orchestrator 硬校验
// 后全走 skill-relay）。下方原先测 evaluateSubTaskNode（死图节点，且用例本身已全部 .skip）的
// describe 块已删除，只保留测 harness-worktree.js 活代码 helper 的用例。

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

  test('opts.baseRepo 不影响 wtPath — 始终在 DEFAULT_BASE_REPO 下', () => {
    const taskId = 'aaaa-bbbb-cccc';
    const got = harnessTaskWorktreePath(taskId, { baseRepo: '/tmp/custom-base' });
    expect(got.startsWith(DEFAULT_BASE_REPO)).toBe(true);
    expect(got.endsWith(`task-${shortTaskId(taskId)}`)).toBe(true);
  });
});
