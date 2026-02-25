/**
 * Review Gate Unit Tests
 *
 * DoD 覆盖: D1-D7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js 以避免真实数据库连接
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock task-router.js
vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'hk'),
}));

import { shouldTriggerReview, createReviewTask, processReviewResult } from '../review-gate.js';

function makeMockPool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe('shouldTriggerReview', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D1: entity 有拆解产出且无 pending review → 返回 true', async () => {
    pool.query = vi.fn(async (sql) => {
      // 1. 检查子实体 - Project 有 Initiative 子实体
      if (sql.includes('parent_id') && sql.includes('initiative')) {
        return { rows: [{ id: 'child-1' }] };
      }
      // 2. 检查 pending review
      if (sql.includes('decomp_reviews')) {
        return { rows: [] };
      }
      // 3. 检查 active decomp_review task
      if (sql.includes('decomp_review') && sql.includes('tasks')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await shouldTriggerReview(pool, 'project', 'proj-1');
    expect(result).toBe(true);
  });

  it('D2: 已有 pending review → 返回 false', async () => {
    pool.query = vi.fn(async (sql) => {
      // 有子实体
      if (sql.includes('parent_id') && sql.includes('initiative')) {
        return { rows: [{ id: 'child-1' }] };
      }
      // 有 pending review
      if (sql.includes('decomp_reviews')) {
        return { rows: [{ id: 'review-1' }] };
      }
      return { rows: [] };
    });

    const result = await shouldTriggerReview(pool, 'project', 'proj-1');
    expect(result).toBe(false);
  });

  it('无拆解产出 → 返回 false', async () => {
    pool.query = vi.fn(async () => ({ rows: [] }));
    const result = await shouldTriggerReview(pool, 'project', 'proj-1');
    expect(result).toBe(false);
  });

  it('空参数 → 返回 false', async () => {
    const result = await shouldTriggerReview(pool, null, null);
    expect(result).toBe(false);
  });

  it('initiative 类型 - 有 tasks 子实体且无 pending → 返回 true', async () => {
    pool.query = vi.fn(async (sql) => {
      // Initiative 的子实体是 Task
      if (sql.includes('project_id') && !sql.includes('decomp_reviews') && !sql.includes('decomp_review')) {
        return { rows: [{ id: 'task-1' }] };
      }
      // 无 pending review
      if (sql.includes('decomp_reviews')) {
        return { rows: [] };
      }
      // 无 active decomp_review task
      if (sql.includes('decomp_review') && sql.includes('tasks')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await shouldTriggerReview(pool, 'initiative', 'init-1');
    expect(result).toBe(true);
  });

  it('已有 active decomp_review task → 返回 false', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('parent_id') && sql.includes('initiative')) {
        return { rows: [{ id: 'child-1' }] };
      }
      if (sql.includes('decomp_reviews')) {
        return { rows: [] };
      }
      // 有 active decomp_review task
      if (sql.includes('decomp_review') && sql.includes('tasks')) {
        return { rows: [{ id: 'task-1' }] };
      }
      return { rows: [] };
    });

    const result = await shouldTriggerReview(pool, 'project', 'proj-1');
    expect(result).toBe(false);
  });
});

describe('createReviewTask', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D3: 创建 task_type=decomp_review 路由到 HK', async () => {
    const insertCalls = [];
    pool.query = vi.fn(async (sql, params) => {
      // 收集子实体信息
      if (sql.includes('parent_id') && sql.includes('initiative')) {
        return { rows: [{ name: 'Init 1', status: 'active' }] };
      }
      // 创建 review 记录
      if (sql.includes('INSERT INTO decomp_reviews')) {
        return { rows: [{ id: 'review-uuid' }] };
      }
      // 创建 task
      if (sql.includes('INSERT INTO tasks')) {
        insertCalls.push({ sql, params });
        return { rows: [{ id: 'task-uuid', title: '拆解审查: Test Project' }] };
      }
      // 回填 task_id
      if (sql.includes('UPDATE decomp_reviews')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await createReviewTask(pool, {
      entityType: 'project',
      entityId: 'proj-1',
      entityName: 'Test Project',
      parentKrId: 'kr-1',
    });

    expect(result.task.id).toBe('task-uuid');
    expect(result.review.entity_type).toBe('project');

    // 验证 task 插入参数
    const taskInsert = insertCalls.find(c => c.sql.includes('INSERT INTO tasks'));
    expect(taskInsert).toBeDefined();
    expect(taskInsert.params[0]).toBe('拆解审查: Test Project');
    // task_type='decomp_review' 硬编码在 SQL 中
    expect(taskInsert.sql).toContain('decomp_review');
    // payload 应包含 routing: hk
    const payload = JSON.parse(taskInsert.params[3]);
    expect(payload.routing).toBe('hk');
    expect(payload.entity_type).toBe('project');
    expect(payload.entity_id).toBe('proj-1');
  });

  it('D4: 插入 decomp_reviews 记录', async () => {
    let reviewInserted = false;
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('parent_id') && sql.includes('initiative')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO decomp_reviews')) {
        reviewInserted = true;
        return { rows: [{ id: 'review-uuid' }] };
      }
      if (sql.includes('INSERT INTO tasks')) {
        return { rows: [{ id: 'task-uuid', title: '拆解审查: Test' }] };
      }
      if (sql.includes('UPDATE decomp_reviews')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await createReviewTask(pool, {
      entityType: 'initiative',
      entityId: 'init-1',
      entityName: 'Test Initiative',
      parentKrId: 'kr-1',
    });

    expect(reviewInserted).toBe(true);
  });
});

describe('processReviewResult', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D5: verdict=approved → 激活实体', async () => {
    let activatedEntity = false;
    pool.query = vi.fn(async (sql, params) => {
      // 查找 review 记录
      if (sql.includes('SELECT') && sql.includes('decomp_reviews') && sql.includes('task_id')) {
        return { rows: [{ id: 'review-1', entity_type: 'project', entity_id: 'proj-1' }] };
      }
      // 更新 review verdict
      if (sql.includes('UPDATE decomp_reviews') && sql.includes('verdict')) {
        return { rows: [] };
      }
      // 激活实体
      if (sql.includes('UPDATE projects') && sql.includes("'active'") && sql.includes("'pending_review'")) {
        activatedEntity = true;
        return { rows: [] };
      }
      return { rows: [] };
    });

    await processReviewResult(pool, 'task-1', 'approved', { quality: 'good' });
    expect(activatedEntity).toBe(true);
  });

  it('D6: verdict=needs_revision → 创建修正 decomp task', async () => {
    let revisionTaskCreated = false;
    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('SELECT') && sql.includes('decomp_reviews') && sql.includes('task_id')) {
        return { rows: [{ id: 'review-1', entity_type: 'project', entity_id: 'proj-1' }] };
      }
      if (sql.includes('UPDATE decomp_reviews') && sql.includes('verdict')) {
        return { rows: [] };
      }
      // 查询实体名称
      if (sql.includes('SELECT') && sql.includes('name') && sql.includes('parent_id') && !sql.includes('initiative') && !sql.includes('decomp_reviews')) {
        return { rows: [{ name: 'Test Project', parent_id: 'parent-1' }] };
      }
      // 查询 KR
      if (sql.includes('project_kr_links')) {
        return { rows: [{ kr_id: 'kr-1' }] };
      }
      // 创建修正 task（title 在 params 中，不在 SQL 中）
      if (sql.includes('INSERT INTO tasks')) {
        revisionTaskCreated = true;
        return { rows: [{ id: 'revision-task', title: '修正拆解: Test Project' }] };
      }
      return { rows: [] };
    });

    await processReviewResult(pool, 'task-1', 'needs_revision', { issue: 'too coarse' });
    expect(revisionTaskCreated).toBe(true);
  });

  it('D7: verdict=rejected → 标记实体 blocked', async () => {
    let entityBlocked = false;
    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('SELECT') && sql.includes('decomp_reviews') && sql.includes('task_id')) {
        return { rows: [{ id: 'review-1', entity_type: 'project', entity_id: 'proj-1' }] };
      }
      if (sql.includes('UPDATE decomp_reviews') && sql.includes('verdict')) {
        return { rows: [] };
      }
      // 标记 blocked
      if (sql.includes('UPDATE projects') && sql.includes("'blocked'")) {
        entityBlocked = true;
        return { rows: [] };
      }
      return { rows: [] };
    });

    await processReviewResult(pool, 'task-1', 'rejected', { reason: 'completely wrong' });
    expect(entityBlocked).toBe(true);
  });

  it('无 review 记录 → 静默退出', async () => {
    pool.query = vi.fn(async () => ({ rows: [] }));

    // 不应该抛错
    await processReviewResult(pool, 'nonexistent-task', 'approved', {});
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
