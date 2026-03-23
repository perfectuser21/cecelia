/**
 * kr-completion.js 单元测试
 *
 * 覆盖 checkKRCompletion 和 activateNextKRs 函数
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkKRCompletion, activateNextKRs } from '../kr-completion.js';

// 创建 mock pool 工厂
function makePool(queryResponses) {
  let callIndex = 0;
  return {
    query: vi.fn(async () => {
      const resp = queryResponses[callIndex++];
      return resp;
    }),
  };
}

describe('kr-completion', () => {
  describe('checkKRCompletion', () => {
    it('KR 下所有 Project 已完成时，应将 KR 标记为 completed', async () => {
      const pool = makePool([
        // 查询 in_progress KR
        { rows: [{ id: 'kr-001', title: 'Test KR' }] },
        // 查询该 KR 下 Project 完成情况 — 全部完成
        { rows: [{ total: '2', completed_count: '2' }] },
        // UPDATE goals 状态
        { rows: [] },
        // INSERT cecelia_events
        { rows: [] },
      ]);

      const result = await checkKRCompletion(pool);
      expect(result.closedCount).toBe(1);
      expect(result.closed[0].id).toBe('kr-001');
    });

    it('KR 下 Project 未全部完成时，不应关闭 KR', async () => {
      const pool = makePool([
        // 查询 in_progress KR
        { rows: [{ id: 'kr-001', title: 'Test KR' }] },
        // 查询该 KR 下 Project 完成情况 — 部分完成
        { rows: [{ total: '3', completed_count: '1' }] },
      ]);

      const result = await checkKRCompletion(pool);
      expect(result.closedCount).toBe(0);
      expect(result.closed).toHaveLength(0);
    });

    it('没有 in_progress KR 时，返回空结果', async () => {
      const pool = makePool([
        { rows: [] }, // 无 in_progress KR
      ]);

      const result = await checkKRCompletion(pool);
      expect(result.closedCount).toBe(0);
      expect(result.closed).toHaveLength(0);
    });
  });

  describe('activateNextKRs', () => {
    it('有可用容量时，应将 pending KR 激活', async () => {
      const pool = makePool([
        // 查询当前 in_progress KR 数量
        { rows: [{ cnt: '2' }] },
        // UPDATE pending → in_progress，激活 2 个
        { rows: [{ id: 'kr-002', title: 'KR 2' }, { id: 'kr-003', title: 'KR 3' }], rowCount: 2 },
        // INSERT cecelia_events
        { rows: [] },
      ]);

      const activated = await activateNextKRs(pool);
      expect(activated).toBe(2);
    });

    it('达到容量上限时，不激活任何 KR', async () => {
      const pool = makePool([
        // 查询当前 in_progress KR 数量 — 已达上限
        { rows: [{ cnt: '6' }] },
      ]);

      const activated = await activateNextKRs(pool);
      expect(activated).toBe(0);
    });
  });
});
