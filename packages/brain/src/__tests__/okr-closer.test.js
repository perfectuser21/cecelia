/**
 * Tests for okr-closer.js — OKR 飞轮闭环检查器
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool factory
function makePool(responses) {
  let callIndex = 0;
  return {
    query: vi.fn(async () => {
      const r = responses[callIndex++];
      if (!r) return { rows: [] };
      return r;
    }),
  };
}

// 动态 import 在 vi.mock 后使用
let checkOkrInitiativeCompletion;
let checkOkrScopeCompletion;
let checkOkrProjectCompletion;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../okr-closer.js');
  checkOkrInitiativeCompletion = mod.checkOkrInitiativeCompletion;
  checkOkrScopeCompletion = mod.checkOkrScopeCompletion;
  checkOkrProjectCompletion = mod.checkOkrProjectCompletion;
});

describe('checkOkrInitiativeCompletion', () => {
  it('无 in_progress initiatives 时返回 closedCount=0', async () => {
    const pool = makePool([{ rows: [] }]);
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('initiative 下还有 queued tasks 时不关闭', async () => {
    const pool = makePool([
      // SELECT initiatives
      { rows: [{ id: 'init-1', title: 'Test Initiative', scope_id: 'scope-1' }] },
      // SELECT stats: queued=1 → 不关闭
      { rows: [{ total: '1', queued: '1', in_progress: '0', quarantine: '0' }] },
    ]);
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('initiative 下无 tasks 时不关闭（total=0）', async () => {
    const pool = makePool([
      { rows: [{ id: 'init-1', title: 'Empty Initiative', scope_id: 'scope-1' }] },
      { rows: [{ total: '0', queued: '0', in_progress: '0', quarantine: '0' }] },
    ]);
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('所有 tasks 完成时关闭 initiative 并触发 okr_scope_plan', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'init-1', title: '测试 Initiative', scope_id: 'scope-1' }] }) // SELECT initiatives
        .mockResolvedValueOnce({ rows: [{ total: '3', queued: '0', in_progress: '0', quarantine: '0' }] }) // stats
        .mockResolvedValueOnce({ rows: [] })  // UPDATE okr_initiatives
        .mockResolvedValueOnce({ rows: [] })  // INSERT cecelia_events
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] }) // remaining initiatives in scope
        .mockResolvedValueOnce({ rows: [] })  // existing scope_plan check (none)
        .mockResolvedValueOnce({ rows: [{ title: '测试 Scope' }] }) // scope title
        .mockResolvedValueOnce({ rows: [] }), // INSERT okr_scope_plan task
    };

    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0].id).toBe('init-1');

    // 验证 UPDATE 被调用
    const calls = pool.query.mock.calls;
    const updateCall = calls.find(c => c[0].includes && c[0].includes('UPDATE okr_initiatives'));
    expect(updateCall).toBeDefined();

    // 验证 okr_scope_plan task 被插入
    const insertCall = calls.find(c => c[0].includes && c[0].includes('okr_scope_plan'));
    expect(insertCall).toBeDefined();
  });

  it('initiative 有 quarantined tasks 时不关闭', async () => {
    const pool = makePool([
      { rows: [{ id: 'init-1', title: 'Test', scope_id: 'scope-1' }] },
      { rows: [{ total: '3', queued: '0', in_progress: '0', quarantine: '1' }] },
    ]);
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });
});

describe('checkOkrScopeCompletion', () => {
  it('无活跃 scopes 时返回 closedCount=0', async () => {
    const pool = makePool([{ rows: [] }]);
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('scope 下还有活跃 initiatives 时不关闭', async () => {
    const pool = makePool([
      { rows: [{ id: 'scope-1', title: 'Test Scope', project_id: 'proj-1' }] },
      // stats: active=1 → 不关闭
      { rows: [{ total: '2', completed: '1', active: '1' }] },
    ]);
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('所有 initiatives 完成时关闭 scope 并触发 okr_project_plan', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'scope-1', title: '测试 Scope', project_id: 'proj-1' }] })
        .mockResolvedValueOnce({ rows: [{ total: '3', completed: '3', active: '0' }] })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE okr_scopes
        .mockResolvedValueOnce({ rows: [] }) // INSERT cecelia_events
        .mockResolvedValueOnce({ rows: [] }) // existing project_plan check
        .mockResolvedValueOnce({ rows: [{ title: '测试 Project' }] }) // project title
        .mockResolvedValueOnce({ rows: [] }), // INSERT okr_project_plan task
    };
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0].id).toBe('scope-1');

    const calls = pool.query.mock.calls;
    const insertCall = calls.find(c => c[0].includes && c[0].includes('okr_project_plan'));
    expect(insertCall).toBeDefined();
  });
});

describe('checkOkrProjectCompletion', () => {
  it('无活跃 projects 时返回 closedCount=0', async () => {
    const pool = makePool([{ rows: [] }]);
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('project 下还有活跃 scopes 时不关闭', async () => {
    const pool = makePool([
      { rows: [{ id: 'proj-1', title: 'Test Project', kr_id: 'kr-1' }] },
      { rows: [{ total: '2', completed: '1', active: '1' }] },
    ]);
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('所有 scopes 完成时关闭 project', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', title: '测试 Project', kr_id: 'kr-1' }] })
        .mockResolvedValueOnce({ rows: [{ total: '3', completed: '3', active: '0' }] })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE okr_projects
        .mockResolvedValueOnce({ rows: [] }), // INSERT cecelia_events
    };
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0].id).toBe('proj-1');

    const calls = pool.query.mock.calls;
    const updateCall = calls.find(c => c[0].includes && c[0].includes('UPDATE okr_projects'));
    expect(updateCall).toBeDefined();
  });
});
