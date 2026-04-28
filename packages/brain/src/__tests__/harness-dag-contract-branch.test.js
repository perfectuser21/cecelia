/**
 * 回归测试：upsertTaskPlan Sprint 1 full graph 后行为。
 *
 * 历史背景（2026-04-28 RCA）：
 *   - 原测试验证 contractBranch 写入 payload.contract_branch（INSERT INTO tasks）
 *   - Sprint 1 PR 停止 INSERT harness_task 行，改用内存 UUID
 *   - 旧测试期望 INSERT×4，现在 INSERT=0，测试已过时
 *
 * 更新后的验证目标：
 *   1. upsertTaskPlan 不向 tasks 表 INSERT（无论 contractBranch 是否存在）
 *   2. 仍返回 idMap + insertedTaskIds（各 4 个 UUID）
 *   3. task_dependencies 仍写入（1 条依赖边 ws2→ws1 等）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 的 default export（upsertTaskPlan 不 import pool 但模块加载时会触发）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import { upsertTaskPlan } from '../harness-dag.js';

function makeMockClient() {
  const queries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    }),
    _queries: queries,
  };
  return client;
}

const samplePlan = {
  initiative_id: 'init-1',
  tasks: [
    { task_id: 'ws1', title: 'WS1', scope: 'do A', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: [] },
    { task_id: 'ws2', title: 'WS2', scope: 'do B', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws1'] },
    { task_id: 'ws3', title: 'WS3', scope: 'do C', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws1'] },
    { task_id: 'ws4', title: 'WS4', scope: 'do D', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws2'] },
  ],
};

describe('upsertTaskPlan — Sprint 1 full graph（不再 INSERT tasks 行）', () => {
  let client;
  beforeEach(() => { client = makeMockClient(); });

  it('contractBranch 非空 → 仍不向 tasks 表 INSERT，返回 4 个内存 UUID', async () => {
    const branch = 'cp-harness-propose-r3-abcd1234';
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: branch,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(0);
    expect(insertedTaskIds).toHaveLength(4);
    expect(Object.keys(idMap)).toHaveLength(4);
    for (const uuid of insertedTaskIds) {
      expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('contractBranch 缺省 → 仍不向 tasks 表 INSERT，返回 4 个内存 UUID', async () => {
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(0);
    expect(insertedTaskIds).toHaveLength(4);
    expect(Object.keys(idMap)).toHaveLength(4);
  });

  it('contractBranch 为 null → 仍不向 tasks 表 INSERT，task_dependencies 仍写入', async () => {
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: null,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(0);

    // task_dependencies 依然写入（ws2→ws1, ws3→ws1, ws4→ws2）
    const depInserts = client._queries.filter((q) => /INSERT INTO task_dependencies/.test(q.sql));
    expect(depInserts.length).toBe(3);
  });
});
