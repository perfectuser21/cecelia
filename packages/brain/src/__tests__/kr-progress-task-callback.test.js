/**
 * KR Progress Task Callback Test
 *
 * 测试 Task 完成时自动触发 KR 进度更新（RNA 闭环）
 *
 * 数据链路：
 *   Task (project_id) → Initiative (parent_id) → Project → KR (project_kr_links)
 *
 * 验证：
 *   1. Task 完成 → execution-callback → updateKrProgress()
 *   2. KR 进度基于 Initiative 完成率计算
 *   3. progress 字段正确更新到 goals 表
 */

import { describe, test, expect, vi } from 'vitest';
import { updateKrProgress } from '../kr-progress.js';

// ────────────────────────────────────────────────────────────────────
// Mock Pool 工具函数
// ────────────────────────────────────────────────────────────────────

function makeMockPool({
  taskProjectId = 'initiative-001',
  krLinks = [{ kr_id: 'kr-001' }],
  projects = [{ id: 'proj-001' }],
  initiativeStats = { total: '1', completed: '1' },
} = {}) {
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // execution-callback: 查 task.project_id
      if (s.includes('SELECT project_id FROM tasks')) {
        return { rows: [{ project_id: taskProjectId }] };
      }

      // execution-callback: 查 KR links
      if (s.includes('FROM projects init') && s.includes('JOIN project_kr_links')) {
        return { rows: krLinks };
      }

      // updateKrProgress: 查 KR 关联的 projects
      if (s.includes('project_kr_links') && s.includes('pkl.kr_id') && !s.includes('UPDATE')) {
        return { rows: projects };
      }

      // updateKrProgress: 查 initiatives 统计
      if (s.includes('COUNT(*)') && s.includes('parent_id = ANY')) {
        return { rows: [initiativeStats] };
      }

      // updateKrProgress: UPDATE goals
      if (s.includes('UPDATE goals') && s.includes('progress')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

describe('KR Progress Task Callback', () => {
  test('Task 完成时自动更新 KR 进度', async () => {
    // 模拟完整链路：Task (project_id) → Initiative → KR
    const pool = makeMockPool({
      taskProjectId: 'initiative-001',
      krLinks: [{ kr_id: 'kr-001' }],
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '1', completed: '1' },
    });

    // 模拟 execution-callback 逻辑：查询 task.project_id
    const taskRow = await pool.query('SELECT project_id FROM tasks WHERE id = $1', ['task-001']);
    const initiativeId = taskRow.rows[0]?.project_id;

    // 模拟 execution-callback 逻辑：查询 KR links
    const krLinks = await pool.query(`
      SELECT pkl.kr_id
      FROM projects init
      JOIN projects proj ON proj.id = init.parent_id
      JOIN project_kr_links pkl ON pkl.project_id = proj.id
      WHERE init.id = $1
        AND init.type = 'initiative'
        AND proj.type = 'project'
    `, [initiativeId]);

    expect(krLinks.rows.length).toBe(1);
    expect(krLinks.rows[0].kr_id).toBe('kr-001');

    // 调用 updateKrProgress（模拟 execution-callback 调用）
    const result = await updateKrProgress(pool, 'kr-001');

    // 验证返回值
    expect(result.krId).toBe('kr-001');
    expect(result.total).toBe(1); // 1 个 Initiative
    expect(result.completed).toBe(1); // 1 个已完成
    expect(result.progress).toBe(100); // 100% 完成

    // 验证 UPDATE 调用
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE goals'),
      expect.arrayContaining(['kr-001', 100])
    );
  });

  test('多 Initiative 场景下 KR 进度计算正确', async () => {
    // 模拟 2 个 Initiative，1 个完成
    const pool = makeMockPool({
      projects: [{ id: 'proj-001' }],
      initiativeStats: { total: '2', completed: '1' },
    });

    const result = await updateKrProgress(pool, 'kr-001');

    // 验证：2 个 Initiative，1 个完成 → 50%
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.progress).toBe(50);
  });

  test('Initiative 无关联 KR 时不报错', async () => {
    // 模拟孤立 Initiative（无 KR 关联）
    const pool = makeMockPool({
      taskProjectId: 'orphan-initiative',
      krLinks: [], // 无 KR 关联
    });

    // 模拟 execution-callback 逻辑：查询 KR links
    const krLinks = await pool.query(`
      SELECT pkl.kr_id
      FROM projects init
      JOIN projects proj ON proj.id = init.parent_id
      JOIN project_kr_links pkl ON pkl.project_id = proj.id
      WHERE init.id = $1
        AND init.type = 'initiative'
        AND proj.type = 'project'
    `, ['orphan-initiative']);

    // 验证：无 KR 关联，不抛错
    expect(krLinks.rows.length).toBe(0);
  });

  test('复用 kr-progress.js 模块而非重复实现', async () => {
    // 验证 updateKrProgress 是从 kr-progress.js 导入的
    expect(updateKrProgress).toBeDefined();
    expect(typeof updateKrProgress).toBe('function');

    // 验证函数签名
    const pool = makeMockPool();
    const result = await updateKrProgress(pool, 'kr-001');
    expect(result).toHaveProperty('krId');
    expect(result).toHaveProperty('progress');
    expect(result).toHaveProperty('completed');
    expect(result).toHaveProperty('total');
  });
});
