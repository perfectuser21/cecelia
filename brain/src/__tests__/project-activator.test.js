/**
 * project-activator.js 单元测试
 * DoD: D3
 */

import { describe, it, expect, vi } from 'vitest';
import { manageProjectActivation } from '../project-activator.js';

const cap = { max: 5, softMin: 1, cooldownMs: 180_000 };

function makeMockPool({ activeProjects = [], candidates = [] } = {}) {
  let deactivateCount = 0;
  let activateCount = 0;

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查 active projects
      if (
        s.includes("type = 'project'") &&
        s.includes("status = 'active'") &&
        s.includes('SELECT')  &&
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
  };
}

describe('manageProjectActivation - 补位', () => {
  it('active=2, max=5, 从 pending 补 3 个', async () => {
    const candidates = [
      { id: 'proj-1', name: 'Project 1', priority: 'P0', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null },
      { id: 'proj-2', name: 'Project 2', priority: 'P1', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null },
      { id: 'proj-3', name: 'Project 3', priority: 'P2', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null },
    ];
    const pool = makeMockPool({
      activeProjects: [
        { id: 'active-1', name: 'Active 1', priority: 'P0', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null },
        { id: 'active-2', name: 'Active 2', priority: 'P1', created_at: '2026-02-20', updated_at: new Date(Date.now() - 600_000).toISOString(), user_pinned: null },
      ],
      candidates,
    });

    const result = await manageProjectActivation(pool, cap);

    expect(result.activated).toBe(3);
    expect(result.deactivated).toBe(0);
  });

  it('active=5（满了），不补位', async () => {
    const activeProjects = Array.from({ length: 5 }, (_, i) => ({
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
  it('active=7, max=5, 降级 2 个最低分的', async () => {
    const activeProjects = Array.from({ length: 7 }, (_, i) => ({
      id: `active-${i}`, name: `Active ${i}`,
      priority: i < 5 ? 'P0' : 'P2', // 最后 2 个是 P2 低优先级
      created_at: '2026-02-20',
      updated_at: new Date(Date.now() - 600_000).toISOString(), // 超过 cooldown
      user_pinned: null,
    }));
    const pool = makeMockPool({ activeProjects });

    const result = await manageProjectActivation(pool, cap);

    expect(result.deactivated).toBe(2);
  });

  it('pinned 的 project 不会被降级', async () => {
    const activeProjects = Array.from({ length: 7 }, (_, i) => ({
      id: `active-${i}`, name: `Active ${i}`,
      priority: 'P2', // 全是低优先级
      created_at: '2026-02-20',
      updated_at: new Date(Date.now() - 600_000).toISOString(),
      user_pinned: i < 3 ? 'true' : null, // 前 3 个 pinned
    }));
    const pool = makeMockPool({ activeProjects });

    const result = await manageProjectActivation(pool, cap);

    // 只能降级 4 个非 pinned 中的 2 个
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
      },
    ];
    const pool = makeMockPool({ activeProjects: [], candidates });

    const result = await manageProjectActivation(pool, cap);

    // cooldown 内的不选，所以 0
    expect(result.activated).toBe(0);
  });
});
