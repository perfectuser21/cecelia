/**
 * planner-arch-scan.test.js
 *
 * 测试 scanInitiativesForArchDesign()：
 *   - 有 active coding initiative 且无 architecture_design 任务 → 自动创建
 *   - 已有 queued architecture_design → 跳过（幂等）
 *   - initiative 有 in_progress 任务 → 跳过
 *   - 非 coding domain（非 null）→ 跳过
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { scanInitiativesForArchDesign } from '../planner.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testProjectIds = [];
let testTaskIds = [];
let testKRIds = [];

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  if (testTaskIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]).catch(() => {});
    testTaskIds = [];
  }
  if (testProjectIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    testProjectIds = [];
  }
  if (testKRIds.length > 0) {
    await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
    testKRIds = [];
  }
});

// ──────────────────────────────────────────────────────────────────
// 主流程：有 active coding initiative 且无任何 queued task
// ──────────────────────────────────────────────────────────────────

describe('scanInitiativesForArchDesign - 主流程', () => {
  it('应为 active coding initiative（domain=coding）且无 queued 任务时自动创建 architecture_design', async () => {
    // 创建父 project
    const parentRes = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('scan-parent-project', '/tmp/scan-parent', 'active') RETURNING id"
    );
    const parentId = parentRes.rows[0].id;
    testProjectIds.push(parentId);

    // 创建 coding domain initiative（无任务）
    const initRes = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Scan Coding Initiative', 'initiative', $1, 'active', 'coding') RETURNING id",
      [parentId]
    );
    const initId = initRes.rows[0].id;
    testProjectIds.push(initId);

    const created = await scanInitiativesForArchDesign();

    // 至少创建了一个任务
    const newTaskIds = created.map(t => t.id);
    expect(created.length).toBeGreaterThanOrEqual(1);

    // 验证针对该 initiative 创建了 architecture_design 任务
    const taskRes = await pool.query(
      "SELECT id, task_type, status, project_id FROM tasks WHERE project_id = $1 AND task_type = 'architecture_design'",
      [initId]
    );
    expect(taskRes.rows.length).toBe(1);
    expect(taskRes.rows[0].status).toBe('queued');

    // 记录清理
    testTaskIds.push(...taskRes.rows.map(r => r.id));
  });

  it('应为 active initiative（domain=NULL，默认 coding）且无 queued 任务时自动创建 architecture_design', async () => {
    const parentRes = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('scan-parent-null-domain', '/tmp/scan-null', 'active') RETURNING id"
    );
    const parentId = parentRes.rows[0].id;
    testProjectIds.push(parentId);

    // domain = NULL
    const initRes = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Scan Null Domain Initiative', 'initiative', $1, 'active') RETURNING id",
      [parentId]
    );
    const initId = initRes.rows[0].id;
    testProjectIds.push(initId);

    const created = await scanInitiativesForArchDesign();

    const taskRes = await pool.query(
      "SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'architecture_design' AND status = 'queued'",
      [initId]
    );
    expect(taskRes.rows.length).toBe(1);

    testTaskIds.push(...taskRes.rows.map(r => r.id));
  });
});

// ──────────────────────────────────────────────────────────────────
// 幂等：已有 architecture_design → 跳过
// ──────────────────────────────────────────────────────────────────

describe('scanInitiativesForArchDesign - 幂等性', () => {
  it('已有 queued architecture_design 任务时不创建重复任务', async () => {
    const parentRes = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('scan-dedup-parent', '/tmp/scan-dedup', 'active') RETURNING id"
    );
    const parentId = parentRes.rows[0].id;
    testProjectIds.push(parentId);

    const initRes = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Scan Dedup Initiative', 'initiative', $1, 'active', 'coding') RETURNING id",
      [parentId]
    );
    const initId = initRes.rows[0].id;
    testProjectIds.push(initId);

    // 预先创建一个 queued architecture_design 任务
    const existingRes = await pool.query(
      "INSERT INTO tasks (title, task_type, status, priority, project_id) VALUES ('existing arch design', 'architecture_design', 'queued', 'P1', $1) RETURNING id",
      [initId]
    );
    testTaskIds.push(existingRes.rows[0].id);

    await scanInitiativesForArchDesign();

    // 仍然只有 1 个 architecture_design 任务
    const taskRes = await pool.query(
      "SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'architecture_design' AND status NOT IN ('failed', 'cancelled')",
      [initId]
    );
    expect(taskRes.rows.length).toBe(1);
  });

  it('initiative 已有 in_progress 任务（非 architecture_design）时不创建 architecture_design', async () => {
    const parentRes = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('scan-inprogress-parent', '/tmp/scan-ip', 'active') RETURNING id"
    );
    const parentId = parentRes.rows[0].id;
    testProjectIds.push(parentId);

    const initRes = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Scan InProgress Initiative', 'initiative', $1, 'active', 'coding') RETURNING id",
      [parentId]
    );
    const initId = initRes.rows[0].id;
    testProjectIds.push(initId);

    // 已有一个 in_progress dev 任务
    const inProgressRes = await pool.query(
      "INSERT INTO tasks (title, task_type, status, priority, project_id) VALUES ('active dev task', 'dev', 'in_progress', 'P1', $1) RETURNING id",
      [initId]
    );
    testTaskIds.push(inProgressRes.rows[0].id);

    await scanInitiativesForArchDesign();

    // 不应创建 architecture_design（initiative 已有 in_progress 任务）
    const taskRes = await pool.query(
      "SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'architecture_design'",
      [initId]
    );
    expect(taskRes.rows.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 非 coding domain → 跳过
// ──────────────────────────────────────────────────────────────────

describe('scanInitiativesForArchDesign - domain 过滤', () => {
  it('非 coding domain 的 initiative 不应创建 architecture_design', async () => {
    const parentRes = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('scan-noncoding-parent', '/tmp/scan-nc', 'active') RETURNING id"
    );
    const parentId = parentRes.rows[0].id;
    testProjectIds.push(parentId);

    // domain = 'marketing'（非 coding）
    const initRes = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Non-coding Initiative', 'initiative', $1, 'active', 'marketing') RETURNING id",
      [parentId]
    );
    const initId = initRes.rows[0].id;
    testProjectIds.push(initId);

    await scanInitiativesForArchDesign();

    // 不应创建 architecture_design
    const taskRes = await pool.query(
      "SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'architecture_design'",
      [initId]
    );
    expect(taskRes.rows.length).toBe(0);
  });
});
