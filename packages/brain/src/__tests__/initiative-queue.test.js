/**
 * Initiative 队列管理测试
 * DoD: Q1-Q4（activateNextInitiatives）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activateNextInitiatives, MAX_ACTIVE_INITIATIVES } from '../initiative-closer.js';

// ────────────────────────────────────────────────────────────────────────────
// 工具函数：构造 mock pool
// ────────────────────────────────────────────────────────────────────────────

/**
 * 构造 mock pool 用于 activateNextInitiatives 测试。
 *
 * @param {number} currentActiveCount - 当前 active initiative 数量
 * @param {Array<{id, name}>} pendingInitiatives - pending 列表（按优先级排序）
 */
function makeMockPool(currentActiveCount = 0, pendingInitiatives = []) {
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查当前 active initiative 数量（包含 active + in_progress）
      if (
        s.includes("type = 'initiative'") &&
        (s.includes("status IN ('active', 'in_progress')") || s.includes("status = 'active'")) &&
        s.includes('COUNT(*)')
      ) {
        return { rows: [{ cnt: String(currentActiveCount) }] };
      }

      // UPDATE projects SET status='active'...RETURNING id, name
      if (
        s.includes('UPDATE projects') &&
        s.includes("status = 'active'") &&
        s.includes('RETURNING id, name')
      ) {
        const limit = params?.[0] ?? pendingInitiatives.length;
        const toActivate = pendingInitiatives.slice(0, limit);
        return {
          rows: toActivate,
          rowCount: toActivate.length,
        };
      }

      // INSERT INTO cecelia_events（激活事件）
      if (s.includes('cecelia_events') && s.includes('initiatives_activated')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Q1: pending initiative 少于 MAX 时，自动激活到上限
// ────────────────────────────────────────────────────────────────────────────
describe('Q1: pending 少于 MAX 时激活到上限', () => {
  it('当前 active=5，pending=3，应激活 3 个', async () => {
    const pending = [
      { id: 'init-001', name: 'Initiative A' },
      { id: 'init-002', name: 'Initiative B' },
      { id: 'init-003', name: 'Initiative C' },
    ];
    const pool = makeMockPool(5, pending);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(3);
  });

  it('当前 active=0，pending=9，应激活 9 个（等于 MAX）', async () => {
    const pending = Array.from({ length: 9 }, (_, i) => ({
      id: `init-${i}`,
      name: `Initiative ${i}`,
    }));
    const pool = makeMockPool(0, pending);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(9);
  });

  it('当前 active=7，pending=5，应激活 2 个（剩余空位 9-7=2）', async () => {
    const pending = Array.from({ length: 5 }, (_, i) => ({
      id: `init-${i}`,
      name: `Initiative ${i}`,
    }));
    const pool = makeMockPool(7, pending);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(2);
  });

  it('激活后记录 cecelia_events', async () => {
    const pending = [{ id: 'init-evt', name: 'Event Test Initiative' }];
    const pool = makeMockPool(5, pending);

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasEvent = calls.some(
      s => s.includes('cecelia_events') && s.includes('initiatives_activated')
    );
    expect(hasEvent).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Q2: 已有 MAX_ACTIVE_INITIATIVES 个 active → 不激活新的
// ────────────────────────────────────────────────────────────────────────────
describe('Q2: 已达 MAX 时不激活新的', () => {
  it('当前 active=9，返回 0，不调用 UPDATE', async () => {
    const pending = [{ id: 'init-extra', name: 'Extra Initiative' }];
    const pool = makeMockPool(MAX_ACTIVE_INITIATIVES, pending);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);

    // 不应调用 UPDATE
    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects'));
    expect(hasUpdate).toBe(false);
  });

  it('当前 active 超过 MAX（边界情况），返回 0', async () => {
    const pool = makeMockPool(MAX_ACTIVE_INITIATIVES + 5, []);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Q3: 激活顺序：P0 KR 的 initiative 先于 P1 的
// ────────────────────────────────────────────────────────────────────────────
describe('Q3: 按 KR 优先级激活', () => {
  it('SQL 中 ORDER BY 包含 P0/P1/P2 优先级排序', async () => {
    const pending = [
      { id: 'init-p0', name: 'P0 Initiative' },
      { id: 'init-p1', name: 'P1 Initiative' },
    ];
    const pool = makeMockPool(0, pending);

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const updateCall = calls.find(
      s => s.includes('UPDATE projects') && s.includes("status = 'active'")
    );
    expect(updateCall).toBeDefined();
    // 验证包含 P0/P1/P2 优先级排序
    expect(updateCall).toContain("WHEN 'P0' THEN 0");
    expect(updateCall).toContain("WHEN 'P1' THEN 1");
    expect(updateCall).toContain("WHEN 'P2' THEN 2");
    // 验证按创建时间二级排序
    expect(updateCall).toContain('created_at ASC');
  });

  it('SQL 查询从 goals 表关联获取 priority', async () => {
    const pending = [{ id: 'init-join', name: 'Join Test' }];
    const pool = makeMockPool(0, pending);

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const updateCall = calls.find(
      s => s.includes('UPDATE projects') && s.includes("status = 'active'")
    );
    expect(updateCall).toBeDefined();
    // 验证通过 LEFT JOIN goals 获取优先级
    expect(updateCall).toContain('LEFT JOIN goals');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Q4: 没有 pending → 返回 0，不报错
// ────────────────────────────────────────────────────────────────────────────
describe('Q4: 没有 pending 时安全返回', () => {
  it('pending 列表为空时返回 0', async () => {
    const pool = makeMockPool(5, []);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });

  it('pending 为空时不调用 cecelia_events INSERT', async () => {
    const pool = makeMockPool(5, []);

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasEvent = calls.some(s => s.includes('initiatives_activated'));
    expect(hasEvent).toBe(false);
  });

  it('active=0 且 pending=0 时返回 0', async () => {
    const pool = makeMockPool(0, []);

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Q5: checkInitiativeCompletion 返回 activatedCount
// ────────────────────────────────────────────────────────────────────────────
describe('Q5: checkInitiativeCompletion 完成后返回 activatedCount', () => {
  it('关闭 initiative 后应包含 activatedCount 字段', async () => {
    // 构造特殊 mock pool，支持 checkInitiativeCompletion 的所有查询
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const s = sql.trim();

        // 查 in_progress initiatives
        if (s.includes("status = 'in_progress'") && s.includes("type = 'initiative'")) {
          return { rows: [{ id: 'init-close-001', name: 'Closing Initiative' }] };
        }

        // 查 tasks 统计（满足关闭条件）
        if (s.includes('COUNT(*)') && s.includes('FROM tasks') && s.includes('project_id = $1')) {
          return {
            rows: [{ total: '3', queued: '0', in_progress: '0' }],
          };
        }

        // UPDATE projects SET completed
        if (s.includes('UPDATE projects') && s.includes("status = 'completed'")) {
          return { rows: [] };
        }

        // INSERT initiative_completed
        if (s.includes('initiative_completed')) {
          return { rows: [] };
        }

        // activateNextInitiatives - 查当前 active 数量（包含 active + in_progress）
        if (s.includes('COUNT(*)') && (s.includes("status IN ('active', 'in_progress')") || s.includes("status = 'active'"))) {
          return { rows: [{ cnt: '5' }] };
        }

        // activateNextInitiatives - UPDATE projects active + RETURNING
        if (
          s.includes('UPDATE projects') &&
          s.includes("status = 'active'") &&
          s.includes('RETURNING id, name')
        ) {
          return { rows: [{ id: 'init-new', name: 'New Initiative' }], rowCount: 1 };
        }

        // INSERT initiatives_activated
        if (s.includes('initiatives_activated')) {
          return { rows: [] };
        }

        return { rows: [], rowCount: 0 };
      }),
    };

    const { checkInitiativeCompletion } = await import('../initiative-closer.js');
    const result = await checkInitiativeCompletion(mockPool);

    expect(result.closedCount).toBe(1);
    expect(result.activatedCount).toBeDefined();
    expect(result.activatedCount).toBeGreaterThanOrEqual(0);
  });

  it('没有关闭的 initiative 时 activatedCount=0', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const s = sql.trim();
        if (s.includes("status = 'in_progress'") && s.includes("type = 'initiative'")) {
          return { rows: [] }; // 没有 in_progress
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const { checkInitiativeCompletion } = await import('../initiative-closer.js');
    const result = await checkInitiativeCompletion(mockPool);

    expect(result.closedCount).toBe(0);
    expect(result.activatedCount).toBe(0);
  });
});
