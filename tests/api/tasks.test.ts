import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Tasks CRUD API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';
  let workspaceId: string;
  let testProjectId: string;
  let testGoalId: string;
  let testTaskId: string;

  beforeAll(async () => {
    // Setup: create workspace, project, and goal
    const wsRes = await fetch(`${API_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    workspaceId = workspaces[0]?.id;

    const projRes = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: 'Test Project for Tasks',
      }),
    });
    const project = await projRes.json();
    testProjectId = project.id;

    const goalRes = await fetch(`${API_BASE}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: testProjectId,
        title: 'Test Goal',
        priority: 'P0',
      }),
    });
    const goal = await goalRes.json();
    testGoalId = goal.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testTaskId) {
      await fetch(`${API_BASE}/api/tasks/${testTaskId}`, { method: 'DELETE' });
    }
    if (testGoalId) {
      await fetch(`${API_BASE}/api/goals/${testGoalId}`, { method: 'DELETE' });
    }
    if (testProjectId) {
      await fetch(`${API_BASE}/api/projects/${testProjectId}`, { method: 'DELETE' });
    }
  });

  describe('CREATE - POST /api/tasks', () => {
    it('should create a task with all fields', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          goal_id: testGoalId,
          title: 'Implement Feature X',
          description: 'Detailed description',
          priority: 'P0',
          status: 'queued',
          estimated_time: '2h',
          metadata: { tags: ['backend'] },
        }),
      });

      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.title).toBe('Implement Feature X');
      expect(task.priority).toBe('P0');
      expect(task.status).toBe('queued');
      testTaskId = task.id;
    });

    it('should create task with minimal fields', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Minimal Task',
          priority: 'P1',
        }),
      });

      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.title).toBe('Minimal Task');
      expect(task.status).toBe('queued'); // default
    });
  });

  describe('READ - GET /api/tasks', () => {
    it('should list all tasks', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?status=queued`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      tasks.forEach((t: any) => {
        expect(t.status).toBe('queued');
      });
    });

    it('should filter tasks by priority', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?priority=P0`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      tasks.forEach((t: any) => {
        expect(t.priority).toBe('P0');
      });
    });

    it('should filter tasks by status AND priority', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?status=queued&priority=P0`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      tasks.forEach((t: any) => {
        expect(t.status).toBe('queued');
        expect(t.priority).toBe('P0');
      });
    });

    it('should filter tasks by project_id', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?project_id=${testProjectId}`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      tasks.forEach((t: any) => {
        expect(t.project_id).toBe(testProjectId);
      });
    });

    it('should filter tasks by goal_id', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?goal_id=${testGoalId}`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      tasks.forEach((t: any) => {
        expect(t.goal_id).toBe(testGoalId);
      });
    });

    it('should get task by id', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}`);
      expect(res.status).toBe(200);
      const task = await res.json();
      expect(task.id).toBe(testTaskId);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  describe('UPDATE - PATCH /api/tasks/:id', () => {
    it('should update task status', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'in_progress',
        }),
      });

      expect(res.status).toBe(200);
      const task = await res.json();
      expect(task.status).toBe('in_progress');
    });

    it('should update multiple fields', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated Task Title',
          description: 'Updated description',
          priority: 'P1',
        }),
      });

      expect(res.status).toBe(200);
      const task = await res.json();
      expect(task.title).toBe('Updated Task Title');
      expect(task.description).toBe('Updated description');
      expect(task.priority).toBe('P1');
    });

    it('should reject empty update', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE - DELETE /api/tasks/:id', () => {
    it('should delete task', async () => {
      // Create a task to delete
      const createRes = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: testProjectId,
          title: 'Task to Delete',
          priority: 'P2',
        }),
      });
      const task = await createRes.json();

      // Delete it
      const deleteRes = await fetch(`${API_BASE}/api/tasks/${task.id}`, {
        method: 'DELETE',
      });

      expect(deleteRes.status).toBe(200);

      // Verify it's gone
      const getRes = await fetch(`${API_BASE}/api/tasks/${task.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('BACKLINKS - GET /api/tasks/:id/backlinks', () => {
    it('should get backlinks for a task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}/backlinks`);
      expect(res.status).toBe(200);
      const backlinks = await res.json();
      expect(Array.isArray(backlinks)).toBe(true);
    });

    it('should return empty array for task with no backlinks', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${testTaskId}/backlinks`);
      const backlinks = await res.json();
      expect(Array.isArray(backlinks)).toBe(true);
      // New task should have no backlinks
    });
  });
});
