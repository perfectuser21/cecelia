/**
 * 回归测试：upsertTaskPlan 接收 contractBranch 参数时，
 * 每个 sub-task 的 payload.contract_branch 必须等于该值。
 *
 * 漏点：Phase B 入库 sub-task 时未写 contract_branch →
 *      harness-task-dispatch.js 注入空 CONTRACT_BRANCH → Generator ABORT。
 *      bb245cb4 / 576f6cf4 两次 Initiative 实证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 的 default export（upsertTaskPlan 不 import pool 但模块加载时会触发）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import { upsertTaskPlan } from '../harness-dag.js';

function makeMockClient() {
  let idCounter = 0;
  const queries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO tasks/.test(sql)) {
        idCounter += 1;
        return { rows: [{ id: `uuid-${idCounter}` }] };
      }
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

describe('upsertTaskPlan — payload.contract_branch（修 Generator ABORT 最后一跳）', () => {
  let client;
  beforeEach(() => { client = makeMockClient(); });

  it('contractBranch 非空 → 每个 sub-task payload 含 contract_branch', async () => {
    const branch = 'cp-harness-propose-r3-abcd1234';
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: branch,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(4);
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBe(branch);
    }
  });

  it('contractBranch 缺省 → payload 不含 contract_branch（向后兼容）', async () => {
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(4);
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBeUndefined();
    }
  });

  it('contractBranch 为 null → payload 不含 contract_branch', async () => {
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: null,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(4);
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBeUndefined();
    }
  });
});
