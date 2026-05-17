/**
 * harness-dag-upsert-priority.test.js
 *
 * 原测试（2026-04-22）：回归 upsertTaskPlan 默认 priority=P0。
 * 更新（2026-04-28 RCA）：Sprint 1 full graph 后 upsertTaskPlan 不再 INSERT tasks 行，
 * 改用内存 UUID。原 priority 断言已失效，更新为"不 INSERT"断言。
 *
 * 功能性回归测试移至：harness-dag-no-retired-spawn.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { upsertTaskPlan } from '../harness-dag.js';

describe('upsertTaskPlan — Sprint 1 full graph：不再 INSERT harness_task（替代旧 priority 回归）', () => {
  let mockClient;
  let taskInsertCalls;

  beforeEach(() => {
    taskInsertCalls = [];
    mockClient = {
      query: vi.fn((sql, _params) => {
        if (/INSERT INTO tasks/i.test(sql)) {
          taskInsertCalls.push(sql);
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
  });

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

  it('单个子任务：不 INSERT tasks（旧 P0 回归已由 harness-dag-no-retired-spawn 覆盖）', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1')] };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(taskInsertCalls).toHaveLength(0);
  });

  it('4 个子任务（还原真机场景 ws1-4）：0 次 INSERT tasks', async () => {
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

  it('返回值 idMap 含所有 logical_task_id 对应的 UUID', async () => {
    const plan = { initiative_id: 'init-1', tasks: [makeTask('ws1'), makeTask('ws2', ['ws1'])] };
    const { idMap } = await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });
    expect(Object.keys(idMap)).toEqual(expect.arrayContaining(['ws1', 'ws2']));
    expect(idMap['ws1']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
