/**
 * desire-feedback 单元测试
 *
 * 测试 updateDesireFromTask：根据任务结果回写对应欲望的状态
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDesireFromTask } from '../desire-feedback.js';

// ─── Mock Pool 工厂 ───────────────────────────────────────

function makeMockPool(taskDescription = '') {
  const queryCalls = [];
  return {
    queryCalls,
    query: vi.fn(async (sql, params) => {
      queryCalls.push({ sql, params });
      // SELECT description FROM tasks
      if (sql.includes('SELECT description FROM tasks')) {
        if (taskDescription === '__EMPTY__') {
          return { rows: [] }; // 任务不存在
        }
        return { rows: [{ description: taskDescription }] };
      }
      // UPDATE desires
      if (sql.includes('UPDATE desires')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

// ─── 测试套件 ────────────────────────────────────────────

describe('desire-feedback', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // ─── 正常路径：completed ───

  describe('outcome = completed', () => {
    it('格式1：**来源 desire ID**：xxx → 正确更新 desire 为 completed', async () => {
      const desireId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const desc = `任务描述...\n**来源 desire ID**：${desireId}\n其他内容`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-001', 'completed', pool);

      // 验证查询了 tasks 表
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT description FROM tasks'),
        ['task-001']
      );

      // 验证更新了 desires 表，status = completed，effectiveness_score = 8.0
      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'completed'");
      expect(updateCall.sql).toContain('effectiveness_score = 8.0');
      expect(updateCall.params).toEqual([desireId]);

      // 验证日志输出
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`desire ${desireId}`)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed')
      );
    });

    it('格式2：来源：好奇心信号 desire xxx → 正确提取 desire_id', async () => {
      const desireId = 'aabbccdd-1122-3344-5566-778899001122';
      const desc = `来源：好奇心信号 desire ${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-002', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'completed'");
      expect(updateCall.params).toEqual([desireId]);
    });

    it('格式3：来源：desire xxx → 正确提取 desire_id', async () => {
      const desireId = '11223344-aabb-ccdd-eeff-556677889900';
      const desc = `来源：desire ${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-003', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'completed'");
      expect(updateCall.params).toEqual([desireId]);
    });
  });

  // ─── 正常路径：failed ───

  describe('outcome = failed', () => {
    it('任务失败 → 更新 desire 为 failed，effectiveness_score = 2.0', async () => {
      const desireId = 'deadbeef-dead-beef-dead-beefdeadbeef';
      const desc = `**来源 desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-004', 'failed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'failed'");
      expect(updateCall.sql).toContain('effectiveness_score = 2.0');
      expect(updateCall.params).toEqual([desireId]);
    });

    it('格式2 + failed → 正确更新', async () => {
      const desireId = '12345678-abcd-efab-cdef-1234567890ab';
      const desc = `来源：好奇心信号 desire ${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-005', 'failed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'failed'");
      expect(updateCall.params).toEqual([desireId]);
    });
  });

  // ─── 无 desire_id 时跳过 ───

  describe('无 desire_id 时跳过（非欲望驱动任务）', () => {
    it('description 不含任何 desire 标记 → 不执行 UPDATE', async () => {
      const pool = makeMockPool('这是一个普通任务，没有 desire 关联');

      await updateDesireFromTask('task-006', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeUndefined();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('description 为空字符串 → 不执行 UPDATE', async () => {
      const pool = makeMockPool('');

      await updateDesireFromTask('task-007', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeUndefined();
    });

    it('任务不存在（rows 为空）→ description 为空 → 不执行 UPDATE', async () => {
      const pool = makeMockPool('__EMPTY__');

      await updateDesireFromTask('task-008', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeUndefined();
    });
  });

  // ─── 边界条件 ───

  describe('边界条件', () => {
    it('outcome 不是 completed 也不是 failed → 不执行 UPDATE 但输出日志', async () => {
      const desireId = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
      const desc = `**来源 desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-009', 'cancelled', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeUndefined();

      // 源码逻辑：match 不为空时，最后一行 console.log 无条件执行
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`desire ${desireId}`)
      );
    });

    it('description 含多个 desire 格式 → 匹配第一种格式', async () => {
      const desireId1 = '11111111-1111-1111-1111-111111111111';
      const desireId2 = '22222222-2222-2222-2222-222222222222';
      const desc = `**来源 desire ID**：${desireId1}\n来源：desire ${desireId2}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-010', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      // 应使用第一个匹配的 desire_id
      expect(updateCall.params).toEqual([desireId1]);
    });

    it('desire_id 大小写不敏感匹配（正则 /i 标志）', async () => {
      const desireId = 'aAbBcCdD-1122-3344-5566-778899001122';
      // 源码正则带 /i 标志
      const desc = `**来源 Desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-011', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.params).toEqual([desireId]);
    });

    it('UPDATE desires 条件包含 status = acted（只更新已执行的 desire）', async () => {
      const desireId = 'abcdef12-3456-7890-abcd-ef1234567890';
      const desc = `**来源 desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-012', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall).toBeDefined();
      expect(updateCall.sql).toContain("status = 'acted'");
    });

    it('completed 时设置 completed_at = NOW()', async () => {
      const desireId = 'abcdef12-3456-7890-abcd-ef1234567890';
      const desc = `**来源 desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-013', 'completed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall.sql).toContain('completed_at = NOW()');
    });

    it('failed 时设置 failed_at = NOW()', async () => {
      const desireId = 'abcdef12-3456-7890-abcd-ef1234567890';
      const desc = `**来源 desire ID**：${desireId}`;
      const pool = makeMockPool(desc);

      await updateDesireFromTask('task-014', 'failed', pool);

      const updateCall = pool.queryCalls.find(c => c.sql.includes('UPDATE desires'));
      expect(updateCall.sql).toContain('failed_at = NOW()');
    });
  });

  // ─── 错误路径 ───

  describe('错误路径', () => {
    it('数据库查询 tasks 抛出异常 → 异常向上传播', async () => {
      const pool = {
        query: vi.fn(async () => {
          throw new Error('数据库连接失败');
        }),
      };

      await expect(
        updateDesireFromTask('task-err', 'completed', pool)
      ).rejects.toThrow('数据库连接失败');
    });

    it('UPDATE desires 抛出异常 → 异常向上传播', async () => {
      const desireId = 'abcdef12-3456-7890-abcd-ef1234567890';
      const desc = `**来源 desire ID**：${desireId}`;
      let callCount = 0;
      const pool = {
        query: vi.fn(async (sql) => {
          callCount++;
          if (callCount === 1) {
            return { rows: [{ description: desc }] };
          }
          throw new Error('UPDATE 失败');
        }),
      };

      await expect(
        updateDesireFromTask('task-err2', 'completed', pool)
      ).rejects.toThrow('UPDATE 失败');
    });
  });
});
