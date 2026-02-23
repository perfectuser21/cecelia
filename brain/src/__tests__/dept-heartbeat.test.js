/**
 * dept-heartbeat.test.js
 *
 * 单元测试：triggerDeptHeartbeats / createDeptHeartbeatTask / getEnabledDepts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEnabledDepts, createDeptHeartbeatTask, triggerDeptHeartbeats } from '../dept-heartbeat.js';

// ============================================================
// Mock pool
// ============================================================

function makePool(queryResponses) {
  const calls = [];
  const pool = {
    query: vi.fn(async (sql) => {
      calls.push(sql);
      const resp = queryResponses.shift();
      if (resp instanceof Error) throw resp;
      return resp || { rows: [] };
    }),
    _calls: calls,
  };
  return pool;
}

// ============================================================
// getEnabledDepts
// ============================================================

describe('getEnabledDepts', () => {
  it('D1: 返回 enabled=true 的部门列表', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/home/xx/perfect21/zenithjoy/workspace' },
        { dept_name: 'creator',   max_llm_slots: 1, repo_path: '/home/xx/perfect21/creator' },
      ]},
    ]);
    const depts = await getEnabledDepts(pool);
    expect(depts).toHaveLength(2);
    expect(depts[0].dept_name).toBe('zenithjoy');
  });

  it('D2: 无部门时返回空数组', async () => {
    const pool = makePool([{ rows: [] }]);
    const depts = await getEnabledDepts(pool);
    expect(depts).toHaveLength(0);
  });
});

// ============================================================
// createDeptHeartbeatTask
// ============================================================

describe('createDeptHeartbeatTask', () => {
  const dept = {
    dept_name: 'zenithjoy',
    repo_path: '/home/xx/perfect21/zenithjoy/workspace',
    max_llm_slots: 2,
  };

  it('D3: 无活跃 heartbeat 时创建新 task', async () => {
    const pool = makePool([
      { rows: [] },                                  // no existing
      { rows: [{ id: 'task-uuid-001' }] },           // insert returns id
    ]);
    const result = await createDeptHeartbeatTask(pool, dept);
    expect(result.created).toBe(true);
    expect(result.task_id).toBe('task-uuid-001');
  });

  it('D4: 已有活跃 heartbeat 时跳过（防重复）', async () => {
    const pool = makePool([
      { rows: [{ id: 'existing-task' }] },   // existing queued heartbeat
    ]);
    const result = await createDeptHeartbeatTask(pool, dept);
    expect(result.created).toBe(false);
    expect(result.reason).toBe('already_active');
    expect(result.task_id).toBe('existing-task');
  });
});

// ============================================================
// triggerDeptHeartbeats
// ============================================================

describe('triggerDeptHeartbeats', () => {
  it('D5: 为 2 个部门各创建 heartbeat', async () => {
    const pool = makePool([
      // getEnabledDepts
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/a' },
        { dept_name: 'creator',   max_llm_slots: 1, repo_path: '/b' },
      ]},
      // zenithjoy: no existing
      { rows: [] },
      // zenithjoy: insert
      { rows: [{ id: 'task-1' }] },
      // creator: no existing
      { rows: [] },
      // creator: insert
      { rows: [{ id: 'task-2' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool);
    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('D6: 有 1 个部门已活跃时跳过该部门', async () => {
    const pool = makePool([
      { rows: [
        { dept_name: 'zenithjoy', max_llm_slots: 2, repo_path: '/a' },
      ]},
      // zenithjoy: already active
      { rows: [{ id: 'old-task' }] },
    ]);

    const result = await triggerDeptHeartbeats(pool);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('D7: DB 异常时不 throw，返回空结果', async () => {
    const pool = makePool([
      new Error('DB connection lost'),
    ]);

    const result = await triggerDeptHeartbeats(pool);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
