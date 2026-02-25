import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Goals CRUD API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';
  let workspaceId: string;
  let testProjectId: string;
  let testGoalId: string;

  beforeAll(async () => {
    // Setup: create workspace and project
    const wsRes = await fetch(`${API_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    workspaceId = workspaces[0]?.id;

    const projRes = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: 'Test Project for Goals',
      }),
    });
    const project = await projRes.json();
    testProjectId = project.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testGoalId) {
      await fetch(`${API_BASE}/api/goals/${testGoalId}`, { method: 'DELETE' });
    }
    if (testProjectId) {
      await fetch(`${API_BASE}/api/projects/${testProjectId}`, { method: 'DELETE' });
    }
  });

  describe('CREATE - POST /api/goals', () => {
    it('should create a goal with all fields', async () => {
      const res = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Complete Feature X',
          description: 'Implement all components',
          priority: 'P0',
          status: 'active',
          metadata: { tags: ['frontend', 'backend'] },
        }),
      });

      expect(res.status).toBe(201);
      const goal = await res.json();
      expect(goal.title).toBe('Complete Feature X');
      expect(goal.priority).toBe('P0');
      expect(goal.metadata).toEqual({ tags: ['frontend', 'backend'] });
      testGoalId = goal.id;
    });

    it('should create goal with minimal fields', async () => {
      const res = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Minimal Goal',
          priority: 'P1',
        }),
      });

      expect(res.status).toBe(201);
      const goal = await res.json();
      expect(goal.title).toBe('Minimal Goal');
      expect(goal.status).toBe('active'); // default
    });

    it('should reject missing required field (project_id)', async () => {
      const res = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'No Project Goal',
          priority: 'P1',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('READ - GET /api/goals', () => {
    it('should list all goals', async () => {
      const res = await fetch(`${API_BASE}/api/goals`);
      expect(res.status).toBe(200);
      const goals = await res.json();
      expect(Array.isArray(goals)).toBe(true);
    });

    it('should filter goals by project_id', async () => {
      const res = await fetch(`${API_BASE}/api/goals?project_id=${testProjectId}`);
      expect(res.status).toBe(200);
      const goals = await res.json();
      expect(Array.isArray(goals)).toBe(true);
      goals.forEach((g: any) => {
        expect(g.project_id).toBe(testProjectId);
      });
    });

    it('should filter goals by status', async () => {
      const res = await fetch(`${API_BASE}/api/goals?status=active`);
      expect(res.status).toBe(200);
      const goals = await res.json();
      goals.forEach((g: any) => {
        expect(g.status).toBe('active');
      });
    });

    it('should get goal by id', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${testGoalId}`);
      expect(res.status).toBe(200);
      const goal = await res.json();
      expect(goal.id).toBe(testGoalId);
    });

    it('should return 404 for non-existent goal', async () => {
      const res = await fetch(`${API_BASE}/api/goals/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  describe('UPDATE - PATCH /api/goals/:id', () => {
    it('should update goal title', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${testGoalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated Goal Title',
        }),
      });

      expect(res.status).toBe(200);
      const goal = await res.json();
      expect(goal.title).toBe('Updated Goal Title');
    });

    it('should update goal status', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${testGoalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
        }),
      });

      expect(res.status).toBe(200);
      const goal = await res.json();
      expect(goal.status).toBe('completed');
    });

    it('should reject empty update', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${testGoalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE - DELETE /api/goals/:id', () => {
    it('should delete goal', async () => {
      // Create a goal to delete
      const createRes = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Goal to Delete',
          priority: 'P2',
        }),
      });
      const goal = await createRes.json();

      // Delete it
      const deleteRes = await fetch(`${API_BASE}/api/goals/${goal.id}`, {
        method: 'DELETE',
      });

      expect(deleteRes.status).toBe(200);

      // Verify it's gone
      const getRes = await fetch(`${API_BASE}/api/goals/${goal.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('TASKS - GET /api/goals/:id/tasks', () => {
    let taskId: string;

    beforeAll(async () => {
      // Create a task under this goal
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          goal_id: testGoalId,
          title: 'Test Task',
          priority: 'P0',
        }),
      });
      const task = await res.json();
      taskId = task.id;
    });

    afterAll(async () => {
      if (taskId) {
        await fetch(`${API_BASE}/api/tasks/${taskId}`, { method: 'DELETE' });
      }
    });

    it('should list all tasks for a goal', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${testGoalId}/tasks`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].goal_id).toBe(testGoalId);
    });

    it('should return empty array for goal with no tasks', async () => {
      // Create a new goal with no tasks
      const goalRes = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Empty Goal',
          priority: 'P2',
        }),
      });
      const emptyGoal = await goalRes.json();

      const res = await fetch(`${API_BASE}/api/goals/${emptyGoal.id}/tasks`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(0);

      // Cleanup
      await fetch(`${API_BASE}/api/goals/${emptyGoal.id}`, { method: 'DELETE' });
    });
  });
});
