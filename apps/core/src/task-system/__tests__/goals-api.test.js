/**
 * Goal API Integration Tests
 * Tests for Goal CRUD operations via HTTP API
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || 'CeceliaUS2026'
});

const API_BASE = process.env.API_BASE || 'http://localhost:5211';

let testGoalIds = [];

async function createGoal(data) {
  const res = await fetch(`${API_BASE}/api/tasks/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const goal = await res.json();
  if (goal.id) {
    testGoalIds.push(goal.id);
  }
  return { res, goal };
}

async function getGoal(id) {
  const res = await fetch(`${API_BASE}/api/tasks/goals/${id}`);
  return { res, goal: await res.json() };
}

async function listGoals(params = '') {
  const url = params ? `${API_BASE}/api/tasks/goals?${params}` : `${API_BASE}/api/tasks/goals`;
  const res = await fetch(url);
  return { res, goals: await res.json() };
}

async function updateGoal(id, data) {
  const res = await fetch(`${API_BASE}/api/tasks/goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return { res, goal: await res.json() };
}

async function deleteGoal(id) {
  const res = await fetch(`${API_BASE}/api/tasks/goals/${id}`, {
    method: 'DELETE'
  });
  return { res, result: await res.json() };
}

describe('Goal API CRUD Operations', () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test goals in reverse order (children first)
    for (const id of testGoalIds.reverse()) {
      await pool.query('DELETE FROM goals WHERE id = $1', [id]).catch(() => {});
    }
    testGoalIds = [];
  });

  describe('Create Goal', () => {
    it('creates an Objective with required fields', async () => {
      const { res, goal } = await createGoal({
        title: 'Test Objective via API',
        type: 'objective'
      });

      expect(res.status).toBe(201);
      expect(goal.id).toBeDefined();
      expect(goal.title).toBe('Test Objective via API');
      expect(goal.type).toBe('objective');
      expect(goal.status).toBe('pending');
      expect(goal.priority).toBe('P2');
      expect(goal.progress).toBe(0);
    });

    it('creates an Objective with all optional fields', async () => {
      const { res, goal } = await createGoal({
        title: 'Full Objective',
        type: 'objective',
        description: 'A detailed description',
        status: 'in_progress',
        priority: 'P0',
        progress: 25,
        metadata: { source: 'test' }
      });

      expect(res.status).toBe(201);
      expect(goal.description).toBe('A detailed description');
      expect(goal.status).toBe('in_progress');
      expect(goal.priority).toBe('P0');
      expect(goal.progress).toBe(25);
      expect(goal.metadata).toEqual({ source: 'test' });
    });

    it('creates a Key Result with parent_id', async () => {
      // Create parent Objective first
      const { goal: objective } = await createGoal({
        title: 'Parent Objective',
        type: 'objective'
      });

      // Create Key Result
      const { res, goal: kr } = await createGoal({
        title: 'Test Key Result',
        parent_id: objective.id,
        weight: 0.5,
        progress: 30
      });

      expect(res.status).toBe(201);
      expect(kr.type).toBe('key_result');
      expect(kr.parent_id).toBe(objective.id);
      expect(parseFloat(kr.weight)).toBe(0.5);
    });

    it('rejects Key Result without parent_id', async () => {
      const { res, goal } = await createGoal({
        title: 'Orphan KR',
        type: 'key_result'
      });

      expect(res.status).toBe(400);
      expect(goal.error).toContain('parent_id');
    });

    it('rejects Objective with parent_id', async () => {
      const { goal: objective } = await createGoal({
        title: 'Another Objective',
        type: 'objective'
      });

      const { res, goal } = await createGoal({
        title: 'Invalid Objective',
        type: 'objective',
        parent_id: objective.id
      });

      expect(res.status).toBe(400);
      expect(goal.error).toContain('parent_id');
    });
  });

  describe('Query Goals', () => {
    it('lists all goals', async () => {
      // Create test goals
      await createGoal({ title: 'List Test 1', type: 'objective' });
      await createGoal({ title: 'List Test 2', type: 'objective' });

      const { res, goals } = await listGoals();

      expect(res.status).toBe(200);
      expect(Array.isArray(goals)).toBe(true);
      expect(goals.length).toBeGreaterThanOrEqual(2);
    });

    it('gets single goal by id', async () => {
      const { goal: created } = await createGoal({
        title: 'Single Get Test',
        type: 'objective'
      });

      const { res, goal } = await getGoal(created.id);

      expect(res.status).toBe(200);
      expect(goal.id).toBe(created.id);
      expect(goal.title).toBe('Single Get Test');
    });

    it('returns 404 for non-existent goal', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const { res, goal } = await getGoal(fakeId);

      expect(res.status).toBe(404);
      expect(goal.error).toBe('Goal not found');
    });

    it('filters by project_id', async () => {
      // Get a project_id from existing projects
      const projectResult = await pool.query('SELECT id FROM projects LIMIT 1');
      const projectId = projectResult.rows[0]?.id;

      if (projectId) {
        // Create goal with project_id
        await createGoal({
          title: 'Project Goal',
          type: 'objective',
          project_id: projectId
        });

        const { res, goals } = await listGoals(`project_id=${projectId}`);

        expect(res.status).toBe(200);
        for (const g of goals) {
          expect(g.project_id).toBe(projectId);
        }
      }
    });
  });

  describe('Update Goal', () => {
    it('updates goal title', async () => {
      const { goal: created } = await createGoal({
        title: 'Original Title',
        type: 'objective'
      });

      const { res, goal } = await updateGoal(created.id, {
        title: 'Updated Title'
      });

      expect(res.status).toBe(200);
      expect(goal.title).toBe('Updated Title');
    });

    it('updates goal status', async () => {
      const { goal: created } = await createGoal({
        title: 'Status Test',
        type: 'objective'
      });

      const { res, goal } = await updateGoal(created.id, {
        status: 'in_progress'
      });

      expect(res.status).toBe(200);
      expect(goal.status).toBe('in_progress');
    });

    it('updates goal progress', async () => {
      const { goal: created } = await createGoal({
        title: 'Progress Test',
        type: 'objective'
      });

      const { res, goal } = await updateGoal(created.id, {
        progress: 75
      });

      expect(res.status).toBe(200);
      expect(goal.progress).toBe(75);
    });

    it('updates status to completed', async () => {
      const { goal: created } = await createGoal({
        title: 'Completion Test',
        type: 'objective'
      });

      const { res, goal } = await updateGoal(created.id, {
        status: 'completed'
      });

      expect(res.status).toBe(200);
      expect(goal.status).toBe('completed');
    });

    it('returns 400 when no fields provided', async () => {
      const { goal: created } = await createGoal({
        title: 'No Update Test',
        type: 'objective'
      });

      const { res, goal } = await updateGoal(created.id, {});

      expect(res.status).toBe(400);
      expect(goal.error).toContain('field');
    });

    it('returns 404 for non-existent goal', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const { res, goal } = await updateGoal(fakeId, { title: 'New Title' });

      expect(res.status).toBe(404);
    });
  });

  describe('Delete Goal', () => {
    it('deletes goal successfully', async () => {
      const { goal: created } = await createGoal({
        title: 'Delete Test',
        type: 'objective'
      });
      // Remove from cleanup list since we're deleting it manually
      testGoalIds = testGoalIds.filter(id => id !== created.id);

      const { res, result } = await deleteGoal(created.id);

      expect(res.status).toBe(200);
      expect(result.message).toBe('Goal deleted');
      expect(result.id).toBe(created.id);

      // Verify it's really gone
      const { res: getRes } = await getGoal(created.id);
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent goal', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const { res, result } = await deleteGoal(fakeId);

      expect(res.status).toBe(404);
      expect(result.error).toBe('Goal not found');
    });
  });

  describe('Data Persistence', () => {
    it('persists goal data across queries', async () => {
      // Create a goal
      const { goal: created } = await createGoal({
        title: 'Persistence Test',
        type: 'objective',
        description: 'Testing persistence',
        priority: 'P1'
      });

      // Query it back
      const { goal: queried } = await getGoal(created.id);

      expect(queried.id).toBe(created.id);
      expect(queried.title).toBe('Persistence Test');
      expect(queried.description).toBe('Testing persistence');
      expect(queried.priority).toBe('P1');

      // Update it
      await updateGoal(created.id, { progress: 50 });

      // Query again
      const { goal: updated } = await getGoal(created.id);
      expect(updated.progress).toBe(50);
    });

    it('newly created goal appears in list', async () => {
      const uniqueTitle = `List Check ${Date.now()}`;
      const { goal: created } = await createGoal({
        title: uniqueTitle,
        type: 'objective'
      });

      const { goals } = await listGoals();
      const found = goals.find(g => g.id === created.id);

      expect(found).toBeDefined();
      expect(found.title).toBe(uniqueTitle);
    });
  });

  describe('OKR Hierarchy via API', () => {
    it('gets children (Key Results) for an Objective', async () => {
      // Create Objective
      const { goal: objective } = await createGoal({
        title: 'Parent for Children Test',
        type: 'objective'
      });

      // Create Key Results
      const { goal: kr1 } = await createGoal({
        title: 'Child KR 1',
        parent_id: objective.id,
        weight: 0.6
      });

      const { goal: kr2 } = await createGoal({
        title: 'Child KR 2',
        parent_id: objective.id,
        weight: 0.4
      });

      // Get children via API
      const res = await fetch(`${API_BASE}/api/tasks/goals/${objective.id}/children`);
      const children = await res.json();

      expect(res.status).toBe(200);
      expect(children.length).toBe(2);
      expect(children.every(c => c.parent_id === objective.id)).toBe(true);
    });

    it('returns error when getting children of a Key Result', async () => {
      // Create Objective and KR
      const { goal: objective } = await createGoal({
        title: 'Parent O',
        type: 'objective'
      });

      const { goal: kr } = await createGoal({
        title: 'KR for Error Test',
        parent_id: objective.id
      });

      // Try to get children of KR
      const res = await fetch(`${API_BASE}/api/tasks/goals/${kr.id}/children`);
      const result = await res.json();

      expect(res.status).toBe(400);
      expect(result.error).toContain('Objectives');
    });

    it('recalculates Objective progress when KR progress updates', async () => {
      // Create Objective
      const { goal: objective } = await createGoal({
        title: 'Progress Calc Test',
        type: 'objective'
      });

      // Create KRs with weights
      await createGoal({
        title: 'KR 60%',
        parent_id: objective.id,
        weight: 0.6,
        progress: 80
      });

      await createGoal({
        title: 'KR 40%',
        parent_id: objective.id,
        weight: 0.4,
        progress: 100
      });

      // Update one KR's progress
      const krsRes = await fetch(`${API_BASE}/api/tasks/goals/${objective.id}/children`);
      const krs = await krsRes.json();

      await updateGoal(krs[0].id, { progress: 100 });

      // Check parent progress (should be recalculated)
      const { goal: updated } = await getGoal(objective.id);

      // Expected: (100 * 0.6 + 100 * 0.4) / 1.0 = 100, or similar weighted calc
      // The actual value depends on which KR was updated
      expect(updated.progress).toBeGreaterThanOrEqual(80);
    });
  });
});
