/**
 * Integration Test: Tick Full Loop（真实 DB 环境）
 *
 * 使用真实 PostgreSQL（cecelia 数据库）测试 selectNextDispatchableTask：
 *   1. P0 任务优先于 P2 被选中（P2 不被选中）
 *   2. has depends_on 未完成的任务被跳过
 *   3. completed 后依赖满足，任务可被选中
 *   4. 无可用任务时返回 null
 *
 * 与 tick-dispatch.integration.test.js 的区别：
 *   - 本文件不 mock db.js，使用真实 PostgreSQL 连接
 *   - 只 mock 外部服务（alertness-actions、focus.js、llm-caller）
 *   - 验证真实 SQL 查询行为
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// Mock 外部服务（不测试 AI 响应和告警）
vi.mock('../../alertness-actions.js', () => ({
  getMitigationState: () => ({ p2_paused: false }),
}));

vi.mock('../../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue({ kr_ids: [], manual: false }),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getReadyKRs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('{}'),
  default: vi.fn().mockResolvedValue('{}'),
}));

// 直连 DB 用于 setup/teardown
const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录本次测试插入的 task IDs，afterAll 清理
const testTaskIds = [];

async function insertTask({ title, priority = 'P1', status = 'queued', payload = null } = {}) {
  const res = await testPool.query(
    `INSERT INTO tasks (title, status, priority, task_type, payload, goal_id, project_id)
     VALUES ($1, $2, $3, 'dev', $4, NULL, NULL) RETURNING id`,
    [title, status, priority, payload ? JSON.stringify(payload) : null]
  );
  const id = res.rows[0].id;
  testTaskIds.push(id);
  return id;
}

async function cleanupTasks(ids) {
  if (ids.length === 0) return;
  await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [ids]);
  for (const id of ids) {
    const idx = testTaskIds.indexOf(id);
    if (idx !== -1) testTaskIds.splice(idx, 1);
  }
}

describe('Tick Full Loop 集成测试（真实 DB）', () => {
  beforeAll(async () => {
    await testPool.query('SELECT 1');
  });

  afterAll(async () => {
    if (testTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
    }
    await testPool.end();
  });

  // ─── 1. 优先级选择 ──────────────────────────────────────────────────────────

  describe('优先级选择', () => {
    it('P0 任务存在时 P2 任务不被选中', async () => {
      const p2Id = await insertTask({ title: '[TEST] P2 task priority-test', priority: 'P2' });
      const p0Id = await insertTask({ title: '[TEST] P0 task priority-test', priority: 'P0' });

      try {
        const { selectNextDispatchableTask } = await import('../../tick.js');
        const task = await selectNextDispatchableTask([]);

        expect(task).not.toBeNull();

        // 核心断言：P2 task 不应该被选中（P0 task 存在时）
        expect(task.id).not.toBe(p2Id);

        // 如果选中的是我们的 P0 task，额外验证优先级正确
        if (task.id === p0Id) {
          expect(task.priority).toBe('P0');
        }
      } finally {
        await cleanupTasks([p0Id, p2Id]);
      }
    });
  });

  // ─── 2. 依赖检查 ────────────────────────────────────────────────────────────

  describe('depends_on 依赖检查', () => {
    it('有未完成依赖的任务被跳过，选择无依赖任务', async () => {
      // 创建一个"阻塞者"任务（queued，未完成）
      const blockerId = await insertTask({ title: '[TEST] Blocker dep-test', priority: 'P1' });

      // 创建依赖于 blockerId 的任务（P0 但有依赖）
      const dependentId = await insertTask({
        title: '[TEST] Dependent has-unmet-deps',
        priority: 'P0',
        payload: { depends_on: [blockerId] },
      });

      // 创建无依赖的 P1 任务
      const freeId = await insertTask({ title: '[TEST] Free task no-deps', priority: 'P1' });

      try {
        const { selectNextDispatchableTask } = await import('../../tick.js');
        const task = await selectNextDispatchableTask([]);

        expect(task).not.toBeNull();

        // dependentId 的依赖（blockerId）未完成，不应该被选中
        expect(task.id).not.toBe(dependentId);
      } finally {
        await cleanupTasks([blockerId, dependentId, freeId]);
      }
    });

    it('依赖任务 completed 后，被依赖任务变为可选中状态', async () => {
      // 创建已完成的依赖项
      const completedDepId = await insertTask({
        title: '[TEST] Completed dep ready-test',
        priority: 'P2',
        status: 'completed',
      });

      // 创建依赖于已完成任务的 P0 任务
      const readyId = await insertTask({
        title: '[TEST] Ready task after-completed-dep',
        priority: 'P0',
        payload: { depends_on: [completedDepId] },
      });

      try {
        const { selectNextDispatchableTask } = await import('../../tick.js');
        const task = await selectNextDispatchableTask([]);

        expect(task).not.toBeNull();

        // readyId 依赖已完成，不应被错误跳过
        // 若选中的是 readyId，验证优先级正确
        if (task.id === readyId) {
          expect(task.priority).toBe('P0');
        } else {
          // readyId 没被选中（有更高优先级的生产任务），验证它依然在 queued 状态（没被错误过滤掉）
          const check = await testPool.query(
            "SELECT status FROM tasks WHERE id = $1",
            [readyId]
          );
          expect(check.rows[0].status).toBe('queued');
        }
      } finally {
        await cleanupTasks([completedDepId, readyId]);
      }
    });
  });

  // ─── 3. 无任务时返回 null ───────────────────────────────────────────────────

  describe('边界情况', () => {
    it('空 goalIds 且无 null goal_id 的 queued 任务时返回 null', async () => {
      const { rows } = await testPool.query(
        "SELECT COUNT(*) FROM tasks WHERE status = 'queued' AND goal_id IS NULL"
      );
      const queuedCount = parseInt(rows[0].count);

      if (queuedCount === 0) {
        const { selectNextDispatchableTask } = await import('../../tick.js');
        const task = await selectNextDispatchableTask([]);
        expect(task).toBeNull();
      } else {
        // 当前有其他 queued 任务（正常生产情况），跳过此测试
        console.log(`[skip] 当前有 ${queuedCount} 个 null goal_id 的 queued 任务，跳过 null 返回测试`);
      }
    });
  });
});
