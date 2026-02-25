/**
 * decomp-checker-dedup-fix.test.js
 *
 * 回归测试：修复 hasExistingDecompositionTaskByProject 24h dedup 窗口
 * 导致队列永久停跑的 bug。
 *
 * 核心场景：
 *   decomp 任务 completed（24h 内）
 *   + 拆解出的所有 tasks 也 completed
 *   → hasActiveDecompositionTaskByProject() 应返回 false（允许补货）
 *   → hasExistingDecompositionTaskByProject() 应返回 true（24h dedup 仍生效）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import {
  hasExistingDecompositionTaskByProject,
  hasActiveDecompositionTaskByProject,
} from '../decomposition-checker.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let cleanupGoalIds = [];
let cleanupProjectIds = [];
let cleanupTaskIds = [];

async function createKr(title = 'Test KR dedup fix') {
  const r = await pool.query(
    "INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, 'kr', 'P1', 'pending', 0) RETURNING id",
    [title]
  );
  cleanupGoalIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function createInitiative(name, krId) {
  const r = await pool.query(
    `INSERT INTO projects (name, type, status, kr_id) VALUES ($1, 'initiative', 'active', $2) RETURNING id`,
    [name, krId]
  );
  cleanupProjectIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function createDecompTask(initiativeId, krId, { status = 'queued', completedAgo = null } = {}) {
  const payload = JSON.stringify({ decomposition: 'true', level: 'initiative' });
  let completedAt = null;
  if (completedAgo !== null) {
    completedAt = new Date(Date.now() - completedAgo * 1000).toISOString();
  }
  const r = await pool.query(
    `INSERT INTO tasks (title, status, priority, goal_id, project_id, task_type, payload, completed_at)
     VALUES ($1, $2, 'P0', $3, $4, 'dev', $5, $6) RETURNING id`,
    [`Initiative 拆解: Test-${Date.now()}`, status, krId, initiativeId, payload, completedAt]
  );
  cleanupTaskIds.push(r.rows[0].id);
  return r.rows[0].id;
}

beforeAll(async () => {
  await pool.query('SELECT 1'); // 确认连接
});

afterAll(async () => {
  // 清理测试数据
  if (cleanupTaskIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [cleanupTaskIds]);
  }
  if (cleanupProjectIds.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [cleanupProjectIds]);
  }
  if (cleanupGoalIds.length > 0) {
    await pool.query('DELETE FROM goals WHERE id = ANY($1::uuid[])', [cleanupGoalIds]);
  }
  await pool.end();
});

describe('hasActiveDecompositionTaskByProject', () => {
  it('queued decomp 任务 → 返回 true（阻止重复补货）', async () => {
    const krId = await createKr('KR dedup active queued');
    const initId = await createInitiative('I: active queued test', krId);
    await createDecompTask(initId, krId, { status: 'queued' });

    const result = await hasActiveDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(true);
  });

  it('in_progress decomp 任务 → 返回 true（阻止重复补货）', async () => {
    const krId = await createKr('KR dedup active in_progress');
    const initId = await createInitiative('I: active in_progress test', krId);
    await createDecompTask(initId, krId, { status: 'in_progress' });

    const result = await hasActiveDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(true);
  });

  it('completed decomp 任务（1小时前）→ 返回 false（允许补货，核心回归点）', async () => {
    const krId = await createKr('KR dedup active completed 1h');
    const initId = await createInitiative('I: completed 1h test', krId);
    await createDecompTask(initId, krId, { status: 'completed', completedAgo: 3600 });

    const result = await hasActiveDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(false); // ← 关键：completed 不阻塞
  });

  it('completed decomp 任务（12小时前）→ 返回 false（允许补货）', async () => {
    const krId = await createKr('KR dedup active completed 12h');
    const initId = await createInitiative('I: completed 12h test', krId);
    await createDecompTask(initId, krId, { status: 'completed', completedAgo: 12 * 3600 });

    const result = await hasActiveDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(false);
  });

  it('无任何 decomp 任务 → 返回 false', async () => {
    const krId = await createKr('KR dedup active no tasks');
    const initId = await createInitiative('I: no decomp tasks', krId);

    const result = await hasActiveDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(false);
  });
});

describe('hasExistingDecompositionTaskByProject（回归：旧函数行为不变）', () => {
  it('queued → 返回 true', async () => {
    const krId = await createKr('KR dedup existing queued');
    const initId = await createInitiative('I: existing queued', krId);
    await createDecompTask(initId, krId, { status: 'queued' });

    const result = await hasExistingDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(true);
  });

  it('completed（1小时前）→ 返回 true（24h dedup 窗口仍生效）', async () => {
    const krId = await createKr('KR dedup existing completed');
    const initId = await createInitiative('I: existing completed', krId);
    await createDecompTask(initId, krId, { status: 'completed', completedAgo: 3600 });

    const result = await hasExistingDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(true); // 旧函数仍阻塞
  });

  it('canceled → 返回 true', async () => {
    const krId = await createKr('KR dedup existing canceled');
    const initId = await createInitiative('I: existing canceled', krId);
    await createDecompTask(initId, krId, { status: 'canceled' });

    const result = await hasExistingDecompositionTaskByProject(initId, 'initiative');
    expect(result).toBe(true);
  });
});
