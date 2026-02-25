import { describe, it, expect, beforeAll } from 'vitest';

describe('Task System API Integration', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';
  let workspaceId;
  let projectId;
  let goalId;
  let taskId;
  let linkId;

  beforeAll(async () => {
    const wsRes = await fetch(`${API_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    workspaceId = workspaces[0]?.id;
  });

  describe('Projects API', () => {
    it('should create a new project', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Test Project',
          description: 'Test description',
          repo_path: '/test/path',
        }),
      });
      
      expect(res.status).toBe(201);
      const project = await res.json();
      expect(project.name).toBe('Test Project');
      projectId = project.id;
    });

    it('should list projects', async () => {
      const res = await fetch(`${API_BASE}/api/projects`);
      expect(res.status).toBe(200);
      const projects = await res.json();
      expect(Array.isArray(projects)).toBe(true);
    });

    it('should get project stats', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/stats`);
      expect(res.status).toBe(200);
      const stats = await res.json();
      expect(stats).toHaveProperty('total_tasks');
    });
  });

  describe('Goals API', () => {
    it('should create a new goal', async () => {
      const res = await fetch(`${API_BASE}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Test Goal',
          priority: 'P1',
        }),
      });
      
      expect(res.status).toBe(201);
      const goal = await res.json();
      expect(goal.title).toBe('Test Goal');
      goalId = goal.id;
    });

    it('should get goal tasks', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${goalId}/tasks`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Tasks API', () => {
    it('should create a new task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          goal_id: goalId,
          title: 'Test Task',
          priority: 'P0',
          status: 'queued',
        }),
      });
      
      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.title).toBe('Test Task');
      taskId = task.id;
    });

    it('should filter tasks by status and priority', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?status=queued&priority=P0`);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should get task backlinks', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/backlinks`);
      expect(res.status).toBe(200);
      const backlinks = await res.json();
      expect(Array.isArray(backlinks)).toBe(true);
    });
  });

  describe('Task Links API', () => {
    let task2Id;

    it('should create another task for linking', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          goal_id: goalId,
          title: 'Blocking Task',
          priority: 'P1',
        }),
      });
      
      const task = await res.json();
      task2Id = task.id;
    });

    it('should create a task link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task2Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: taskId,
          linkType: 'blocks',
        }),
      });
      
      expect(res.status).toBe(201);
      const link = await res.json();
      expect(link.link_type).toBe('blocks');
      linkId = link.id;
    });

    it('should get all links for a task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/links`);
      expect(res.status).toBe(200);
      const links = await res.json();
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
    });

    it('should delete a task link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task2Id}/links/${linkId}`, {
        method: 'DELETE',
      });
      
      expect(res.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent project', async () => {
      const res = await fetch(`${API_BASE}/api/projects/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid link type', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: projectId,
          linkType: 'invalid_type',
        }),
      });
      
      expect(res.status).toBe(400);
    });

    it('should handle missing required fields', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      expect(res.status).toBe(500);
    });
  });
});
