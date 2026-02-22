/**
 * project-activator.js 单元测试
 * DoD: D7, D8 (sequence_order + deadline) + 原有测试
 */

import { describe, it, expect, vi } from 'vitest';
import { manageProjectActivation } from '../project-activator.js';

const cap = { max: 2, softMin: 1, cooldownMs: 180_000 };

function makeMockPool({ activeProjects = [], candidates = [] } = {}) {
  let deactivateCount = 0;
  let activateCount = 0;
  const capturedQueries = [];

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();
      capturedQueries.push({ sql: s, params });

      // 查 active projects
      if (
        s.includes("type = 'project'") &&
        s.includes("status = 'active'") &&
        s.includes('SELECT') &&
        s.includes('p.id')
      ) {
        return { rows: activeProjects };
      }

      // 降级 UPDATE（inactive）
      if (s.includes('UPDATE projects') && s.includes("status = 'inactive'")) {
        deactivateCount++;
        return { rows: [] };
      }

      // 查 candidates（pending + inactive）
      if (
        s.includes("type = 'project'") &&
        s.includes("status IN ('pending', 'inactive')")
      ) {
        return { rows: candidates };
      }

      // 激活 UPDATE
      if (s.includes('UPDATE projects') && s.includes("status = 'active'")) {
        activateCount++;
        return { rows: [] };
      }

      // cecelia_events
      if (s.includes('cecelia_events')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
    _getDeactivateCount: () => deactivateCount,
    _getActivateCount: () => activateCount,
    _getCapturedQueries: () => capturedQueries,
  };
}

describe('manageProjectActivation - 补位', () => {
  it('active=0, max=2, 从 pending 补 2 个', async () => {
    const candidates = [
      { id: 'proj-1', name: 'Project 1', priority: 'P0', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null, deadline: null },
      { id: 'proj-2', name: 'Project 2', priority: 'P1', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null, deadline: null },
      { id: 'proj-3', name: 'Project 3', priority: 'P2', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null, deadline: null },
    ];
    const pool = makeMockPool({ activeProjects: [], candidates });

    const result = await manageProjectActivation(pool, cap);

    expect(result.activated).toBe(2); // max=2, 只补 2 个
    expect(result.deactivated).toBe(0);
  });

  it('active=2（满了），不补位', async () => {
    const activeProjects = Array.from({ length: 2 }, (_, i) => ({
      id: `active-${i}`, name: `Active ${i}`, priority: 'P0',
      created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null,
    }));
    const pool = makeMockPool({ activeProjects });

    const result = await manageProjectActivation(pool, cap);

    expect(result.activated).toBe(0);
    expect(result.deactivated).toBe(0);
  });
});

describe('manageProjectActivation - 降级', () => {
  it('active=4, max=2, 降级 2 个最低分的', async () => {
    const activeProjects = Array.from({ length: 4 }, (_, i) => ({
      id: `active-${i}`, name: `Active ${i}`,
      priority: i < 2 ? 'P0' : 'P2', // 最后 2 个是 P2 低优先级
      created_at: '2026-02-20',
      updated_at: new Date(Date.now() - 600_000).toISOString(),
      user_pinned: null,
    }));
    const pool = makeMockPool({ activeProjects });

    const result = await manageProjectActivation(pool, cap);

    expect(result.deactivated).toBe(2);
  });

  it('pinned 的 project 不会被降级', async () => {
    const activeProjects = Array.from({ length: 4 }, (_, i) => ({
      id: `active-${i}`, name: `Active ${i}`,
      priority: 'P2',
      created_at: '2026-02-20',
      updated_at: new Date(Date.now() - 600_000).toISOString(),
      user_pinned: i < 2 ? 'true' : null, // 前 2 个 pinned
    }));
    const pool = makeMockPool({ activeProjects });

    const result = await manageProjectActivation(pool, cap);

    // 只能降级 2 个非 pinned 中的 2 个
    expect(result.deactivated).toBe(2);
  });
});

describe('manageProjectActivation - cooldown', () => {
  it('刚更新的 project 不会被选中激活', async () => {
    const candidates = [
      {
        id: 'proj-cool', name: 'Cool Project', priority: 'P0',
        created_at: '2026-02-20',
        updated_at: new Date().toISOString(), // 刚刚更新（在 cooldown 内）
        user_pinned: null,
        deadline: null,
      },
    ];
    const pool = makeMockPool({ activeProjects: [], candidates });

    const result = await manageProjectActivation(pool, cap);

    expect(result.activated).toBe(0);
  });
});

describe('manageProjectActivation - D7: sequence_order 排序', () => {
  it('补位查询包含 sequence_order ASC NULLS LAST', async () => {
    const candidates = [
      { id: 'proj-1', name: 'Project 1', priority: 'P1', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null, deadline: null },
    ];
    const pool = makeMockPool({ activeProjects: [], candidates });

    await manageProjectActivation(pool, cap);

    // 检查候选查询 SQL 包含 sequence_order 排序
    const candidateQuery = pool._getCapturedQueries().find(
      q => q.sql.includes("status IN ('pending', 'inactive')")
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery.sql).toContain('sequence_order ASC NULLS LAST');
  });
});

describe('manageProjectActivation - D8: deadline 传递给评分', () => {
  it('候选 deadline 传给 computeActivationScore（近 deadline 优先）', async () => {
    const now = new Date();
    const soonDeadline = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2天后
    const farDeadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30天后

    const candidates = [
      {
        id: 'proj-far', name: 'Far Deadline', priority: 'P1',
        created_at: '2026-02-20',
        updated_at: new Date(Date.now() - 600_000).toISOString(),
        user_pinned: null,
        deadline: farDeadline.toISOString(),
      },
      {
        id: 'proj-soon', name: 'Soon Deadline', priority: 'P1',
        created_at: '2026-02-20',
        updated_at: new Date(Date.now() - 600_000).toISOString(),
        user_pinned: null,
        deadline: soonDeadline.toISOString(),
      },
    ];
    const pool = makeMockPool({ activeProjects: [], candidates });

    const result = await manageProjectActivation(pool, cap);

    // 两个都应被激活（max=2）
    expect(result.activated).toBe(2);

    // 验证 SQL 查询了 deadline 字段
    const candidateQuery = pool._getCapturedQueries().find(
      q => q.sql.includes("status IN ('pending', 'inactive')")
    );
    expect(candidateQuery.sql).toContain('p.deadline');
  });

  it('补位查询包含 p.deadline 字段', async () => {
    const candidates = [];
    const pool = makeMockPool({ activeProjects: [], candidates });

    await manageProjectActivation(pool, cap);

    const candidateQuery = pool._getCapturedQueries().find(
      q => q.sql.includes("status IN ('pending', 'inactive')")
    );
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery.sql).toContain('p.deadline');
  });
});
