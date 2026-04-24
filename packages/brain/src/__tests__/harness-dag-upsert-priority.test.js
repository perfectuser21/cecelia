/**
 * harness-dag-upsert-priority.test.js
 *
 * 回归测试：upsertTaskPlan 创建 harness_task 子任务时，默认 priority 必须是 'P0'。
 *
 * 背景（2026-04-22 真机事故）：
 *   Initiative 2303a935 的 4 个 Generator 子任务 ws1-4 由 upsertTaskPlan 创建时
 *   默认 priority='P2' → 被 alertness pause_low_priority 立刻改成 paused →
 *   Dispatcher 不派 paused 任务 → E2E 卡住。
 *
 * 修复：upsertTaskPlan 默认写入 'P0'（harness_task 是 active Initiative 的子工作，
 * 跟 parent harness_initiative 同等重要，不应被 alertness 降级）。
 *
 * 另在 alertness/escalation.js 的 pauseLowPriorityTasks 白名单里加入 harness_*
 * 全家桶作为双保险（见 alertness-harness-whitelist.test.js）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 的 default export（upsertTaskPlan 不 import pool，而是接收 client；
// 但 module-level import pool 仍会触发 db.js 的 pg 连接，所以 mock 掉）
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { upsertTaskPlan } from '../harness-dag.js';

describe('upsertTaskPlan — 默认 priority=P0（回归：harness_task 不应被 alertness auto-pause）', () => {
  let mockClient;
  let capturedInsertCalls;

  beforeEach(() => {
    capturedInsertCalls = [];
    mockClient = {
      query: vi.fn((sql, params) => {
        // INSERT INTO tasks ... RETURNING id
        if (/^\s*INSERT INTO tasks/i.test(sql)) {
          capturedInsertCalls.push({ sql, params });
          return Promise.resolve({ rows: [{ id: `uuid-${capturedInsertCalls.length}` }] });
        }
        // INSERT INTO task_dependencies ...
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

  it('单个子任务：INSERT SQL 含 \'P0\' 字面量', async () => {
    const plan = {
      initiative_id: 'init-1',
      tasks: [makeTask('ws1')],
    };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });

    expect(capturedInsertCalls).toHaveLength(1);
    const { sql } = capturedInsertCalls[0];
    // SQL 中必须用 'P0' 而不是 'P2'
    expect(sql).toMatch(/'P0'/);
    expect(sql).not.toMatch(/'P2'/);
  });

  it('4 个子任务（还原真机场景 ws1-4）：所有 INSERT 都写 \'P0\'', async () => {
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

    expect(capturedInsertCalls).toHaveLength(4);
    for (const { sql } of capturedInsertCalls) {
      expect(sql).toMatch(/'P0'/);
      expect(sql).not.toMatch(/'P2'/);
    }
  });

  it('INSERT 列顺序含 priority（确保 P0 位置正确）', async () => {
    const plan = {
      initiative_id: 'init-1',
      tasks: [makeTask('ws1')],
    };
    await upsertTaskPlan({
      client: mockClient,
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-uuid',
      taskPlan: plan,
    });

    const { sql } = capturedInsertCalls[0];
    // VALUES (..., 'queued', 'P0', ...) — status 前一列是 status，其后是 priority
    expect(sql).toMatch(/'queued',\s*'P0'/);
  });
});
