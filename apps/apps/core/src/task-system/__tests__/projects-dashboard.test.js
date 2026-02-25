/**
 * Project Dashboard API Tests
 * Tests for GET /api/tasks/projects/:id/dashboard
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

const API_BASE = process.env.API_BASE || 'http://localhost:5211';

let testProjectId = null;
let testGoalId = null;
let testTaskIds = [];
let testFeatureId = null;

describe('Project Dashboard API', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');

    // Create test project
    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path) VALUES ($1, $2) RETURNING *",
      ['Test Dashboard Project', '/tmp/test-dashboard']
    );
    testProjectId = projResult.rows[0].id;

    // Create a goal
    const goalResult = await pool.query(
      "INSERT INTO goals (title, project_id, status, progress, priority) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      ['Test Goal', testProjectId, 'in_progress', 50, 'P1']
    );
    testGoalId = goalResult.rows[0].id;

    // Create tasks with different statuses
    for (const status of ['completed', 'completed', 'in_progress', 'queued']) {
      const taskResult = await pool.query(
        "INSERT INTO tasks (title, project_id, status, priority) VALUES ($1, $2, $3, $4) RETURNING *",
        [`Test Task ${status}`, testProjectId, status, 'P1']
      );
      testTaskIds.push(taskResult.rows[0].id);
    }

    // Create a sub-project (feature)
    const featureResult = await pool.query(
      "INSERT INTO projects (name, parent_id) VALUES ($1, $2) RETURNING *",
      ['Test Feature', testProjectId]
    );
    testFeatureId = featureResult.rows[0].id;
  });

  afterAll(async () => {
    if (testFeatureId) await pool.query('DELETE FROM projects WHERE id = $1', [testFeatureId]);
    for (const id of testTaskIds) await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    if (testGoalId) await pool.query('DELETE FROM goals WHERE id = $1', [testGoalId]);
    if (testProjectId) await pool.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    await pool.end();
  });

  it('returns 200 with complete dashboard data', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects/${testProjectId}/dashboard`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.project).toBeDefined();
    expect(data.stats).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.goals).toBeDefined();
    expect(data.features).toBeDefined();
    expect(data.recent_activity).toBeDefined();
  });

  it('response contains all six required fields with correct data', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects/${testProjectId}/dashboard`);
    const data = await res.json();

    // project
    expect(data.project.id).toBe(testProjectId);
    expect(data.project.name).toBe('Test Dashboard Project');

    // stats
    expect(parseInt(data.stats.total_tasks)).toBe(4);
    expect(parseInt(data.stats.completed_tasks)).toBe(2);
    expect(parseInt(data.stats.in_progress_tasks)).toBe(1);
    expect(parseInt(data.stats.queued_tasks)).toBe(1);

    // health
    expect(data.health).toHaveProperty('health_score');
    expect(data.health).toHaveProperty('health_status');
    expect(typeof data.health.health_score).toBe('number');

    // goals
    expect(data.goals.length).toBeGreaterThanOrEqual(1);
    expect(data.goals.some(g => g.id === testGoalId)).toBe(true);

    // features
    expect(data.features.length).toBeGreaterThanOrEqual(1);
    expect(data.features.some(f => f.id === testFeatureId)).toBe(true);

    // recent_activity
    expect(Array.isArray(data.recent_activity)).toBe(true);
  });

  it('returns 404 for non-existent project', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${API_BASE}/api/tasks/projects/${fakeId}/dashboard`);
    expect(res.status).toBe(404);
  });
});
