/**
 * harness-dag-no-retired-spawn.test.js
 *
 * 回归测试：upsertTaskPlan 不再向 tasks 表写入 harness_task 行。
 *
 * 背景（2026-04-28 RCA）：Sprint 1 PR 把 Harness 改成 LangGraph full graph
 * 后，harness_task 在 executor.js 中被 retired。但 upsertTaskPlan 仍 INSERT
 * tasks 行 → 立即失败，导致成功率降至 39%。
 *
 * 修复：upsertTaskPlan 改用 crypto.randomUUID() 内存生成 ID，不写 tasks 表。
 * Full graph 不依赖 tasks 行驱动，task_dependencies 也不再需要真实 UUID（full
 * graph 内联执行，依赖关系由 fanout 顺序保证）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { upsertTaskPlan } from '../harness-dag.js';

function makeTask(id, depends_on = []) {
  return {
    task_id: id,
    title: `Task ${id}`,
    scope: `scope of ${id}`,
    dod: [`[BEHAVIOR] ${id} works`],
    files: [`packages/brain/src/${id}.js`],
    depends_on,
    complexity: 'S',
    estimated_minutes: 30,
  };
}

describe('upsertTaskPlan — 不再 INSERT harness_task 到 tasks 表', () => {
  let mockClient;
  let taskInsertCalls;

  beforeEach(() => {
    taskInsertCalls = [];
    mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
        }
        // task_dependencies INSERT
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
  });

  it('单任务：不向 tasks 表 INSERT', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1')] };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('4 任务（还原真机 ws1-4）：不向 tasks 表 INSERT', async () => {
    const plan = {
      initiative_id: 'init-2303a935',
      tasks: [
        makeTask('ws1'),
        makeTask('ws2', ['ws1']),
        makeTask('ws3', ['ws1']),
        makeTask('ws4', ['ws2', 'ws3']),
      ],
    };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-2303a935',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('返回值 idMap 包含各 logical_task_id 对应的 UUID 字符串', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])] };
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(idMap['ws1']).toMatch(/^[0-9a-f-]{36}$/);
    expect(idMap['ws2']).toMatch(/^[0-9a-f-]{36}$/);
    expect(insertedTaskIds).toHaveLength(2);
  });

  it('task_dependencies 边仍然被写入（含 hard edge）', async () => {
    const plan = {
      initiative_id: 'init-1',
      tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])],
    };
    const depInsertCalls = [];
    mockClient.query = vi.fn((sql, _params) => {
      if (/INSERT INTO task_dependencies/i.test(sql)) {
        depInsertCalls.push(sql);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(depInsertCalls).toHaveLength(1);
    expect(depInsertCalls[0]).toMatch(/hard/i);
  });
});
