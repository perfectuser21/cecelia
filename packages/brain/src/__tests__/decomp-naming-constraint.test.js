/**
 * decomp-naming-constraint.test.js
 *
 * RCI: decomp-checker.naming-constraint.check4 / check5
 *
 * 验证 decomposition-checker.js 的 Check 4 (KR-Project 关联) 和
 * Check 5 (Project 拆解) 任务描述中包含正确的命名规范约束。
 *
 * 防止 Brain 自动拆解时创建：
 * - 使用 "I1:", "KR3-I1:" 等 Initiative 编号前缀的 Project
 * - 与 KR 同名的容器 Project
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import {
  checkAreaKrProjectLink,
  checkProjectDecomposition,
} from '../decomposition-checker.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let cleanupGoalIds = [];
let cleanupProjectIds = [];
let cleanupTaskIds = [];

async function createAreaOkr(title = 'Test Area OKR') {
  const r = await pool.query(
    "INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, 'area_okr', 'P1', 'pending', 0) RETURNING id",
    [title]
  );
  cleanupGoalIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function createKr(title, parentId) {
  const r = await pool.query(
    "INSERT INTO goals (title, type, priority, status, progress, parent_id) VALUES ($1, 'kr', 'P1', 'pending', 0, $2) RETURNING id",
    [title, parentId]
  );
  cleanupGoalIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function createProject(name, { type = 'project', parentId = null } = {}) {
  const r = await pool.query(
    `INSERT INTO projects (name, type, status, parent_id) VALUES ($1, $2, 'active', $3) RETURNING id`,
    [name, type, parentId]
  );
  cleanupProjectIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function linkProjectKr(projectId, krId) {
  await pool.query(
    'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [projectId, krId]
  );
}

beforeAll(async () => {
  await pool.query('SELECT 1'); // warm up
});

afterAll(async () => {
  // 清理测试数据（逆序）
  if (cleanupTaskIds.length) {
    await pool.query(`DELETE FROM tasks WHERE id = ANY($1)`, [cleanupTaskIds]);
  }
  if (cleanupProjectIds.length) {
    await pool.query(`DELETE FROM project_kr_links WHERE project_id = ANY($1)`, [cleanupProjectIds]);
    await pool.query(`DELETE FROM projects WHERE id = ANY($1)`, [cleanupProjectIds]);
  }
  if (cleanupGoalIds.length) {
    await pool.query(`DELETE FROM goals WHERE id = ANY($1)`, [cleanupGoalIds]);
  }
  await pool.end();
});

// ─────────────────────────────────────────────
// Check 4: KR-Project 关联 命名约束
// ─────────────────────────────────────────────

describe('Check 4 (KR-Project 关联) description 命名约束', () => {
  it('Check 4 description 应禁止 Initiative 编号前缀（I1:、KR3-I1: 等）', async () => {
    const areaId = await createAreaOkr('Test Area OKR for naming');
    const krId = await createKr('Test KR for Project naming', areaId);

    const actions = await checkAreaKrProjectLink();

    // 找到本次创建的 task
    const action = actions.find(a => a.check === 'area_kr_project_link');
    if (!action) return; // 如果没有生成（KR 已有 project），跳过

    const taskRow = await pool.query('SELECT description FROM tasks WHERE id = $1', [action.task_id]);
    cleanupTaskIds.push(action.task_id);
    const desc = taskRow.rows[0]?.description ?? '';

    expect(desc).toContain('禁止使用 Initiative 编号前缀');
    expect(desc).toContain('I1:');
    expect(desc).toContain('KR3-I1:');
  });

  it('Check 4 description 应禁止创建与 KR 同名的容器 Project', async () => {
    // 检查最近创建的 KR-Project 关联任务的 description
    const taskRow = await pool.query(`
      SELECT description FROM tasks
      WHERE title LIKE 'KR-Project 关联:%'
        AND status = 'queued'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!taskRow.rows.length) return; // 无活跃任务则跳过

    const desc = taskRow.rows[0].description;
    expect(desc).toContain('禁止创建与 KR 同名的容器 Project');
    expect(desc).toContain('1-2 周');
  });

  it('Check 4 description 应包含时间验证（1-2 周）', async () => {
    const taskRow = await pool.query(`
      SELECT description FROM tasks
      WHERE title LIKE 'KR-Project 关联:%'
        AND status = 'queued'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!taskRow.rows.length) return;

    const desc = taskRow.rows[0].description;
    expect(desc).toContain('1-2 周');
  });
});

// ─────────────────────────────────────────────
// Check 5: Project 拆解 命名约束
// ─────────────────────────────────────────────

describe('Check 5 (Project 拆解) description 命名约束', () => {
  it('Check 5 description 应说明 Initiative 可用 I1/I2/I3 编号前缀', async () => {
    const taskRow = await pool.query(`
      SELECT description FROM tasks
      WHERE title LIKE 'Project 拆解:%'
        AND status = 'queued'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!taskRow.rows.length) return;

    const desc = taskRow.rows[0].description;
    expect(desc).toContain('I1/I2/I3');
    expect(desc).toContain('1-3 小时');
  });

  it('Check 5 description 应说明 Initiative 时间范围（1-3 小时，7-15 个 Task）', async () => {
    const taskRow = await pool.query(`
      SELECT description FROM tasks
      WHERE title LIKE 'Project 拆解:%'
        AND status = 'queued'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!taskRow.rows.length) return;

    const desc = taskRow.rows[0].description;
    expect(desc).toContain('7-15 个 Task');
  });
});

// ─────────────────────────────────────────────
// 静态文本验证（直接检查生成的 description 模板）
// ─────────────────────────────────────────────

describe('decomposition-checker description 静态约束文本验证', () => {
  it('checkAreaKrProjectLink 导出函数存在', async () => {
    expect(typeof checkAreaKrProjectLink).toBe('function');
  });

  it('checkProjectDecomposition 导出函数存在', async () => {
    expect(typeof checkProjectDecomposition).toBe('function');
  });

  it('decomposition-checker.js 源码包含 Project 命名禁止规则', async () => {
    // 直接读源码验证约束文本存在（不依赖 DB 状态）
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../decomposition-checker.js'), 'utf-8');

    // Check 4 约束
    expect(src).toContain('禁止使用 Initiative 编号前缀');
    expect(src).toContain('禁止创建与 KR 同名的容器 Project');
    expect(src).toContain('1-2 周的工作量');

    // Check 5 约束
    expect(src).toContain('I1/I2/I3 编号前缀');
    expect(src).toContain('1-3 小时内可完成');
    expect(src).toContain('7-15 个 Task');
  });
});
